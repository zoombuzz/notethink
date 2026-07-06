/*
 * pure FLIP (First-Last-Invert-Play) math for the kanban passive-transition layer.
 * no DOM access and no React: every export takes plain values and returns plain values
 * (the Keyframe / KeyframeAnimationOptions types are object shapes only - no DOM call is made).
 */
import Debug from 'debug';

const debug = Debug("nodejs:notethink-views:flipMath");

// --- timing budget ---

export const KANBAN_ANIMATION_TRANSITION_MAX_MS = 350;
export const KANBAN_ANIMATION_GLOBAL_CAP_MS = 800;
export const KANBAN_ANIMATION_DRAG_GATE_MS = 250;
export const KANBAN_ANIMATION_ENTER_MS = 200;
export const KANBAN_ANIMATION_COLUMN_ENTER_MS = 250;
export const KANBAN_ANIMATION_COLUMN_EXIT_MS = 200;
export const KANBAN_ANIMATION_EASING = 'cubic-bezier(0.2, 0, 0.0, 1.0)';

// minimum hypotenuse (px) below which a delta is treated as visually negligible
const SIGNIFICANT_DELTA_THRESHOLD_PX = 0.5;

// --- types ---

export interface RectLike {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface FlipDelta {
    dx: number;
    dy: number;
}

/**
 * TransitionClassification: the partition of element ids across a single layout change.
 * - entering: ids present in `next` but not `prev` (follows `next` order)
 * - moving: ids present in both `prev` and `next` (follows `next` order)
 * - exiting: ids present in `prev` but not `next` (follows `prev` order)
 */
export interface TransitionClassification {
    entering: string[];
    moving: string[];
    exiting: string[];
}

/**
 * classify a set of element ids across a layout change. entering/moving preserve the `next`
 * iteration order; exiting preserves the `prev` iteration order. an id absent from `prev`
 * lands in `entering` (the new-note enter path); an id absent from `next` lands in `exiting`
 * (the removed-note exit path).
 */
export function classifyTransitions(prev_ids: Iterable<string>, next_ids: Iterable<string>): TransitionClassification {
    const prev_set = new Set(prev_ids);
    const next_set = new Set(next_ids);
    const entering: string[] = [];
    const moving: string[] = [];
    const exiting: string[] = [];
    for (const id of next_set) {
        if (prev_set.has(id)) {
            moving.push(id);
        } else {
            entering.push(id);
        }
    }
    for (const id of prev_set) {
        if (!next_set.has(id)) {
            exiting.push(id);
        }
    }
    return { entering, moving, exiting };
}

/**
 * the inverse transform: the translation that visually returns an element to its PREV rect
 * while it already occupies its NEXT rect. dx = prev.left - next.left, dy = prev.top - next.top.
 */
export function computeInverseTransform(prev: RectLike, next: RectLike): FlipDelta {
    return { dx: prev.left - next.left, dy: prev.top - next.top };
}

/** true when a delta is visually significant - its hypotenuse exceeds `threshold` px (default 0.5) */
export function isSignificantDelta(delta: FlipDelta, threshold: number = SIGNIFICANT_DELTA_THRESHOLD_PX): boolean {
    return Math.hypot(delta.dx, delta.dy) > threshold;
}

/**
 * Web Animations keyframes for a cross-column / reorder move. starts at the inverted offset,
 * lands at identity, with a subtle mid-flight lift (rotate 2deg, scale 1.02) that mimics the
 * existing manual drag in-flight style. first keyframe carries `translate(dx, dy)`, the mid
 * keyframe (offset 0.5) adds the rotate/scale lift, the last keyframe is identity.
 */
export function buildMoveKeyframes(delta: FlipDelta): Keyframe[] {
    return [
        { transform: `translate(${delta.dx}px, ${delta.dy}px) rotate(0deg) scale(1)`, offset: 0 },
        { transform: `translate(${delta.dx / 2}px, ${delta.dy / 2}px) rotate(2deg) scale(1.02)`, offset: 0.5 },
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', offset: 1 },
    ];
}

/** new-note entrance: opacity 0 -> 1 with scale 0.96 -> 1 */
export function buildEnterKeyframes(): Keyframe[] {
    return [
        { opacity: 0, transform: 'scale(0.96)', offset: 0 },
        { opacity: 1, transform: 'scale(1)', offset: 1 },
    ];
}

/** removed-note exit: opacity 1 -> 0 with scale 1 -> 0.96 */
export function buildExitKeyframes(): Keyframe[] {
    return [
        { opacity: 1, transform: 'scale(1)', offset: 0 },
        { opacity: 0, transform: 'scale(0.96)', offset: 1 },
    ];
}

/*
 * fill: 'backwards' NOT 'both'. backwards holds the first keyframe during the pre-active frame (so a card never
 * flashes at its final spot before the invert->play starts), but crucially applies NO forwards fill: once the
 * animation ends it stops controlling `transform`, which reverts to the (natural-position) inline style. a forwards
 * fill left the finished move animation permanently owning `transform: translate(0)`, and since an animation-origin
 * value outranks an inline style, that overrode @hello-pangea/dnd's own drag transform - the next drag on a just-
 * glided card lifted a clone that could not track the cursor and stalled (the drag-after-a-passive-move bug).
 */
export function moveTiming(): KeyframeAnimationOptions {
    return { duration: KANBAN_ANIMATION_TRANSITION_MAX_MS, easing: KANBAN_ANIMATION_EASING, fill: 'backwards' };
}

/** timing options for the enter .animate() call - fill: 'backwards' so a just-entered card releases its transform for a subsequent drag */
export function enterTiming(): KeyframeAnimationOptions {
    return { duration: KANBAN_ANIMATION_ENTER_MS, easing: KANBAN_ANIMATION_EASING, fill: 'backwards' };
}

/** timing options for the exit .animate() call - fill: 'backwards' to match move/enter (an exiting card is removed, so it never holds anyway) */
export function exitTiming(): KeyframeAnimationOptions {
    return { duration: KANBAN_ANIMATION_ENTER_MS, easing: KANBAN_ANIMATION_EASING, fill: 'backwards' };
}

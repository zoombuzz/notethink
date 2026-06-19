import {
    KANBAN_ANIMATION_TRANSITION_MAX_MS,
    KANBAN_ANIMATION_ENTER_MS,
    KANBAN_ANIMATION_EASING,
    classifyTransitions,
    computeInverseTransform,
    isSignificantDelta,
    buildMoveKeyframes,
    buildEnterKeyframes,
    buildExitKeyframes,
    moveTiming,
    enterTiming,
    exitTiming,
} from './flipMath';
import type { RectLike } from './flipMath';

// --- classifyTransitions ---

describe('classifyTransitions', () => {
    it('partitions overlapping prev/next sets into entering, moving, and exiting', () => {
        const result = classifyTransitions(['a', 'b', 'c'], ['b', 'c', 'd']);
        expect(result.entering).toEqual(['d']);
        expect(result.moving).toEqual(['b', 'c']);
        expect(result.exiting).toEqual(['a']);
    });

    it('treats every id as entering on first render (prev empty)', () => {
        const result = classifyTransitions([], ['a', 'b', 'c']);
        expect(result.entering).toEqual(['a', 'b', 'c']);
        expect(result.moving).toEqual([]);
        expect(result.exiting).toEqual([]);
    });

    it('treats every id as exiting when next is empty (all removed)', () => {
        const result = classifyTransitions(['a', 'b', 'c'], []);
        expect(result.entering).toEqual([]);
        expect(result.moving).toEqual([]);
        expect(result.exiting).toEqual(['a', 'b', 'c']);
    });

    it('treats fully disjoint sets as all-exiting + all-entering with no moving', () => {
        const result = classifyTransitions(['a', 'b'], ['c', 'd']);
        expect(result.entering).toEqual(['c', 'd']);
        expect(result.moving).toEqual([]);
        expect(result.exiting).toEqual(['a', 'b']);
    });

    it('treats identical sets as all-moving with no entering or exiting', () => {
        const result = classifyTransitions(['a', 'b', 'c'], ['a', 'b', 'c']);
        expect(result.entering).toEqual([]);
        expect(result.moving).toEqual(['a', 'b', 'c']);
        expect(result.exiting).toEqual([]);
    });

    it('preserves next order for entering/moving and prev order for exiting', () => {
        const result = classifyTransitions(['x', 'a', 'y'], ['b', 'a', 'c']);
        expect(result.moving).toEqual(['a']);
        expect(result.entering).toEqual(['b', 'c']);
        expect(result.exiting).toEqual(['x', 'y']);
    });
});

// --- computeInverseTransform ---

describe('computeInverseTransform', () => {
    it('computes dx/dy as prev minus next for sample rects', () => {
        const prev: RectLike = { left: 100, top: 50, width: 10, height: 10 };
        const next: RectLike = { left: 30, top: 80, width: 10, height: 10 };
        expect(computeInverseTransform(prev, next)).toEqual({ dx: 70, dy: -30 });
    });

    it('returns a zero delta when prev equals next', () => {
        const rect: RectLike = { left: 12, top: 34, width: 56, height: 78 };
        expect(computeInverseTransform(rect, rect)).toEqual({ dx: 0, dy: 0 });
    });
});

// --- isSignificantDelta ---

describe('isSignificantDelta', () => {
    it('returns false for a delta below the default threshold', () => {
        expect(isSignificantDelta({ dx: 0.3, dy: 0.2 })).toBe(false);
    });

    it('returns true for a delta above the default threshold', () => {
        expect(isSignificantDelta({ dx: 5, dy: 0 })).toBe(true);
    });

    it('returns false for a zero delta', () => {
        expect(isSignificantDelta({ dx: 0, dy: 0 })).toBe(false);
    });

    it('honours a custom threshold', () => {
        expect(isSignificantDelta({ dx: 3, dy: 4 }, 10)).toBe(false);
        expect(isSignificantDelta({ dx: 3, dy: 4 }, 4)).toBe(true);
    });
});

// --- buildMoveKeyframes ---

describe('buildMoveKeyframes', () => {
    it('starts at the inverted translate and lands at identity', () => {
        const frames = buildMoveKeyframes({ dx: 40, dy: -20 });
        expect(frames[0].transform).toBe('translate(40px, -20px) rotate(0deg) scale(1)');
        expect(frames[frames.length - 1].transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
    });

    it('adds a mid-flight rotate/scale lift at offset 0.5', () => {
        const frames = buildMoveKeyframes({ dx: 40, dy: -20 });
        const mid = frames.find(f => f.offset === 0.5);
        expect(mid?.transform).toBe('translate(20px, -10px) rotate(2deg) scale(1.02)');
    });
});

// --- buildEnterKeyframes ---

describe('buildEnterKeyframes', () => {
    it('goes opacity 0 -> 1 with scale 0.96 -> 1', () => {
        const frames = buildEnterKeyframes();
        expect(frames[0].opacity).toBe(0);
        expect(frames[0].transform).toBe('scale(0.96)');
        expect(frames[frames.length - 1].opacity).toBe(1);
        expect(frames[frames.length - 1].transform).toBe('scale(1)');
    });
});

// --- buildExitKeyframes ---

describe('buildExitKeyframes', () => {
    it('goes opacity 1 -> 0 with scale 1 -> 0.96', () => {
        const frames = buildExitKeyframes();
        expect(frames[0].opacity).toBe(1);
        expect(frames[0].transform).toBe('scale(1)');
        expect(frames[frames.length - 1].opacity).toBe(0);
        expect(frames[frames.length - 1].transform).toBe('scale(0.96)');
    });
});

// --- timing options ---

describe('moveTiming / enterTiming / exitTiming', () => {
    it('moveTiming uses the transition-max duration, easing, and fill both', () => {
        expect(moveTiming()).toEqual({
            duration: KANBAN_ANIMATION_TRANSITION_MAX_MS,
            easing: KANBAN_ANIMATION_EASING,
            fill: 'both',
        });
    });

    it('enterTiming uses the enter duration, easing, and fill both', () => {
        expect(enterTiming()).toEqual({
            duration: KANBAN_ANIMATION_ENTER_MS,
            easing: KANBAN_ANIMATION_EASING,
            fill: 'both',
        });
    });

    it('exitTiming uses the enter duration, easing, and fill both', () => {
        expect(exitTiming()).toEqual({
            duration: KANBAN_ANIMATION_ENTER_MS,
            easing: KANBAN_ANIMATION_EASING,
            fill: 'both',
        });
    });
});

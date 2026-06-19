/*
 * test-only probe for the kanban FLIP layer. OFF by default - every export is a no-op until the
 * probe is explicitly enabled, so there is zero overhead in production (no buffering, no globals).
 *
 * the FLIP hook (useFlipTransition) calls emitAnimationEvent for every animation it SCHEDULES -
 * a move/enter/exit classification, a column slide, a gate/reduced-motion skip, or the global cap.
 * jest enables the probe with enableAnimationProbe() and asserts what WOULD animate by reading
 * getAnimationProbeEvents(), with no real requestAnimationFrame / Web Animations loop. Playwright
 * sets globalThis.__NOTETHINK_ANIM_PROBE__ = true before injecting docs and then reads the mirror
 * array globalThis.__notethinkAnimationEvents via page.evaluate.
 *
 * kept DOM-free on purpose: it is a pure in-memory event buffer.
 */
import Debug from 'debug';

const debug = Debug("nodejs:notethink-views:animationProbe");

/**
 * AnimationProbeEvent: one scheduled animation, as the FLIP hook planned it (independent of whether
 * a real WAAPI animation runs).
 * - kind: which path fired - a card 'move'/'enter'/'exit', a 'column-enter'/'column-exit', the
 *   global 'cap' that force-finishes in-flight animations, or a 'skip' (gate/first-run/disabled/reduced).
 * - id: the card stable_id (move/enter/exit) or column value (column-enter/column-exit)
 * - dx / dy: the inverse-transform delta for a move
 * - duration: scheduled duration in ms
 * - reason: why a 'skip' fired (e.g. 'first-run', 'gate-hot', 'disabled', 'reduced-motion')
 */
export interface AnimationProbeEvent {
    kind: 'move' | 'enter' | 'exit' | 'column-enter' | 'column-exit' | 'cap' | 'skip';
    id?: string;
    dx?: number;
    dy?: number;
    duration?: number;
    reason?: string;
}

// name of the global the playwright harness sets to force the probe on without a code path calling enable
const PROBE_GLOBAL_FLAG = '__NOTETHINK_ANIM_PROBE__';
// name of the global mirror array a playwright page.evaluate reads
const PROBE_MIRROR_ARRAY = '__notethinkAnimationEvents';

interface ProbeGlobal {
    [PROBE_GLOBAL_FLAG]?: boolean;
    [PROBE_MIRROR_ARRAY]?: AnimationProbeEvent[];
}

// process-local enable flag, flipped by enableAnimationProbe / disableAnimationProbe
let probe_enabled = false;
// in-memory buffer of scheduled events
let probe_buffer: AnimationProbeEvent[] = [];

function probeGlobal(): ProbeGlobal {
    return globalThis as unknown as ProbeGlobal;
}

/** turn the probe on (jest calls this in beforeEach). subsequent emitAnimationEvent calls buffer + mirror. */
export function enableAnimationProbe(): void {
    probe_enabled = true;
}

/** turn the probe off and clear its buffer + the global mirror array (jest calls this in afterEach). */
export function disableAnimationProbe(): void {
    probe_enabled = false;
    probe_buffer = [];
    const g = probeGlobal();
    if (Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
}

/** enabled if enableAnimationProbe() ran OR the playwright global flag is set */
export function isAnimationProbeEnabled(): boolean {
    return probe_enabled || probeGlobal()[PROBE_GLOBAL_FLAG] === true;
}

/** record a scheduled animation. no-op unless the probe is enabled. mirrors onto the global array too. */
export function emitAnimationEvent(event: AnimationProbeEvent): void {
    if (!isAnimationProbeEnabled()) { return; }
    probe_buffer.push(event);
    const g = probeGlobal();
    if (!Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
    g[PROBE_MIRROR_ARRAY]!.push(event);
}

/** snapshot copy of the buffered events (mutating the result does not affect the buffer) */
export function getAnimationProbeEvents(): AnimationProbeEvent[] {
    return probe_buffer.slice();
}

/** drop every buffered event and clear the global mirror array, leaving the enabled state untouched */
export function clearAnimationProbeEvents(): void {
    probe_buffer = [];
    const g = probeGlobal();
    if (Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
}

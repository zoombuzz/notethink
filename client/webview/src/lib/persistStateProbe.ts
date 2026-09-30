/*
 * Test-only probe for vscode.setState calls, off by default: every export is a no-op until
 * enablePersistStateProbe() runs, so there is no global and no overhead in production. Jest reads
 * getPersistStateEvents(); playwright and the perf harness set globalThis.__NOTETHINK_PERSIST_PROBE__
 * before a load and read the mirror array globalThis.__notethinkPersistCalls.
 */

/**
 * PersistStateEvent: one setState call the webview made.
 * - bytes: JSON.stringify(state).length for the payload sent
 * - docs: how many docs the persisted state held after this call
 * - at: performance.now() when the call happened
 */
export interface PersistStateEvent {
    bytes: number;
    docs: number;
    at: number;
}

// global the playwright harness sets to force the probe on directly
const PROBE_GLOBAL_FLAG = '__NOTETHINK_PERSIST_PROBE__';
// name of the global mirror array a playwright page.evaluate reads
const PROBE_MIRROR_ARRAY = '__notethinkPersistCalls';

interface ProbeGlobal {
    [PROBE_GLOBAL_FLAG]?: boolean;
    [PROBE_MIRROR_ARRAY]?: PersistStateEvent[];
}

// process-local enable flag, flipped by enablePersistStateProbe / disablePersistStateProbe
let probe_enabled = false;
// in-memory buffer of recorded calls
let probe_buffer: PersistStateEvent[] = [];

function probeGlobal(): ProbeGlobal {
    return globalThis as unknown as ProbeGlobal;
}

/** Turns the probe on; jest calls this in beforeEach. */
export function enablePersistStateProbe(): void {
    probe_enabled = true;
}

/** Turns the probe off and clears its buffer and the global mirror array; jest calls this in afterEach. */
export function disablePersistStateProbe(): void {
    probe_enabled = false;
    probe_buffer = [];
    const g = probeGlobal();
    if (Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
}

/** Enabled if enablePersistStateProbe() ran, or the playwright global flag is set. */
export function isPersistStateProbeEnabled(): boolean {
    return probe_enabled || probeGlobal()[PROBE_GLOBAL_FLAG] === true;
}

/** Records a setState call; a no-op unless the probe is enabled. Mirrors onto the global array too. */
export function emitPersistState(event: PersistStateEvent): void {
    if (!isPersistStateProbeEnabled()) { return; }
    probe_buffer.push(event);
    const g = probeGlobal();
    if (!Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
    g[PROBE_MIRROR_ARRAY]!.push(event);
}

/** Snapshot copy of the buffered events; mutating the result does not affect the buffer. */
export function getPersistStateEvents(): PersistStateEvent[] {
    return probe_buffer.slice();
}

/** Drops every buffered event and clears the global mirror array; the enabled state is untouched. */
export function clearPersistStateEvents(): void {
    probe_buffer = [];
    const g = probeGlobal();
    if (Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
}

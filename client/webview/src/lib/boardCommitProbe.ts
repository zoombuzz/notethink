/*
 * test-only probe for board-level state commits. OFF by default - every export is a no-op until the
 * probe is explicitly enabled, so there is no overhead and no global in production (no buffering, no
 * mirror array).
 *
 * useVscodeMessages drains its message queue once per animation frame and folds the batch into one
 * setState, so a board commit is one docs-state change and one board render however many wire messages
 * it carried. That is the unit a folder load's cost is counted in: 200 files used to commit ~200 times.
 * Jest enables the probe with enableBoardCommitProbe() and reads getBoardCommitEvents(); playwright and
 * the perf harness set globalThis.__NOTETHINK_COMMIT_PROBE__ = true before a load and read the mirror
 * array globalThis.__notethinkBoardCommits via page.evaluate.
 *
 * kept DOM-free on purpose: it is a pure in-memory event buffer, like the FLIP layer's animation probe.
 */

/**
 * BoardCommitEvent: one committed change to the webview's doc state.
 * - messages: how many queued wire messages this commit folded together
 * - docs: how many docs the board holds after the commit
 * - at: performance.now() when the commit landed, so a harness can measure progressive fill
 */
export interface BoardCommitEvent {
    messages: number;
    docs: number;
    at: number;
}

// name of the global the playwright harness sets to force the probe on without a code path calling enable
const PROBE_GLOBAL_FLAG = '__NOTETHINK_COMMIT_PROBE__';
// name of the global mirror array a playwright page.evaluate reads
const PROBE_MIRROR_ARRAY = '__notethinkBoardCommits';

interface ProbeGlobal {
    [PROBE_GLOBAL_FLAG]?: boolean;
    [PROBE_MIRROR_ARRAY]?: BoardCommitEvent[];
}

// process-local enable flag, flipped by enableBoardCommitProbe / disableBoardCommitProbe
let probe_enabled = false;
// in-memory buffer of committed events
let probe_buffer: BoardCommitEvent[] = [];

function probeGlobal(): ProbeGlobal {
    return globalThis as unknown as ProbeGlobal;
}

/** turn the probe on (jest calls this in beforeEach). subsequent emitBoardCommit calls buffer + mirror. */
export function enableBoardCommitProbe(): void {
    probe_enabled = true;
}

/** turn the probe off and clear its buffer + the global mirror array (jest calls this in afterEach). */
export function disableBoardCommitProbe(): void {
    probe_enabled = false;
    probe_buffer = [];
    const g = probeGlobal();
    if (Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
}

/** enabled if enableBoardCommitProbe() ran OR the playwright global flag is set */
export function isBoardCommitProbeEnabled(): boolean {
    return probe_enabled || probeGlobal()[PROBE_GLOBAL_FLAG] === true;
}

/** record a board commit. no-op unless the probe is enabled. mirrors onto the global array too. */
export function emitBoardCommit(event: BoardCommitEvent): void {
    if (!isBoardCommitProbeEnabled()) { return; }
    probe_buffer.push(event);
    const g = probeGlobal();
    if (!Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
    g[PROBE_MIRROR_ARRAY]!.push(event);
}

/** snapshot copy of the buffered events (mutating the result does not affect the buffer) */
export function getBoardCommitEvents(): BoardCommitEvent[] {
    return probe_buffer.slice();
}

/** drop every buffered event and clear the global mirror array, leaving the enabled state untouched */
export function clearBoardCommitEvents(): void {
    probe_buffer = [];
    const g = probeGlobal();
    if (Array.isArray(g[PROBE_MIRROR_ARRAY])) {
        g[PROBE_MIRROR_ARRAY] = [];
    }
}

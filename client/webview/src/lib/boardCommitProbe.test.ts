import {
    enableBoardCommitProbe,
    disableBoardCommitProbe,
    isBoardCommitProbeEnabled,
    emitBoardCommit,
    getBoardCommitEvents,
    clearBoardCommitEvents,
    type BoardCommitEvent,
} from './boardCommitProbe';

interface ProbeGlobal {
    __NOTETHINK_COMMIT_PROBE__?: boolean;
    __notethinkBoardCommits?: BoardCommitEvent[];
}

function probeGlobal(): ProbeGlobal {
    return globalThis as unknown as ProbeGlobal;
}

describe('boardCommitProbe', () => {

    afterEach(() => {
        // reset both the enable flag and the playwright global so tests do not leak state
        disableBoardCommitProbe();
        delete probeGlobal().__NOTETHINK_COMMIT_PROBE__;
        probeGlobal().__notethinkBoardCommits = [];
    });

    it('is disabled by default - emit is a no-op', () => {
        expect(isBoardCommitProbeEnabled()).toBe(false);
        emitBoardCommit({ messages: 3, docs: 12, at: 100 });
        expect(getBoardCommitEvents()).toHaveLength(0);
    });

    it('records commits once enabled', () => {
        enableBoardCommitProbe();
        expect(isBoardCommitProbeEnabled()).toBe(true);
        emitBoardCommit({ messages: 20, docs: 20, at: 100 });
        emitBoardCommit({ messages: 20, docs: 40, at: 220 });

        const events = getBoardCommitEvents();
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ messages: 20, docs: 20, at: 100 });
        expect(events[1]).toEqual({ messages: 20, docs: 40, at: 220 });
    });

    it('getBoardCommitEvents returns a snapshot copy (mutation does not affect the buffer)', () => {
        enableBoardCommitProbe();
        emitBoardCommit({ messages: 1, docs: 1, at: 10 });
        const snapshot = getBoardCommitEvents();
        snapshot.push({ messages: 99, docs: 99, at: 99 });
        expect(getBoardCommitEvents()).toHaveLength(1);
    });

    it('the playwright global flag enables the probe without enableBoardCommitProbe()', () => {
        expect(isBoardCommitProbeEnabled()).toBe(false);
        probeGlobal().__NOTETHINK_COMMIT_PROBE__ = true;
        expect(isBoardCommitProbeEnabled()).toBe(true);
        emitBoardCommit({ messages: 2, docs: 5, at: 40 });
        expect(getBoardCommitEvents()).toEqual([{ messages: 2, docs: 5, at: 40 }]);
    });

    it('mirrors emitted commits onto the global __notethinkBoardCommits array', () => {
        enableBoardCommitProbe();
        emitBoardCommit({ messages: 4, docs: 8, at: 60 });
        const mirror = probeGlobal().__notethinkBoardCommits;
        expect(Array.isArray(mirror)).toBe(true);
        expect(mirror).toEqual([{ messages: 4, docs: 8, at: 60 }]);
    });

    it('disableBoardCommitProbe clears the buffer and the mirror, and stops recording', () => {
        enableBoardCommitProbe();
        emitBoardCommit({ messages: 1, docs: 1, at: 10 });
        expect(getBoardCommitEvents()).toHaveLength(1);

        disableBoardCommitProbe();
        expect(isBoardCommitProbeEnabled()).toBe(false);
        expect(getBoardCommitEvents()).toHaveLength(0);
        expect(probeGlobal().__notethinkBoardCommits).toEqual([]);

        emitBoardCommit({ messages: 1, docs: 1, at: 20 });
        expect(getBoardCommitEvents()).toHaveLength(0);
    });

    it('clearBoardCommitEvents empties the buffer + mirror but leaves the probe enabled', () => {
        enableBoardCommitProbe();
        emitBoardCommit({ messages: 1, docs: 1, at: 10 });
        clearBoardCommitEvents();
        expect(getBoardCommitEvents()).toHaveLength(0);
        expect(probeGlobal().__notethinkBoardCommits).toEqual([]);
        expect(isBoardCommitProbeEnabled()).toBe(true);
        // still records after a clear
        emitBoardCommit({ messages: 2, docs: 3, at: 30 });
        expect(getBoardCommitEvents()).toEqual([{ messages: 2, docs: 3, at: 30 }]);
    });
});

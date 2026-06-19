import {
    enableAnimationProbe,
    disableAnimationProbe,
    isAnimationProbeEnabled,
    emitAnimationEvent,
    getAnimationProbeEvents,
    clearAnimationProbeEvents,
    type AnimationProbeEvent,
} from './animationProbe';

interface ProbeGlobal {
    __NOTETHINK_ANIM_PROBE__?: boolean;
    __notethinkAnimationEvents?: AnimationProbeEvent[];
}

function probeGlobal(): ProbeGlobal {
    return globalThis as unknown as ProbeGlobal;
}

describe('animationProbe', () => {

    afterEach(() => {
        // reset both the enable flag and the playwright global so tests do not leak state
        disableAnimationProbe();
        delete probeGlobal().__NOTETHINK_ANIM_PROBE__;
        probeGlobal().__notethinkAnimationEvents = [];
    });

    it('is disabled by default — emit is a no-op', () => {
        expect(isAnimationProbeEnabled()).toBe(false);
        emitAnimationEvent({ kind: 'move', id: 'a', dx: 5, dy: 6 });
        expect(getAnimationProbeEvents()).toHaveLength(0);
    });

    it('records events once enabled', () => {
        enableAnimationProbe();
        expect(isAnimationProbeEnabled()).toBe(true);
        emitAnimationEvent({ kind: 'move', id: 'a', dx: 5, dy: 6, duration: 350 });
        emitAnimationEvent({ kind: 'enter', id: 'b' });

        const events = getAnimationProbeEvents();
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ kind: 'move', id: 'a', dx: 5, dy: 6, duration: 350 });
        expect(events[1]).toEqual({ kind: 'enter', id: 'b' });
    });

    it('getAnimationProbeEvents returns a snapshot copy (mutation does not affect the buffer)', () => {
        enableAnimationProbe();
        emitAnimationEvent({ kind: 'cap' });
        const snapshot = getAnimationProbeEvents();
        snapshot.push({ kind: 'skip', reason: 'tampered' });
        expect(getAnimationProbeEvents()).toHaveLength(1);
    });

    it('the playwright global flag enables the probe without enableAnimationProbe()', () => {
        expect(isAnimationProbeEnabled()).toBe(false);
        probeGlobal().__NOTETHINK_ANIM_PROBE__ = true;
        expect(isAnimationProbeEnabled()).toBe(true);
        emitAnimationEvent({ kind: 'exit', id: 'c' });
        expect(getAnimationProbeEvents()).toEqual([{ kind: 'exit', id: 'c' }]);
    });

    it('mirrors emitted events onto the global __notethinkAnimationEvents array', () => {
        enableAnimationProbe();
        emitAnimationEvent({ kind: 'column-enter', id: 'done' });
        const mirror = probeGlobal().__notethinkAnimationEvents;
        expect(Array.isArray(mirror)).toBe(true);
        expect(mirror).toEqual([{ kind: 'column-enter', id: 'done' }]);
    });

    it('disableAnimationProbe clears the buffer and the mirror, and stops recording', () => {
        enableAnimationProbe();
        emitAnimationEvent({ kind: 'move', id: 'a' });
        expect(getAnimationProbeEvents()).toHaveLength(1);

        disableAnimationProbe();
        expect(isAnimationProbeEnabled()).toBe(false);
        expect(getAnimationProbeEvents()).toHaveLength(0);
        expect(probeGlobal().__notethinkAnimationEvents).toEqual([]);

        emitAnimationEvent({ kind: 'move', id: 'a' });
        expect(getAnimationProbeEvents()).toHaveLength(0);
    });

    it('clearAnimationProbeEvents empties the buffer + mirror but leaves the probe enabled', () => {
        enableAnimationProbe();
        emitAnimationEvent({ kind: 'enter', id: 'a' });
        clearAnimationProbeEvents();
        expect(getAnimationProbeEvents()).toHaveLength(0);
        expect(probeGlobal().__notethinkAnimationEvents).toEqual([]);
        expect(isAnimationProbeEnabled()).toBe(true);
        // still records after a clear
        emitAnimationEvent({ kind: 'enter', id: 'b' });
        expect(getAnimationProbeEvents()).toEqual([{ kind: 'enter', id: 'b' }]);
    });
});

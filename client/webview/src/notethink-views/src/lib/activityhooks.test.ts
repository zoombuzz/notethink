import { act, renderHook } from '@testing-library/react';
import { ACTIVITY_DEMAND_MESSAGE_TYPE, ACTIVITY_MESSAGE_TYPE, ACTIVITY_UNAVAILABLE_MESSAGE_TYPE, ACTIVITY_WITHDRAW_MESSAGE_TYPE, AGENT_SCAN_PENDING_KEY } from './agentactivityops';
import { readActivityDemanded, readActivitySnapshot, readActivityUnavailable, resetActivitySnapshot, subscribeToActivity, useAgentActivityDemand, useAgentScanPending } from './activityhooks';
import { PENDING_WORK_SAFETY_NET_MS } from '../hooks/usePendingWork';

/** post an extension message the way the host and the Playwright harness both do */
function postFromHost(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
}

afterEach(() => {
    resetActivitySnapshot();
});

describe('the activity store', () => {

    it('holds nothing until the host speaks, which is not the same as being told no producer is writing', () => {
        expect(readActivitySnapshot()).toBeUndefined();
        expect(readActivityUnavailable()).toBeUndefined();
    });

    it('attaches to the window on the first subscription and detaches with the last', () => {
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [] } });
        expect(readActivitySnapshot()).toBeUndefined();
        const unsubscribe = subscribeToActivity(() => {});
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [] } });
        expect(readActivitySnapshot()).toBeDefined();
        unsubscribe();
        resetActivitySnapshot();
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [] } });
        expect(readActivitySnapshot()).toBeUndefined();
    });

    it('tells a subscriber when a snapshot lands, and ignores every other message the host posts', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeToActivity(listener);
        postFromHost({ type: 'update', partial: { docs: {} } });
        postFromHost({ type: 'settingsCascade', settings: {} });
        expect(listener).not.toHaveBeenCalled();
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [], sessions: [], trees: [] } });
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('holds the host answer that a row request could not be carried out, separately from the snapshot', () => {
        const unsubscribe = subscribeToActivity(() => {});
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [] } });
        const snapshot = readActivitySnapshot();
        postFromHost({ type: ACTIVITY_UNAVAILABLE_MESSAGE_TYPE, request: 'diff', reason: 'not_listed', path: 'a.ts' });
        expect(readActivityUnavailable()).toEqual({ request: 'diff', reason: 'not_listed', path: 'a.ts', session_id: undefined });
        // a refusal is not a snapshot, so the board it is drawn over is untouched
        expect(readActivitySnapshot()).toBe(snapshot);
        unsubscribe();
    });

    it('keeps the snapshot identity between messages, so a subscriber re-renders only when one lands', () => {
        const unsubscribe = subscribeToActivity(() => {});
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [] } });
        const first = readActivitySnapshot();
        expect(readActivitySnapshot()).toBe(first);
        postFromHost({ type: 'update', partial: { docs: {} } });
        expect(readActivitySnapshot()).toBe(first);
        postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { producers: [], sessions: [] } });
        expect(readActivitySnapshot()).not.toBe(first);
        unsubscribe();
    });
});

describe('useAgentActivityDemand', () => {

    it('posts demand on the first mount, and nothing more for a second mounted caller', () => {
        const post_a = jest.fn();
        const post_b = jest.fn();
        const first = renderHook(() => useAgentActivityDemand(post_a));
        expect(post_a).toHaveBeenCalledTimes(1);
        expect(post_a).toHaveBeenCalledWith({ type: ACTIVITY_DEMAND_MESSAGE_TYPE });
        const second = renderHook(() => useAgentActivityDemand(post_b));
        expect(post_b).not.toHaveBeenCalled();
        first.unmount();
        second.unmount();
    });

    it('posts nothing when one of two mounted callers unmounts, and withdraws only when the last one does', () => {
        const post_a = jest.fn();
        const post_b = jest.fn();
        const first = renderHook(() => useAgentActivityDemand(post_a));
        const second = renderHook(() => useAgentActivityDemand(post_b));
        first.unmount();
        expect(post_a).not.toHaveBeenCalledWith({ type: ACTIVITY_WITHDRAW_MESSAGE_TYPE });
        expect(post_b).not.toHaveBeenCalledWith({ type: ACTIVITY_WITHDRAW_MESSAGE_TYPE });
        second.unmount();
        expect(post_b).toHaveBeenCalledWith({ type: ACTIVITY_WITHDRAW_MESSAGE_TYPE });
    });

    it('posts nothing at all, and never sticks the shared count, when post_message is missing', () => {
        const missing = renderHook(() => useAgentActivityDemand(undefined));
        missing.unmount();
        const post = jest.fn();
        const real = renderHook(() => useAgentActivityDemand(post));
        // a caller with no post_message never incremented the shared count, so this is still the first real demand
        expect(post).toHaveBeenCalledWith({ type: ACTIVITY_DEMAND_MESSAGE_TYPE });
        real.unmount();
        expect(post).toHaveBeenCalledWith({ type: ACTIVITY_WITHDRAW_MESSAGE_TYPE });
    });
});

describe('useAgentScanPending', () => {

    /** a pending-work api whose calls a test can read back */
    function pendingApi(): { markPending: jest.Mock; clearPending: jest.Mock } {
        return { markPending: jest.fn(), clearPending: jest.fn() };
    }

    it('marks nothing while no agent card in the panel has asked for activity', () => {
        const api = pendingApi();
        const scan = renderHook(() => useAgentScanPending(api));
        expect(readActivityDemanded()).toBe(false);
        expect(api.markPending).not.toHaveBeenCalled();
        scan.unmount();
    });

    it('holds the scan key from the first demand until the host says its first scan is done', () => {
        const api = pendingApi();
        const scan = renderHook(() => useAgentScanPending(api));
        const card = renderHook(() => useAgentActivityDemand(jest.fn()));
        // asked and not yet answered is waiting on the scan, which is the gap a card-type switch opens
        expect(api.markPending).toHaveBeenCalledWith(AGENT_SCAN_PENDING_KEY);
        act(() => { postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { analyser: { state: 'scanning', refusals: [] } } }); });
        expect(api.clearPending).not.toHaveBeenCalled();
        act(() => { postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { analyser: { state: 'live', refusals: [] } } }); });
        expect(api.clearPending).toHaveBeenCalledWith(AGENT_SCAN_PENDING_KEY);
        card.unmount();
        scan.unmount();
    });

    it('releases the key when the last agent card goes, even with a scanning snapshot left behind', () => {
        const api = pendingApi();
        const scan = renderHook(() => useAgentScanPending(api));
        const card = renderHook(() => useAgentActivityDemand(jest.fn()));
        act(() => { postFromHost({ type: ACTIVITY_MESSAGE_TYPE, activity: { analyser: { state: 'scanning', refusals: [] } } }); });
        act(() => { card.unmount(); });
        expect(api.clearPending).toHaveBeenCalledWith(AGENT_SCAN_PENDING_KEY);
        scan.unmount();
    });

    it('re-marks the key while a first scan outlasts the safety net, so a slow read keeps its spinner', () => {
        jest.useFakeTimers();
        try {
            const api = pendingApi();
            const scan = renderHook(() => useAgentScanPending(api));
            const card = renderHook(() => useAgentActivityDemand(jest.fn()));
            expect(api.markPending).toHaveBeenCalledTimes(1);
            act(() => { jest.advanceTimersByTime(PENDING_WORK_SAFETY_NET_MS); });
            expect(api.markPending).toHaveBeenCalledTimes(3);
            card.unmount();
            scan.unmount();
            act(() => { jest.advanceTimersByTime(PENDING_WORK_SAFETY_NET_MS); });
            expect(api.markPending).toHaveBeenCalledTimes(3);
        } finally {
            jest.useRealTimers();
        }
    });
});

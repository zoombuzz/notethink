import { ACTIVITY_MESSAGE_TYPE, ACTIVITY_UNAVAILABLE_MESSAGE_TYPE } from './agentactivityops';
import { readActivitySnapshot, readActivityUnavailable, resetActivitySnapshot, subscribeToActivity } from './activityhooks';

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

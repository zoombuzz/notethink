import { registerVirtualLane, unregisterVirtualLane, scrollVirtualLaneToNoteId, resetVirtualScrollRegistryForTests } from "./virtualScrollRegistry";

describe('virtualScrollRegistry', () => {
    afterEach(() => {
        resetVirtualScrollRegistryForTests();
    });

    it('scrolls the lane holding the requested note id', () => {
        const scrollToIndex = jest.fn();
        registerVirtualLane('v1', 'doing', { stable_ids: ['a', 'b', 'c'], scrollToIndex });
        const handled = scrollVirtualLaneToNoteId('v1', 'b');
        expect(handled).toBe(true);
        expect(scrollToIndex).toHaveBeenCalledWith(1);
    });

    it('checks every registered lane for the view until one holds the id', () => {
        const backlog_scroll = jest.fn();
        const doing_scroll = jest.fn();
        registerVirtualLane('v1', 'backlog', { stable_ids: ['x'], scrollToIndex: backlog_scroll });
        registerVirtualLane('v1', 'doing', { stable_ids: ['y'], scrollToIndex: doing_scroll });
        scrollVirtualLaneToNoteId('v1', 'y');
        expect(backlog_scroll).not.toHaveBeenCalled();
        expect(doing_scroll).toHaveBeenCalledWith(0);
    });

    it('returns false for a view with no registered lanes', () => {
        expect(scrollVirtualLaneToNoteId('unknown-view', 'a')).toBe(false);
    });

    it('returns false when the id is not in any registered lane', () => {
        registerVirtualLane('v1', 'doing', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        expect(scrollVirtualLaneToNoteId('v1', 'missing')).toBe(false);
    });

    it('replacing a registration updates what the next lookup sees', () => {
        registerVirtualLane('v1', 'doing', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        const next_scroll = jest.fn();
        registerVirtualLane('v1', 'doing', { stable_ids: ['a', 'b'], scrollToIndex: next_scroll });
        scrollVirtualLaneToNoteId('v1', 'b');
        expect(next_scroll).toHaveBeenCalledWith(1);
    });

    it('unregistering drops the lane so a later lookup misses', () => {
        registerVirtualLane('v1', 'doing', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        unregisterVirtualLane('v1', 'doing');
        expect(scrollVirtualLaneToNoteId('v1', 'a')).toBe(false);
    });

    it('unregistering one lane leaves a sibling lane registered', () => {
        const doing_scroll = jest.fn();
        registerVirtualLane('v1', 'backlog', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        registerVirtualLane('v1', 'doing', { stable_ids: ['b'], scrollToIndex: doing_scroll });
        unregisterVirtualLane('v1', 'backlog');
        expect(scrollVirtualLaneToNoteId('v1', 'b')).toBe(true);
        expect(doing_scroll).toHaveBeenCalledWith(0);
    });

    it('keeps different views isolated', () => {
        const v1_scroll = jest.fn();
        registerVirtualLane('v1', 'doing', { stable_ids: ['shared'], scrollToIndex: v1_scroll });
        expect(scrollVirtualLaneToNoteId('v2', 'shared')).toBe(false);
        expect(v1_scroll).not.toHaveBeenCalled();
    });
});

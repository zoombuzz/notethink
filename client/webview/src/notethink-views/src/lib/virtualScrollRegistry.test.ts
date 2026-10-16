import { registerVirtualGroup, unregisterVirtualGroup, scrollVirtualGroupToNoteId, resetVirtualScrollRegistryForTests } from "./virtualScrollRegistry";

describe('virtualScrollRegistry', () => {
    afterEach(() => {
        resetVirtualScrollRegistryForTests();
    });

    it('scrolls the group holding the requested note id', () => {
        const scrollToIndex = jest.fn();
        registerVirtualGroup('v1', 'doing', { stable_ids: ['a', 'b', 'c'], scrollToIndex });
        const handled = scrollVirtualGroupToNoteId('v1', 'b');
        expect(handled).toBe(true);
        expect(scrollToIndex).toHaveBeenCalledWith(1);
    });

    it('checks every registered group for the view until one holds the id', () => {
        const backlog_scroll = jest.fn();
        const doing_scroll = jest.fn();
        registerVirtualGroup('v1', 'backlog', { stable_ids: ['x'], scrollToIndex: backlog_scroll });
        registerVirtualGroup('v1', 'doing', { stable_ids: ['y'], scrollToIndex: doing_scroll });
        scrollVirtualGroupToNoteId('v1', 'y');
        expect(backlog_scroll).not.toHaveBeenCalled();
        expect(doing_scroll).toHaveBeenCalledWith(0);
    });

    it('returns false for a view with no registered groups', () => {
        expect(scrollVirtualGroupToNoteId('unknown-view', 'a')).toBe(false);
    });

    it('returns false when the id is not in any registered group', () => {
        registerVirtualGroup('v1', 'doing', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        expect(scrollVirtualGroupToNoteId('v1', 'missing')).toBe(false);
    });

    it('replacing a registration updates what the next lookup sees', () => {
        registerVirtualGroup('v1', 'doing', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        const next_scroll = jest.fn();
        registerVirtualGroup('v1', 'doing', { stable_ids: ['a', 'b'], scrollToIndex: next_scroll });
        scrollVirtualGroupToNoteId('v1', 'b');
        expect(next_scroll).toHaveBeenCalledWith(1);
    });

    it('unregistering drops the group so a later lookup misses', () => {
        registerVirtualGroup('v1', 'doing', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        unregisterVirtualGroup('v1', 'doing');
        expect(scrollVirtualGroupToNoteId('v1', 'a')).toBe(false);
    });

    it('unregistering one group leaves a sibling group registered', () => {
        const doing_scroll = jest.fn();
        registerVirtualGroup('v1', 'backlog', { stable_ids: ['a'], scrollToIndex: jest.fn() });
        registerVirtualGroup('v1', 'doing', { stable_ids: ['b'], scrollToIndex: doing_scroll });
        unregisterVirtualGroup('v1', 'backlog');
        expect(scrollVirtualGroupToNoteId('v1', 'b')).toBe(true);
        expect(doing_scroll).toHaveBeenCalledWith(0);
    });

    it('keeps different views isolated', () => {
        const v1_scroll = jest.fn();
        registerVirtualGroup('v1', 'doing', { stable_ids: ['shared'], scrollToIndex: v1_scroll });
        expect(scrollVirtualGroupToNoteId('v2', 'shared')).toBe(false);
        expect(v1_scroll).not.toHaveBeenCalled();
    });
});

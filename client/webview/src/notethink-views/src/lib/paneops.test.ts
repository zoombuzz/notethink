import {
    SPLIT_RATIO_DEFAULT,
    SPLIT_RATIO_MAX,
    SPLIT_RATIO_MIN,
    buildOpenPaneUpdate,
    clampSplitRatio,
    isSplitOpen,
    newPaneViewType,
} from './paneops';
import { PANE_VIEW_STATE_ID } from './viewstateops';

describe('clampSplitRatio', () => {
    it('keeps a ratio inside the bounds', () => {
        expect(clampSplitRatio(0.4)).toBe(0.4);
    });
    it('clamps a ratio past either bound', () => {
        expect(clampSplitRatio(0.01)).toBe(SPLIT_RATIO_MIN);
        expect(clampSplitRatio(0.99)).toBe(SPLIT_RATIO_MAX);
    });
    it('falls back to the default for a value that is not a finite number', () => {
        expect(clampSplitRatio(undefined)).toBe(SPLIT_RATIO_DEFAULT);
        expect(clampSplitRatio('0.3')).toBe(SPLIT_RATIO_DEFAULT);
        expect(clampSplitRatio(NaN)).toBe(SPLIT_RATIO_DEFAULT);
        expect(clampSplitRatio(Infinity)).toBe(SPLIT_RATIO_DEFAULT);
    });
});

describe('isSplitOpen', () => {
    it('is true only while the second pane has a view-state entry', () => {
        expect(isSplitOpen(['__folder__', PANE_VIEW_STATE_ID])).toBe(true);
        expect(isSplitOpen(['__folder__'])).toBe(false);
        expect(isSplitOpen(undefined)).toBe(false);
    });
});

describe('newPaneViewType', () => {
    it('opens a document beside a board, including a minted type descended from kanban', () => {
        expect(newPaneViewType('kanban')).toBe('document');
        const minted = [{ id: 'my-board', label: 'My board', parent: 'kanban', overrides: {} }];
        expect(newPaneViewType('my-board', minted)).toBe('document');
    });
    it('opens a board beside every other type', () => {
        expect(newPaneViewType('document')).toBe('kanban');
        expect(newPaneViewType('auto')).toBe('kanban');
    });
});

describe('buildOpenPaneUpdate', () => {
    it('targets only the second pane key and carries its type and the default ratio', () => {
        expect(buildOpenPaneUpdate('kanban')).toEqual({
            id: PANE_VIEW_STATE_ID,
            type: 'document',
            display_options: { split_ratio: SPLIT_RATIO_DEFAULT },
        });
    });
});

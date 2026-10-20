import { NODE_FILES, NODE_GLOBAL, registryWithUserTypes } from '../../lib/viewregistryops';
import { CARD_SETTING_ROWS, cardRowsForNode, globalSettingRows, orderRowsByOwner, rowHome, settingRowLabel, viewRowsForNode, VIEW_SETTING_ROWS } from './settingRows';

function keysFor(node_id: string): string[] {
    return viewRowsForNode(node_id).map(def => def.key);
}

function cardKeysFor(node_id: string): string[] {
    return cardRowsForNode(node_id).map(def => def.key);
}

describe('settingRows - the view pane', () => {

    it('never declares a row homed at a sentinel other than the globals, and never one for the type itself', () => {
        const homes = VIEW_SETTING_ROWS.map(rowHome);
        expect(homes).not.toContain(NODE_FILES);
        expect(VIEW_SETTING_ROWS.map(def => def.key)).not.toContain('viewType');
        expect(VIEW_SETTING_ROWS.map(def => def.key)).not.toContain('viewUserTypes');
        // NODE_GLOBAL is the one sentinel that does render, under its own heading and with no pill
        expect(homes).toContain(NODE_GLOBAL);
    });

    it('keeps every sentinel-homed row off every chain, so only the global group can surface one', () => {
        for (const node_id of ['kanban', 'line', 'grouped', 'document', 'root']) {
            const sentinel_rows = viewRowsForNode(node_id).map(rowHome).filter(home => [NODE_GLOBAL, NODE_FILES].includes(home));
            expect(sentinel_rows).toEqual([]);
        }
    });

    /*
     * Rows band by HOME in chain order: the selected node's own band first (if it homes any rows), then
     * each ancestor's, ending with root's ("All views"). kanban homes three rows of its own, then line's
     * orientation/lineBreadth, then grouped's group axis/order/display, then root's.
     */
    it('bands a kanban board by home, kanban then line then grouped then root', () => {
        expect(keysFor('kanban')).toEqual([
            'cardRatio',
            'animateTransitions',
            'defaultCardType',
            'orientation',
            'lineBreadth',
            'groupBy',
            'groupOrder',
            'groupDisplay',
            'scrollNoteIntoView',
        ]);
    });

    it('bands a line board by home, line then grouped then root - no kanban band at all', () => {
        expect(keysFor('line')).toEqual([
            'orientation',
            'lineBreadth',
            'groupBy',
            'groupOrder',
            'groupDisplay',
            'scrollNoteIntoView',
        ]);
    });

    it('resolves the group axis to one row, groupBy, home at grouped - there is no separate kanban-only key any more', () => {
        expect(keysFor('kanban')).toContain('groupBy');
        expect(keysFor('line')).toContain('groupBy');
        expect(keysFor('grouped')).toContain('groupBy');
        expect(VIEW_SETTING_ROWS.map(def => def.key)).not.toContain('kanbanGroupBy');
    });

    it('lists only the root rows for a document view, which owns nothing of its own', () => {
        expect(keysFor('document')).toEqual(['scrollNoteIntoView']);
    });

    /*
     * A minted type adds no row of its own - the row set is still decided by home, and a saved type
     * never homes a setting - so a minted type's rows are identical to its parent's, in the same bands,
     * whatever value the type itself holds for groupBy.
     */
    it('lists a minted type exactly like its parent, since banding is by home and a saved type homes nothing', () => {
        const registry = registryWithUserTypes([
            { id: 'user-kanban-by-assignee', label: 'Kanban by Assignee', parent: 'kanban', overrides: { groupBy: 'assignee' } },
        ]);
        const minted_keys = viewRowsForNode('user-kanban-by-assignee', registry).map(def => def.key);
        expect(minted_keys).toEqual(keysFor('kanban'));
    });

    it('answers with no rows for an id the registry does not know', () => {
        expect(keysFor('nonexistent')).toEqual([]);
    });

    it('keeps the global rows out of every chain and in their own group', () => {
        expect(globalSettingRows().map(def => def.key)).toEqual(['watchUnopenedFilesInViewer', 'openNewEditorIfNoneOpen']);
        expect(keysFor('kanban')).not.toContain('watchUnopenedFilesInViewer');
    });

    it('labels the group axis row', () => {
        expect(settingRowLabel('groupBy')).toBe('Group by');
        expect(settingRowLabel('orientation')).toBe('Orientation');
    });
});

describe('settingRows - the card pane', () => {

    it('declares the four card-drawn settings and nothing the view pane also claims', () => {
        expect(CARD_SETTING_ROWS.map(def => def.key)).toEqual([
            'showLinetagsInHeadlines',
            'autoExpandFocusedNote',
            'showLineNumbers',
            'clockMode',
        ]);
        const view_keys = VIEW_SETTING_ROWS.map(def => def.key);
        for (const def of CARD_SETTING_ROWS) {
            expect(view_keys).not.toContain(def.key);
        }
    });

    it('homes every card row on the card tree, so no view chain can surface one', () => {
        expect(CARD_SETTING_ROWS.map(rowHome)).toEqual(['allcards', 'allcards', 'allcards', 'agent']);
        for (const node_id of ['kanban', 'line', 'grouped', 'document', 'root']) {
            expect(keysFor(node_id)).toEqual(expect.not.arrayContaining(CARD_SETTING_ROWS.map(def => def.key)));
        }
    });

    it('lists every root-homed row whichever card node is selected, but the agent-homed row only from agent', () => {
        const root_rows = ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers'];
        expect(cardKeysFor('allcards')).toEqual(root_rows);
        expect(cardKeysFor('card')).toEqual(root_rows);
        expect(cardKeysFor('sticky')).toEqual(root_rows);
        // most-specific-first: clockMode is pilled to agent itself, deeper than the root rows' All cards pill
        expect(cardKeysFor('agent')).toEqual(['clockMode', ...root_rows]);
    });

    it('answers with no rows for a card id the registry does not know', () => {
        expect(cardKeysFor('nonexistent')).toEqual([]);
    });

    it('never renders the card type itself as a row - it is the tree radio, like the view type', () => {
        expect(CARD_SETTING_ROWS.map(def => def.key)).not.toContain('cardType');
    });
});


describe('settingRows - orderRowsByOwner', () => {

    const chain = ['user-next-up', 'kanban', 'line', 'grouped', 'root'];

    it('orders rows most specific owner first, keeping the incoming order within each owner', () => {
        const rows = [
            { key: 'cardRatio', owner_id: 'user-next-up' },
            { key: 'animateTransitions', owner_id: 'kanban' },
            { key: 'orientation', owner_id: 'line' },
            { key: 'lineBreadth', owner_id: 'user-next-up' },
            { key: 'groupBy', owner_id: 'user-next-up' },
            { key: 'groupOrder', owner_id: 'kanban' },
            { key: 'scrollNoteIntoView', owner_id: 'root' },
        ];
        expect(orderRowsByOwner(rows, chain).map(row => row.key)).toEqual([
            'cardRatio', 'lineBreadth', 'groupBy', 'animateTransitions', 'groupOrder', 'orientation', 'scrollNoteIntoView',
        ]);
    });

    it('sorts a row with no owner, or an owner off the chain, last', () => {
        const rows = [
            { key: 'global', owner_id: undefined },
            { key: 'stranger', owner_id: 'elsewhere' },
            { key: 'root', owner_id: 'root' },
        ];
        expect(orderRowsByOwner(rows, chain).map(row => row.key)).toEqual(['root', 'global', 'stranger']);
    });

    it('leaves the input array untouched', () => {
        const rows = [{ key: 'b', owner_id: 'root' }, { key: 'a', owner_id: 'kanban' }];
        orderRowsByOwner(rows, chain);
        expect(rows.map(row => row.key)).toEqual(['b', 'a']);
    });
});

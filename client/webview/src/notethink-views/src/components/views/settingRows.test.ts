import { NODE_FILES, NODE_GLOBAL, NODE_INTERNAL, registryWithUserTypes } from '../../lib/viewregistryops';
import { CARD_SETTING_ROWS, cardRowsForNode, globalSettingRows, rowHome, settingRowLabel, viewRowsForNode, VIEW_SETTING_ROWS } from './settingRows';

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
        expect(homes).not.toContain(NODE_INTERNAL);
        expect(VIEW_SETTING_ROWS.map(def => def.key)).not.toContain('viewType');
        expect(VIEW_SETTING_ROWS.map(def => def.key)).not.toContain('viewUserTypes');
        // NODE_GLOBAL is the one sentinel that does render, under its own heading and with no pill
        expect(homes).toContain(NODE_GLOBAL);
    });

    it('keeps every sentinel-homed row off every chain, so only the global group can surface one', () => {
        for (const node_id of ['kanban', 'line', 'grouped', 'document', 'root']) {
            const sentinel_rows = viewRowsForNode(node_id).map(rowHome).filter(home => [NODE_GLOBAL, NODE_FILES, NODE_INTERNAL].includes(home));
            expect(sentinel_rows).toEqual([]);
        }
    });

    /*
     * The order is the pill column read downwards, which is the tree upside down. Group by lands under
     * Orientation rather than above Group order because kanban PINS the lane axis rather than owning it,
     * so its pill says Grouped - and a row sorted anywhere other than where its own pill puts it reads as
     * a mistake to anyone looking at the two columns together.
     */
    it('orders a kanban board by the type each row is pilled to, kanban then line then grouped then root', () => {
        expect(keysFor('kanban')).toEqual([
            'columnOrder',
            'kanbanCardRatio',
            'kanbanAnimateTransitions',
            'orientation',
            'kanbanGroupBy',
            'scrollNoteIntoView',
        ]);
    });

    it('collapses the lane axis to one row, spelled kanbanGroupBy at kanban and groupBy above it', () => {
        expect(keysFor('kanban')).toContain('kanbanGroupBy');
        expect(keysFor('kanban')).not.toContain('groupBy');
        expect(keysFor('line')).toContain('groupBy');
        expect(keysFor('line')).not.toContain('kanbanGroupBy');
        expect(keysFor('grouped')).toContain('groupBy');
    });

    it('lists only the root rows for a document view, which owns nothing of its own', () => {
        expect(keysFor('document')).toEqual(['scrollNoteIntoView']);
    });

    /*
     * A minted type adds no row of its own - it inherits the whole chain - but it does change which type
     * one row belongs to, and the order follows that. Saving "Kanban by Assignee" makes the minted type
     * the owner of the lane axis, so Group by is pilled to it and rises to the top of the list from the
     * bottom, where kanban's pinned axis had put it.
     */
    it('lists a minted type as its parent plus nothing new, with the row it minted now leading', () => {
        const registry = registryWithUserTypes([
            { id: 'user-kanban-by-assignee', label: 'Kanban by Assignee', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee' } },
        ]);
        const minted_keys = viewRowsForNode('user-kanban-by-assignee', registry).map(def => def.key);
        expect([...minted_keys].sort()).toEqual([...keysFor('kanban')].sort());
        expect(minted_keys[0]).toBe('kanbanGroupBy');
    });

    it('answers with no rows for an id the registry does not know', () => {
        expect(keysFor('nonexistent')).toEqual([]);
    });

    it('keeps the global rows out of every chain and in their own group', () => {
        expect(globalSettingRows().map(def => def.key)).toEqual(['watchUnopenedFilesInViewer', 'openNewEditorIfNoneOpen']);
        expect(keysFor('kanban')).not.toContain('watchUnopenedFilesInViewer');
    });

    it('labels both spellings of the lane axis identically, so switching node does not rename the row', () => {
        expect(settingRowLabel('kanbanGroupBy')).toBe(settingRowLabel('groupBy'));
        expect(settingRowLabel('orientation')).toBe('Orientation');
    });
});

describe('settingRows - the card pane', () => {

    it('declares the three card-drawn settings and nothing the view pane also claims', () => {
        expect(CARD_SETTING_ROWS.map(def => def.key)).toEqual([
            'showLinetagsInHeadlines',
            'autoExpandFocusedNote',
            'showLineNumbers',
        ]);
        const view_keys = VIEW_SETTING_ROWS.map(def => def.key);
        for (const def of CARD_SETTING_ROWS) {
            expect(view_keys).not.toContain(def.key);
        }
    });

    it('homes every card row on the card tree, so no view chain can surface one', () => {
        expect(CARD_SETTING_ROWS.map(rowHome)).toEqual(['allcards', 'allcards', 'allcards']);
        for (const node_id of ['kanban', 'line', 'grouped', 'document', 'root']) {
            expect(keysFor(node_id)).toEqual(expect.not.arrayContaining(CARD_SETTING_ROWS.map(def => def.key)));
        }
    });

    it('lists every card row whichever card node is selected, since all three home at the root', () => {
        const expected = ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers'];
        expect(cardKeysFor('allcards')).toEqual(expected);
        expect(cardKeysFor('card')).toEqual(expected);
        expect(cardKeysFor('sticky')).toEqual(expected);
    });

    it('answers with no rows for a card id the registry does not know', () => {
        expect(cardKeysFor('nonexistent')).toEqual([]);
    });

    it('never renders the card type itself as a row - it is the tree radio, like the view type', () => {
        expect(CARD_SETTING_ROWS.map(def => def.key)).not.toContain('cardType');
    });
});

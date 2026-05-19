import {
    withinNoteHeadlineOrBody,
    withinNoteHeadlineOrBodyUpTo,
    findDeepestNote,
    findSelectedNotes,
    selectionSpans,
    aggregateNoteLinetags,
    noteIsVisible,
    resolveCaretPosition,
    findBodyItemElement,
    calculateTextChangesForCheckbox,
    standardNoteOrder,
    kanbanNoteOrder,
    makeNoteOrder,
    makeKanbanNoteOrder,
    findFirstIncompleteTaskSeq,
} from './noteops';
import type { NoteProps, TextSelection } from '../types/NoteProps';

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 1,
        children_body: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 50, line: 5 },
        },
        children: [],
        headline_raw: '# Test',
        body_raw: 'body text',
        ...overrides,
    };
}

describe('withinNoteHeadlineOrBody', () => {
    it('returns true for position within note', () => {
        const note = makeNote();
        expect(withinNoteHeadlineOrBody(5, note)).toBe(true);
        expect(withinNoteHeadlineOrBody(25, note)).toBe(true);
    });

    it('returns false for position outside note', () => {
        const note = makeNote();
        expect(withinNoteHeadlineOrBody(51, note)).toBe(false);
    });

    it('returns false for undefined position', () => {
        const note = makeNote();
        expect(withinNoteHeadlineOrBody(undefined, note)).toBe(false);
    });
});

describe('withinNoteHeadlineOrBodyUpTo', () => {
    it('returns true for position within limited range', () => {
        const note = makeNote();
        expect(withinNoteHeadlineOrBodyUpTo(5, note, 20)).toBe(true);
    });

    it('returns false for position beyond limit', () => {
        const note = makeNote();
        expect(withinNoteHeadlineOrBodyUpTo(25, note, 20)).toBe(false);
    });
});

describe('findDeepestNote', () => {
    it('finds the deepest note at a position', () => {
        const parent = makeNote({ seq: 1, level: 1 });
        const child = makeNote({
            seq: 2, level: 2,
            position: {
                start: { offset: 10, line: 2 },
                end: { offset: 20, line: 3 },
                end_body: { offset: 40, line: 4 },
            },
        });
        const result = findDeepestNote([parent, child], 15);
        expect(result?.seq).toBe(2);
    });

    it('returns undefined when no note contains position', () => {
        const note = makeNote();
        expect(findDeepestNote([note], 100)).toBeUndefined();
    });

    it('finds note when position equals end_body offset (inclusive boundary)', () => {
        const note = makeNote({
            seq: 1,
            position: {
                start: { offset: 0, line: 1 },
                end: { offset: 10, line: 1 },
                end_body: { offset: 50, line: 5 },
            },
        });
        expect(findDeepestNote([note], 50)?.seq).toBe(1);
    });

    it('returns undefined when position is one past end_body offset', () => {
        const note = makeNote({
            seq: 1,
            position: {
                start: { offset: 0, line: 1 },
                end: { offset: 10, line: 1 },
                end_body: { offset: 50, line: 5 },
            },
        });
        expect(findDeepestNote([note], 51)).toBeUndefined();
    });
});

describe('findSelectedNotes', () => {
    it('finds notes spanned by selection', () => {
        const note = makeNote({
            position: {
                start: { offset: 10, line: 2 },
                end: { offset: 20, line: 3 },
                end_body: { offset: 50, line: 5 },
            },
        });
        const selection = { main: { head: 60, anchor: 0 } };
        const result = findSelectedNotes([note], selection);
        expect(result).toHaveLength(1);
    });

    it('excludes notes not fully spanned', () => {
        const note = makeNote({
            position: {
                start: { offset: 10, line: 2 },
                end: { offset: 20, line: 3 },
                end_body: { offset: 50, line: 5 },
            },
        });
        const selection = { main: { head: 30, anchor: 15 } };
        const result = findSelectedNotes([note], selection);
        expect(result).toHaveLength(0);
    });
});

describe('aggregateNoteLinetags', () => {
    it('aggregates linetags from ancestor chain', () => {
        const parent = makeNote({
            seq: 1,
            linetags: {
                'ng_view': { key: 'ng_view', value: 'kanban', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const child = makeNote({
            seq: 2,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const result = aggregateNoteLinetags([parent, child]);
        expect(result['ng_view']?.value).toBe('kanban');
        expect(result['status']?.value).toBe('doing');
    });
});

describe('resolveCaretPosition', () => {
    it('returns the from position', () => {
        const ncp = { from: 42, to: 50, selection_from: undefined, selection_to: undefined, type: 'note_headline' };
        expect(resolveCaretPosition(ncp)).toBe(42);
    });
});

describe('standardNoteOrder', () => {
    it('sorts by seq primarily (the canonical reading / interleave order)', () => {
        // a has the LARGER document offset but the SMALLER seq — seq must win
        const a = makeNote({ seq: 1, position: { start: { offset: 900, line: 90 }, end: { offset: 910, line: 91 } } });
        const b = makeNote({ seq: 2, position: { start: { offset: 5, line: 1 }, end: { offset: 15, line: 2 } } });
        expect(standardNoteOrder(a, b)).toBeLessThan(0);
        expect(standardNoteOrder(b, a)).toBeGreaterThan(0);
    });

    it('tie-breaks on document offset when seqs are equal', () => {
        const a = makeNote({ seq: 4, position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 2 } } });
        const b = makeNote({ seq: 4, position: { start: { offset: 5, line: 1 }, end: { offset: 15, line: 2 } } });
        expect(standardNoteOrder(a, b)).toBeGreaterThan(0);
    });
});

describe('kanbanNoteOrder', () => {
    it('sorts by ordering weight when present', () => {
        const a = makeNote({
            seq: 1,
            linetags: {
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '2', value_numeric: 2, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const b = makeNote({
            seq: 2,
            linetags: {
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '1', value_numeric: 1, note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        expect(kanbanNoteOrder(a, b)).toBeGreaterThan(0);
    });

    it('falls back to merged seq (not document offset) when no weights', () => {
        // a has the LARGER document offset but the SMALLER merged seq — e.g. a
        // newest-at-bottom done.md story that mergeAggregateRoot reversed to the
        // top. seq must win so the newest story sorts first in its column.
        const a = makeNote({ seq: 1, position: { start: { offset: 900, line: 90 }, end: { offset: 920, line: 91 } } });
        const b = makeNote({ seq: 2, position: { start: { offset: 5, line: 1 }, end: { offset: 15, line: 2 } } });
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
        expect(kanbanNoteOrder(b, a)).toBeGreaterThan(0);
    });

    it('orders unweighted cards by ascending seq', () => {
        const first = makeNote({ seq: 3 });
        const second = makeNote({ seq: 7 });
        expect(kanbanNoteOrder(first, second)).toBeLessThan(0);
        const column = [makeNote({ seq: 7 }), makeNote({ seq: 2 }), makeNote({ seq: 5 })];
        expect(column.slice().sort(kanbanNoteOrder).map(n => n.seq)).toEqual([2, 5, 7]);
    });

    it('tie-breaks on document offset when seqs are equal', () => {
        const a = makeNote({ seq: 4, position: { start: { offset: 30, line: 3 }, end: { offset: 40, line: 4 } } });
        const b = makeNote({ seq: 4, position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 2 } } });
        expect(kanbanNoteOrder(a, b)).toBeGreaterThan(0);
    });

    it('sorts note with weight after note without weight', () => {
        const a = makeNote({
            seq: 1,
            linetags: {
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '1', value_numeric: 1, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const b = makeNote({ seq: 2 });
        expect(kanbanNoteOrder(a, b)).toBeGreaterThan(0);
    });

    it('sorts note without weight before note with weight', () => {
        const a = makeNote({ seq: 1 });
        const b = makeNote({
            seq: 2,
            linetags: {
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '1', value_numeric: 1, note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
    });

    it('uses seq as tiebreaker when weights are equal', () => {
        const a = makeNote({
            seq: 1,
            linetags: {
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '5', value_numeric: 5, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const b = makeNote({
            seq: 2,
            linetags: {
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '5', value_numeric: 5, note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
    });
});

describe('makeNoteOrder (relevance)', () => {
    function ranked(seq: number, doc_path: string, file_rank: number): NoteProps {
        return makeNote({
            seq,
            // distinct offsets so a pure offset/seq order would keep doc-order
            position: { start: { offset: seq * 100, line: seq }, end: { offset: seq * 100 + 10, line: seq } },
            origin: { doc_id: doc_path, doc_path, relative_path: doc_path, file_rank },
        });
    }

    it('with no context behaves exactly like standardNoteOrder', () => {
        const a = ranked(2, 'b/todo.md', 0);
        const b = ranked(1, 'a/todo.md', 0);
        const order = makeNoteOrder();
        expect(order(a, b)).toBe(standardNoteOrder(a, b));
        expect(order(b, a)).toBe(standardNoteOrder(b, a));
    });

    it('within equal rank, the active editor file sorts first', () => {
        // same rank 0, different files; stable order would put a/ before b/
        const a = ranked(1, 'a/todo.md', 0);
        const b = ranked(2, 'b/todo.md', 0);
        const order = makeNoteOrder({ active_doc_path: 'b/todo.md' });
        expect(order(a, b)).toBeGreaterThan(0); // b (active) first
        expect(order(b, a)).toBeLessThan(0);
    });

    it('does not lift an active-file story above a better (lower) rank', () => {
        const other_rank0 = ranked(1, 'a/todo.md', 0);
        const active_rank1 = ranked(2, 'b/todo.md', 1);
        const order = makeNoteOrder({ active_doc_path: 'b/todo.md' });
        // rank decides first: rank-0 other beats rank-1 active
        expect(order(other_rank0, active_rank1)).toBeLessThan(0);
        expect(order(active_rank1, other_rank0)).toBeGreaterThan(0);
    });

    it('falls back to stable file order when no story is from the active file', () => {
        const a = ranked(1, 'a/todo.md', 0);
        const b = ranked(2, 'b/todo.md', 0);
        const order = makeNoteOrder({ active_doc_path: 'z/none.md' });
        expect(order(a, b)).toBe(standardNoteOrder(a, b));
    });
});

describe('makeKanbanNoteOrder (relevance + weights)', () => {
    function ranked(seq: number, doc_path: string, file_rank: number, weight?: number): NoteProps {
        return makeNote({
            seq,
            position: { start: { offset: seq * 100, line: seq }, end: { offset: seq * 100 + 10, line: seq } },
            origin: { doc_id: doc_path, doc_path, relative_path: doc_path, file_rank },
            linetags: weight === undefined ? undefined : {
                'kanban_ordering_weight': {
                    key: 'kanban_ordering_weight', value: `${weight}`, value_numeric: weight,
                    note_seq: seq, key_offset: 0, value_offset: 0, linktext_offset: 0,
                },
            },
        });
    }

    it('explicit weight still wins over relevance', () => {
        const weighted_other = ranked(1, 'a/todo.md', 0, 1);
        const unweighted_active = ranked(2, 'b/todo.md', 0);
        const order = makeKanbanNoteOrder({ active_doc_path: 'b/todo.md' });
        // unweighted sorts before weighted regardless of relevance/rank
        expect(order(unweighted_active, weighted_other)).toBeLessThan(0);
        expect(order(weighted_other, unweighted_active)).toBeGreaterThan(0);
    });

    it('among unweighted same-rank cards the active file sorts first', () => {
        const a = ranked(1, 'a/todo.md', 0);
        const b = ranked(2, 'b/todo.md', 0);
        const order = makeKanbanNoteOrder({ active_doc_path: 'b/todo.md' });
        expect(order(a, b)).toBeGreaterThan(0);
        expect([a, b].slice().sort(order).map(n => n.origin?.doc_path)).toEqual(['b/todo.md', 'a/todo.md']);
    });
});

describe('selectionSpans', () => {
    it('returns true when forward selection fully spans range', () => {
        const selection: TextSelection = { main: { anchor: 0, head: 100 } };
        expect(selectionSpans(selection, 10, 50)).toBe(true);
    });

    it('returns true when reverse selection fully spans range', () => {
        const selection: TextSelection = { main: { anchor: 100, head: 0 } };
        expect(selectionSpans(selection, 10, 50)).toBe(true);
    });

    it('returns false when selection only partially covers range', () => {
        const selection: TextSelection = { main: { anchor: 20, head: 40 } };
        expect(selectionSpans(selection, 10, 50)).toBe(false);
    });

    it('returns false for undefined selection', () => {
        expect(selectionSpans(undefined, 10, 50)).toBe(false);
    });

    it('returns false for undefined from or to', () => {
        const selection: TextSelection = { main: { anchor: 0, head: 100 } };
        expect(selectionSpans(selection, undefined, 50)).toBe(false);
        expect(selectionSpans(selection, 10, undefined)).toBe(false);
    });
});

describe('noteIsVisible', () => {
    function mockElement(rect: { top: number; bottom: number; left: number; right: number }): HTMLElement {
        return {
            getBoundingClientRect: () => rect,
        } as unknown as HTMLElement;
    }

    it('returns true for partially visible element (default)', () => {
        const note = mockElement({ top: 50, bottom: 150, left: 0, right: 100 });
        const view = mockElement({ top: 100, bottom: 300, left: 0, right: 200 });
        expect(noteIsVisible(note, view)).toBe(true);
    });

    it('returns false for element fully above the view', () => {
        const note = mockElement({ top: 0, bottom: 50, left: 0, right: 100 });
        const view = mockElement({ top: 100, bottom: 300, left: 0, right: 200 });
        expect(noteIsVisible(note, view)).toBe(false);
    });

    it('returns false for element fully below the view', () => {
        const note = mockElement({ top: 400, bottom: 500, left: 0, right: 100 });
        const view = mockElement({ top: 100, bottom: 300, left: 0, right: 200 });
        expect(noteIsVisible(note, view)).toBe(false);
    });

    it('returns true for fully visible element with partial_visibility=false', () => {
        const note = mockElement({ top: 110, bottom: 200, left: 10, right: 100 });
        const view = mockElement({ top: 100, bottom: 300, left: 0, right: 200 });
        expect(noteIsVisible(note, view, false)).toBe(true);
    });

    it('returns false for partially visible element with partial_visibility=false', () => {
        const note = mockElement({ top: 50, bottom: 150, left: 0, right: 100 });
        const view = mockElement({ top: 100, bottom: 300, left: 0, right: 200 });
        expect(noteIsVisible(note, view, false)).toBe(false);
    });
});

describe('calculateTextChangesForCheckbox', () => {
    it('generates change to check a checkbox', () => {
        const note = makeNote({
            body_raw: '- [ ] buy milk\n- [ ] buy eggs',
            position: {
                start: { offset: 0, line: 1 },
                end: { offset: 10, line: 1 },
                end_body: { offset: 40, line: 3 },
            },
        });
        const changes = calculateTextChangesForCheckbox(note, true, ' buy milk', []);
        expect(changes).toHaveLength(1);
        expect(changes[0].insert).toBe('X');
    });

    it('generates change to uncheck a checkbox', () => {
        const note = makeNote({
            body_raw: '- [x] buy milk\n- [ ] buy eggs',
            position: {
                start: { offset: 0, line: 1 },
                end: { offset: 10, line: 1 },
                end_body: { offset: 40, line: 3 },
            },
        });
        const changes = calculateTextChangesForCheckbox(note, false, ' buy milk', []);
        expect(changes).toHaveLength(1);
        expect(changes[0].insert).toBe(' ');
    });

    it('returns empty array when checkbox text not found', () => {
        const note = makeNote({
            body_raw: '- [ ] buy milk',
            position: {
                start: { offset: 0, line: 1 },
                end: { offset: 10, line: 1 },
                end_body: { offset: 25, line: 2 },
            },
        });
        const changes = calculateTextChangesForCheckbox(note, true, ' nonexistent', []);
        expect(changes).toHaveLength(0);
    });
});

describe('findBodyItemElement', () => {
    function makeContainer(): HTMLDivElement {
        const container = document.createElement('div');
        const item1 = document.createElement('div');
        item1.dataset.offsetStart = '10';
        item1.dataset.offsetEnd = '50';
        const item2 = document.createElement('div');
        item2.dataset.offsetStart = '55';
        item2.dataset.offsetEnd = '120';
        container.appendChild(item1);
        container.appendChild(item2);
        return container;
    }

    it('returns the element whose offset range contains the caret', () => {
        const container = makeContainer();
        const result = findBodyItemElement(container, 30);
        expect(result).toBeTruthy();
        expect(result?.dataset.offsetStart).toBe('10');
    });

    it('returns the second element when caret is in that range', () => {
        const container = makeContainer();
        const result = findBodyItemElement(container, 80);
        expect(result).toBeTruthy();
        expect(result?.dataset.offsetStart).toBe('55');
    });

    it('returns undefined when caret is outside all ranges', () => {
        const container = makeContainer();
        expect(findBodyItemElement(container, 5)).toBeUndefined();
        expect(findBodyItemElement(container, 200)).toBeUndefined();
    });

    it('returns the element when caret is at boundary (start)', () => {
        const container = makeContainer();
        const result = findBodyItemElement(container, 10);
        expect(result?.dataset.offsetStart).toBe('10');
    });

    it('returns the element when caret is at boundary (end)', () => {
        const container = makeContainer();
        const result = findBodyItemElement(container, 50);
        expect(result?.dataset.offsetStart).toBe('10');
    });

    it('returns undefined for an empty container', () => {
        const container = document.createElement('div');
        expect(findBodyItemElement(container, 10)).toBeUndefined();
    });
});

describe('findFirstIncompleteTaskSeq', () => {
    function makeListItem(seq: number, checked: boolean | undefined): NoteProps {
        return makeNote({ seq, type: 'listItem', checked, children_body: [] });
    }

    function makeList(seq: number, items: NoteProps[]): NoteProps {
        return makeNote({ seq, type: 'list', children_body: items });
    }

    it('returns undefined for empty children_body', () => {
        expect(findFirstIncompleteTaskSeq([])).toBeUndefined();
    });

    it('returns undefined when no tasks exist', () => {
        const items = [makeNote({ seq: 1, type: 'paragraph', children_body: [] })];
        expect(findFirstIncompleteTaskSeq(items)).toBeUndefined();
    });

    it('returns undefined when all tasks are complete', () => {
        const list = makeList(1, [
            makeListItem(2, true),
            makeListItem(3, true),
        ]);
        expect(findFirstIncompleteTaskSeq([list])).toBeUndefined();
    });

    it('returns seq of first incomplete task', () => {
        const list = makeList(1, [
            makeListItem(2, true),
            makeListItem(3, false),
            makeListItem(4, false),
        ]);
        expect(findFirstIncompleteTaskSeq([list])).toBe(3);
    });

    it('returns seq of first incomplete when all are incomplete', () => {
        const list = makeList(1, [
            makeListItem(2, false),
            makeListItem(3, false),
        ]);
        expect(findFirstIncompleteTaskSeq([list])).toBe(2);
    });

    it('finds incomplete task in nested lists', () => {
        const inner_list = makeList(3, [
            makeListItem(4, true),
            makeListItem(5, false),
        ]);
        const outer_list = makeList(1, [
            makeListItem(2, true),
            makeNote({ seq: 6, type: 'listItem', checked: true, children_body: [inner_list] }),
        ]);
        expect(findFirstIncompleteTaskSeq([outer_list])).toBe(5);
    });

    it('skips MdastNode items without seq', () => {
        const mdast_node = { type: 'paragraph', position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } }, children: [] };
        const list = makeList(1, [makeListItem(2, false)]);
        expect(findFirstIncompleteTaskSeq([mdast_node as never, list])).toBe(2);
    });

    it('skips listItems without checked property', () => {
        const list = makeList(1, [
            makeListItem(2, undefined),
            makeListItem(3, false),
        ]);
        expect(findFirstIncompleteTaskSeq([list])).toBe(3);
    });
});

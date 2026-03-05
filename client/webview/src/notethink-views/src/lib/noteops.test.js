import { withinNoteHeadlineOrBody, withinNoteHeadlineOrBodyUpTo, findDeepestNote, findSelectedNotes, selectionSpans, aggregateNoteLinetags, noteIsVisible, resolveCaretPosition, calculateTextChangesForCheckbox, standardNoteOrder, kanbanNoteOrder, } from './noteops';
function makeNote(overrides = {}) {
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
    it('sorts by offset', () => {
        const a = makeNote({ position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 2 } } });
        const b = makeNote({ position: { start: { offset: 5, line: 1 }, end: { offset: 15, line: 2 } } });
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
    it('falls back to standardNoteOrder when no weights', () => {
        const a = makeNote({ seq: 1, position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 2 } } });
        const b = makeNote({ seq: 2, position: { start: { offset: 5, line: 1 }, end: { offset: 15, line: 2 } } });
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
describe('selectionSpans', () => {
    it('returns true when forward selection fully spans range', () => {
        const selection = { main: { anchor: 0, head: 100 } };
        expect(selectionSpans(selection, 10, 50)).toBe(true);
    });
    it('returns true when reverse selection fully spans range', () => {
        const selection = { main: { anchor: 100, head: 0 } };
        expect(selectionSpans(selection, 10, 50)).toBe(true);
    });
    it('returns false when selection only partially covers range', () => {
        const selection = { main: { anchor: 20, head: 40 } };
        expect(selectionSpans(selection, 10, 50)).toBe(false);
    });
    it('returns false for undefined selection', () => {
        expect(selectionSpans(undefined, 10, 50)).toBe(false);
    });
    it('returns false for undefined from or to', () => {
        const selection = { main: { anchor: 0, head: 100 } };
        expect(selectionSpans(selection, undefined, 50)).toBe(false);
        expect(selectionSpans(selection, 10, undefined)).toBe(false);
    });
});
describe('noteIsVisible', () => {
    function mockElement(rect) {
        return {
            getBoundingClientRect: () => rect,
        };
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
        expect(changes[0].insert).toBe('x');
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

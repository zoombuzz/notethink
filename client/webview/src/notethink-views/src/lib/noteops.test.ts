import {
    arraysEqual,
    deriveNaturalColumnOrder,
    withinNoteHeadlineOrBody,
    withinNoteHeadlineOrBodyUpTo,
    findDeepestNote,
    findDeepestNoteByOriginPosition,
    findSelectedNotes,
    findSelectedNotesByOriginPosition,
    flattenAllNotes,
    isAggregateRoot,
    majorityNgView,
    navigateToNeighbour,
    resolveFocusedNote,
    selectionSpans,
    aggregateNoteLinetags,
    noteIsVisible,
    resolveCaretPosition,
    findBodyItemElement,
    calculateTextChangesForCheckbox,
    standardNoteOrder,
    focusedChainIdsFor,
    kanbanNoteOrder,
    kanbanColumnValue,
    notesInKanbanColumn,
    kanbanDraggableId,
    noteOrder,
    findFirstIncompleteTaskSeq,
    formatColumnLabel,
    findStableIdCollisions,
    collisionNoteLocation,
    breadcrumbSeqForLabel,
} from './noteops';
import type { NoteProps, NoteOrigin, TextSelection, LineTag } from '../types/NoteProps';

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

describe('breadcrumbSeqForLabel', () => {
    // the matching paragraph (seq 1) precedes the matching heading (seq 2) so the heading-only guard is load-bearing: without it, first-match iteration would return the paragraph's seq 1 instead of 2
    const notes: NoteProps[] = [
        makeNote({ seq: 0, type: 'root', headline_raw: '' }),
        makeNote({ seq: 1, type: 'paragraph', headline_raw: 'Backend' }),
        makeNote({ seq: 2, type: 'heading', headline_raw: '## Backend [](?id=be)' }),
        makeNote({ seq: 3, type: 'heading', headline_raw: '### Wire alerts' }),
    ];

    it('returns the seq of the heading whose stripped headline matches the label', () => {
        expect(breadcrumbSeqForLabel('Backend', notes)).toBe(2);
        expect(breadcrumbSeqForLabel('Wire alerts', notes)).toBe(3);
    });

    it('ignores non-heading notes that happen to match (heading at seq 2 wins over paragraph at seq 1)', () => {
        expect(breadcrumbSeqForLabel('Backend', notes)).toBe(2);
    });

    it('returns undefined for an unmatched label, empty label, or empty list', () => {
        expect(breadcrumbSeqForLabel('Missing', notes)).toBeUndefined();
        expect(breadcrumbSeqForLabel('', notes)).toBeUndefined();
        expect(breadcrumbSeqForLabel('Backend', undefined)).toBeUndefined();
    });
});

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
                'nt_kanban_ordering_weight': { key: 'nt_kanban_ordering_weight', value: '2', value_numeric: 2, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const b = makeNote({
            seq: 2,
            linetags: {
                'nt_kanban_ordering_weight': { key: 'nt_kanban_ordering_weight', value: '1', value_numeric: 1, note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        expect(kanbanNoteOrder(a, b)).toBeGreaterThan(0);
    });

    it('falls back to merged seq (not document offset) when no weights', () => {
        // a has the LARGER document offset but the SMALLER merged seq — e.g. a newest-at-bottom done.md story that mergeAggregateRoot reversed to the top. seq must win so the newest story sorts first in its column.
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
                'nt_kanban_ordering_weight': { key: 'nt_kanban_ordering_weight', value: '1', value_numeric: 1, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
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
                'nt_kanban_ordering_weight': { key: 'nt_kanban_ordering_weight', value: '1', value_numeric: 1, note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
    });

    it('uses seq as tiebreaker when weights are equal', () => {
        const a = makeNote({
            seq: 1,
            linetags: {
                'nt_kanban_ordering_weight': { key: 'nt_kanban_ordering_weight', value: '5', value_numeric: 5, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const b = makeNote({
            seq: 2,
            linetags: {
                'nt_kanban_ordering_weight': { key: 'nt_kanban_ordering_weight', value: '5', value_numeric: 5, note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
    });
});

describe('kanbanColumnValue', () => {
    it('returns the status linetag value when present', () => {
        const note = makeNote({
            linetags: { 'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 } },
        });
        expect(kanbanColumnValue(note)).toBe('doing');
    });

    it('returns untagged when the note has no status linetag', () => {
        expect(kanbanColumnValue(makeNote())).toBe('untagged');
    });

    it('treats an empty status value as untagged', () => {
        const note = makeNote({
            linetags: { 'status': { key: 'status', value: '', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 } },
        });
        expect(kanbanColumnValue(note)).toBe('untagged');
    });
});

describe('notesInKanbanColumn', () => {
    function statusNote(seq: number, value: string, weight?: number): NoteProps {
        const linetags: NoteProps['linetags'] = {
            'status': { key: 'status', value, note_seq: seq, key_offset: 0, value_offset: 0, linktext_offset: 0 },
        };
        if (weight !== undefined) {
            linetags['nt_kanban_ordering_weight'] = { key: 'nt_kanban_ordering_weight', value: String(weight), value_numeric: weight, note_seq: seq, key_offset: 0, value_offset: 0, linktext_offset: 0 };
        }
        return makeNote({ seq, linetags });
    }

    it('selects only notes in the requested column', () => {
        const notes = [statusNote(1, 'doing'), statusNote(2, 'done'), statusNote(3, 'doing')];
        const result = notesInKanbanColumn(notes, 'doing');
        expect(result.map(n => n.seq)).toEqual([1, 3]);
    });

    it('puts notes with no status into the untagged column', () => {
        const notes = [makeNote({ seq: 1 }), statusNote(2, 'done')];
        expect(notesInKanbanColumn(notes, 'untagged').map(n => n.seq)).toEqual([1]);
    });

    it('orders members by kanbanNoteOrder (weights decisive)', () => {
        const notes = [statusNote(1, 'done', 2), statusNote(2, 'done', 1)];
        expect(notesInKanbanColumn(notes, 'done').map(n => n.seq)).toEqual([2, 1]);
    });
});

describe('kanbanDraggableId', () => {
    it('prefers stable_id when present', () => {
        const note = makeNote({ seq: 7, stable_id: 'doc-1:my-story' });
        expect(kanbanDraggableId(note)).toBe('doc-1:my-story');
    });

    it('falls back to the seq string when stable_id is absent', () => {
        const note = makeNote({ seq: 7 });
        expect(kanbanDraggableId(note)).toBe('7');
    });
});

describe('noteOrder (relevance)', () => {
    function ranked(seq: number, doc_path: string, file_rank: number, file_mtime?: number): NoteProps {
        return makeNote({
            seq,
            // distinct offsets so a pure offset/seq order would keep doc-order
            position: { start: { offset: seq * 100, line: seq }, end: { offset: seq * 100 + 10, line: seq } },
            origin: { doc_id: doc_path, doc_path, relative_path: doc_path, file_rank, file_mtime },
        });
    }

    it('without file_mtime behaves exactly like standardNoteOrder', () => {
        const a = ranked(2, 'b/todo.md', 0);
        const b = ranked(1, 'a/todo.md', 0);
        expect(noteOrder(a, b)).toBe(standardNoteOrder(a, b));
        expect(noteOrder(b, a)).toBe(standardNoteOrder(b, a));
    });

    it('within equal rank, the more recently modified file sorts first', () => {
        // same rank 0, different files; stable seq order would put a/ before b/
        const a = ranked(1, 'a/todo.md', 0, 1_000);
        const b = ranked(2, 'b/todo.md', 0, 2_000);
        // b (newer mtime) first
        expect(noteOrder(a, b)).toBeGreaterThan(0);
        expect(noteOrder(b, a)).toBeLessThan(0);
    });

    it('does not lift a newer-mtime story above one with a better (lower) rank', () => {
        const older_rank0 = ranked(1, 'a/todo.md', 0, 1_000);
        const newer_rank1 = ranked(2, 'b/todo.md', 1, 9_000);
        // rank decides first: rank-0 beats rank-1 regardless of mtime
        expect(noteOrder(older_rank0, newer_rank1)).toBeLessThan(0);
        expect(noteOrder(newer_rank1, older_rank0)).toBeGreaterThan(0);
    });

    it('falls back to stable seq order when both mtimes are equal', () => {
        const a = ranked(1, 'a/todo.md', 0, 5_000);
        const b = ranked(2, 'b/todo.md', 0, 5_000);
        expect(noteOrder(a, b)).toBe(standardNoteOrder(a, b));
    });

    it('falls back to stable seq order when only one story has an mtime', () => {
        const a = ranked(1, 'a/todo.md', 0, 5_000);
        const b = ranked(2, 'b/todo.md', 0);
        expect(noteOrder(a, b)).toBe(standardNoteOrder(a, b));
    });
});

describe('kanbanNoteOrder cross-file', () => {
    function makeCrossFileNote(seq: number, doc_path: string, file_rank: number, file_mtime?: number, weight?: number): NoteProps {
        return makeNote({
            seq,
            position: { start: { offset: seq * 100, line: seq }, end: { offset: seq * 100 + 10, line: seq } },
            origin: { doc_id: doc_path, doc_path, relative_path: doc_path, file_rank, file_mtime },
            linetags: weight === undefined ? undefined : {
                'nt_kanban_ordering_weight': {
                    key: 'nt_kanban_ordering_weight', value: `${weight}`, value_numeric: weight,
                    note_seq: seq, key_offset: 0, value_offset: 0, linktext_offset: 0,
                },
            },
        });
    }

    it('(weighted, weighted) across two origins: weight is decisive', () => {
        // a has weight 1 on file-a; b has weight 2 on file-b. weight-1 should sort first regardless of file_rank/file_mtime ordering.
        const a = makeCrossFileNote(5, 'a.md', 5, 1_000, 1);
        const b = makeCrossFileNote(1, 'b.md', 0, 9_000, 2);
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
        expect(kanbanNoteOrder(b, a)).toBeGreaterThan(0);
    });

    it('(weighted, weighted) ties broken by seq only — file_rank/file_mtime ignored', () => {
        // same weight, different origins; a has worse rank and older mtime but smaller seq → a wins
        const a = makeCrossFileNote(1, 'a.md', 5, 1_000, 7);
        const b = makeCrossFileNote(2, 'b.md', 0, 9_000, 7);
        expect(kanbanNoteOrder(a, b)).toBeLessThan(0);
        expect(kanbanNoteOrder(b, a)).toBeGreaterThan(0);
    });

    it('(weighted, unweighted) across origins: unweighted sorts before weighted', () => {
        const weighted = makeCrossFileNote(1, 'a.md', 0, 9_000, 5);
        const unweighted = makeCrossFileNote(2, 'b.md', 5, 1_000);
        expect(kanbanNoteOrder(weighted, unweighted)).toBeGreaterThan(0);
        expect(kanbanNoteOrder(unweighted, weighted)).toBeLessThan(0);
    });

    it('(unweighted, weighted) across origins: unweighted sorts before weighted', () => {
        const unweighted = makeCrossFileNote(1, 'a.md', 5, 1_000);
        const weighted = makeCrossFileNote(2, 'b.md', 0, 9_000, 5);
        expect(kanbanNoteOrder(unweighted, weighted)).toBeLessThan(0);
        expect(kanbanNoteOrder(weighted, unweighted)).toBeGreaterThan(0);
    });

    it('(unweighted, unweighted) across origins: falls through to noteOrder', () => {
        // same rank → newer mtime first
        const older = makeCrossFileNote(1, 'a.md', 0, 1_000);
        const newer = makeCrossFileNote(2, 'b.md', 0, 9_000);
        expect(kanbanNoteOrder(older, newer)).toBeGreaterThan(0);
        expect(kanbanNoteOrder(newer, older)).toBeLessThan(0);

        // same rank, same mtime → seq decides
        const first = makeCrossFileNote(1, 'a.md', 0, 5_000);
        const second = makeCrossFileNote(2, 'b.md', 0, 5_000);
        expect(kanbanNoteOrder(first, second)).toBeLessThan(0);
        expect(kanbanNoteOrder(second, first)).toBeGreaterThan(0);

        // rank only gates the mtime tiebreak; when ranks differ noteOrder falls through to seq order
        const seq1_rank5 = makeCrossFileNote(1, 'a.md', 5);
        const seq2_rank0 = makeCrossFileNote(2, 'b.md', 0);
        expect(kanbanNoteOrder(seq1_rank5, seq2_rank0)).toBeLessThan(0);
        expect(kanbanNoteOrder(seq2_rank0, seq1_rank5)).toBeGreaterThan(0);
    });

    it('weight value (not seq) determines order when both are weighted across files', () => {
        // smaller seq but larger weight: the LARGER weight sorts LATER (i.e. b sorts later)
        const a = makeCrossFileNote(1, 'a.md', 0, 5_000, 50);
        const b = makeCrossFileNote(2, 'b.md', 0, 5_000, 10);
        // b has smaller weight → b sorts first
        expect(kanbanNoteOrder(a, b)).toBeGreaterThan(0);
        expect(kanbanNoteOrder(b, a)).toBeLessThan(0);
    });
});

describe('kanbanNoteOrder (relevance + weights)', () => {
    function ranked(seq: number, doc_path: string, file_rank: number, file_mtime?: number, weight?: number): NoteProps {
        return makeNote({
            seq,
            position: { start: { offset: seq * 100, line: seq }, end: { offset: seq * 100 + 10, line: seq } },
            origin: { doc_id: doc_path, doc_path, relative_path: doc_path, file_rank, file_mtime },
            linetags: weight === undefined ? undefined : {
                'nt_kanban_ordering_weight': {
                    key: 'nt_kanban_ordering_weight', value: `${weight}`, value_numeric: weight,
                    note_seq: seq, key_offset: 0, value_offset: 0, linktext_offset: 0,
                },
            },
        });
    }

    it('explicit weight still wins over relevance', () => {
        const weighted_older = ranked(1, 'a/todo.md', 0, 1_000, 1);
        const unweighted_newer = ranked(2, 'b/todo.md', 0, 9_000);
        // unweighted sorts before weighted regardless of relevance/rank
        expect(kanbanNoteOrder(unweighted_newer, weighted_older)).toBeLessThan(0);
        expect(kanbanNoteOrder(weighted_older, unweighted_newer)).toBeGreaterThan(0);
    });

    it('among unweighted same-rank cards the more recently modified file sorts first', () => {
        const a = ranked(1, 'a/todo.md', 0, 1_000);
        const b = ranked(2, 'b/todo.md', 0, 9_000);
        expect(kanbanNoteOrder(a, b)).toBeGreaterThan(0);
        expect([a, b].slice().sort(kanbanNoteOrder).map(n => n.origin?.doc_path)).toEqual(['b/todo.md', 'a/todo.md']);
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

describe('formatColumnLabel', () => {
    it('replaces dashes with spaces and title-cases each word', () => {
        expect(formatColumnLabel('code-review')).toBe('Code Review');
    });

    it('handles single-word slugs', () => {
        expect(formatColumnLabel('todo')).toBe('Todo');
        expect(formatColumnLabel('done')).toBe('Done');
    });

    it('handles multi-dash slugs', () => {
        expect(formatColumnLabel('in-progress-review')).toBe('In Progress Review');
    });

    it('preserves existing spaces and title-cases each word', () => {
        expect(formatColumnLabel('code review')).toBe('Code Review');
    });

    it('mixes dashes and spaces', () => {
        expect(formatColumnLabel('blocked on-customer')).toBe('Blocked On Customer');
    });

    it('returns empty string for empty input', () => {
        expect(formatColumnLabel('')).toBe('');
    });

    it('collapses repeated dashes into single-space-separated words', () => {
        expect(formatColumnLabel('foo--bar')).toBe('Foo Bar');
    });

    it('leaves an already-title-cased string title-cased', () => {
        expect(formatColumnLabel('Done')).toBe('Done');
    });

    it('preserves the canonical "untagged" bucket label as Untagged', () => {
        expect(formatColumnLabel('untagged')).toBe('Untagged');
    });
});

describe('findDeepestNoteByOriginPosition', () => {
    function noteWithOrigin(seq: number, doc_path: string, sp_start: number, sp_end: number, sp_end_body?: number): NoteProps {
        const origin: NoteOrigin = {
            doc_id: doc_path,
            doc_path,
            source_position: {
                start: { offset: sp_start, line: 1 },
                end: { offset: sp_end, line: 2 },
                end_body: sp_end_body === undefined ? undefined : { offset: sp_end_body, line: 3 },
            },
        };
        return makeNote({ seq, origin });
    }

    it('returns the deepest (latest-start) same-doc note that contains the caret', () => {
        const outer = noteWithOrigin(1, '/repo/a.md', 0, 20, 100);
        const inner = noteWithOrigin(2, '/repo/a.md', 30, 40, 80);
        const result = findDeepestNoteByOriginPosition([outer, inner], '/repo/a.md', 35);
        expect(result?.seq).toBe(2);
    });

    it('returns undefined when no same-doc note has source_position', () => {
        const note = makeNote({ seq: 1 });
        expect(findDeepestNoteByOriginPosition([note], '/repo/a.md', 5)).toBeUndefined();
    });

    it('returns undefined when the active doc does not match any note origin', () => {
        const note = noteWithOrigin(1, '/repo/a.md', 0, 20, 50);
        expect(findDeepestNoteByOriginPosition([note], '/repo/b.md', 10)).toBeUndefined();
    });

    it('falls back to end.offset when end_body is absent', () => {
        const note = noteWithOrigin(1, '/repo/a.md', 0, 20);
        expect(findDeepestNoteByOriginPosition([note], '/repo/a.md', 15)?.seq).toBe(1);
        expect(findDeepestNoteByOriginPosition([note], '/repo/a.md', 25)).toBeUndefined();
    });
});

describe('findSelectedNotesByOriginPosition', () => {
    function noteWithOrigin(seq: number, doc_path: string, sp_start: number, sp_end_body: number): NoteProps {
        return makeNote({
            seq,
            origin: {
                doc_id: doc_path,
                doc_path,
                source_position: {
                    start: { offset: sp_start, line: 1 },
                    end: { offset: sp_end_body, line: 2 },
                    end_body: { offset: sp_end_body, line: 2 },
                },
            },
        });
    }

    it('returns notes whose source_position is fully spanned by the selection', () => {
        const a = noteWithOrigin(1, '/repo/a.md', 10, 50);
        const b = noteWithOrigin(2, '/repo/a.md', 60, 90);
        const result = findSelectedNotesByOriginPosition([a, b], '/repo/a.md', 0, 100);
        expect(result.map(n => n.seq).sort()).toEqual([1, 2]);
    });

    it('handles reverse selection (head before anchor)', () => {
        const a = noteWithOrigin(1, '/repo/a.md', 10, 50);
        const result = findSelectedNotesByOriginPosition([a], '/repo/a.md', 100, 0);
        expect(result).toHaveLength(1);
    });

    it('excludes notes only partially covered by the selection', () => {
        const a = noteWithOrigin(1, '/repo/a.md', 10, 50);
        const result = findSelectedNotesByOriginPosition([a], '/repo/a.md', 20, 40);
        expect(result).toHaveLength(0);
    });

    it('excludes notes from other docs', () => {
        const a = noteWithOrigin(1, '/repo/a.md', 10, 50);
        const b = noteWithOrigin(2, '/repo/b.md', 10, 50);
        const result = findSelectedNotesByOriginPosition([a, b], '/repo/a.md', 0, 100);
        expect(result.map(n => n.seq)).toEqual([1]);
    });

    it('falls back to in-tree position check for notes without source_position', () => {
        const in_tree = makeNote({
            seq: 1,
            position: { start: { offset: 10, line: 1 }, end: { offset: 30, line: 2 }, end_body: { offset: 50, line: 3 } },
        });
        const result = findSelectedNotesByOriginPosition([in_tree], '/repo/a.md', 20, 40);
        expect(result).toHaveLength(1);
    });
});

describe('focusedChainIdsFor', () => {
    it('returns parents stable_ids followed by the note own stable_id, root-to-leaf', () => {
        const grandparent = makeNote({ seq: 1, stable_id: 'doc:gp' });
        const parent = makeNote({ seq: 2, stable_id: 'doc:p' });
        const note = makeNote({ seq: 3, stable_id: 'doc:n', parent_notes: [grandparent, parent] });
        expect(focusedChainIdsFor(note)).toEqual(['doc:gp', 'doc:p', 'doc:n']);
    });

    it('returns just the note stable_id when it has no parents', () => {
        const note = makeNote({ seq: 1, stable_id: 'doc:solo' });
        expect(focusedChainIdsFor(note)).toEqual(['doc:solo']);
    });

    it('drops undefined stable_ids from parents and self', () => {
        const parent_with_id = makeNote({ seq: 1, stable_id: 'doc:p' });
        const parent_without_id = makeNote({ seq: 2, stable_id: undefined });
        const note = makeNote({ seq: 3, stable_id: undefined, parent_notes: [parent_with_id, parent_without_id] });
        expect(focusedChainIdsFor(note)).toEqual(['doc:p']);
    });
});

describe('resolveFocusedNote', () => {
    it('prefers editor-derived match over view-driven ids', () => {
        const editor_match = makeNote({ seq: 1, stable_id: 'doc:a' });
        const other = makeNote({ seq: 2, stable_id: 'doc:b' });
        const result = resolveFocusedNote(['doc:b'], [editor_match, other], editor_match);
        expect(result?.stable_id).toBe('doc:a');
    });

    it('falls back to view-driven ids when editor has no match', () => {
        const note_a = makeNote({ seq: 1, stable_id: 'doc:a' });
        const note_b = makeNote({ seq: 2, stable_id: 'doc:b' });
        const result = resolveFocusedNote(['doc:b'], [note_a, note_b], undefined);
        expect(result?.stable_id).toBe('doc:b');
    });

    it('returns undefined when neither source produces a match', () => {
        const note = makeNote({ seq: 1, stable_id: 'doc:a' });
        expect(resolveFocusedNote(undefined, [note], undefined)).toBeUndefined();
        expect(resolveFocusedNote([], [note], undefined)).toBeUndefined();
    });

    it('returns undefined when view_focused_ids points at a missing id and the editor has no match', () => {
        const note = makeNote({ seq: 1, stable_id: 'doc:a' });
        expect(resolveFocusedNote(['doc:absent'], [note], undefined)).toBeUndefined();
    });

    it('uses the last id in the chain as the deepest focused note', () => {
        const parent = makeNote({ seq: 1, stable_id: 'doc:p' });
        const child = makeNote({ seq: 2, stable_id: 'doc:c' });
        const result = resolveFocusedNote(['doc:p', 'doc:c'], [parent, child], undefined);
        expect(result?.stable_id).toBe('doc:c');
    });
});

describe('isAggregateRoot', () => {
    function rootWithChildren(seq: number, headline_raw: string, children: NoteProps[]): NoteProps {
        return makeNote({ seq, headline_raw, child_notes: children });
    }

    it('returns true when children carry two or more distinct doc_ids', () => {
        const child_a = makeNote({ seq: 1, origin: { doc_id: 'a', doc_path: '/repo/a.md' } });
        const child_b = makeNote({ seq: 2, origin: { doc_id: 'b', doc_path: '/repo/b.md' } });
        const root = rootWithChildren(0, '', [child_a, child_b]);
        expect(isAggregateRoot(root)).toBe(true);
    });

    it('returns true for a single-origin synthetic seq-0 root with empty headline', () => {
        const child = makeNote({ seq: 1, origin: { doc_id: 'a', doc_path: '/repo/a.md' } });
        const root = rootWithChildren(0, '', [child]);
        expect(isAggregateRoot(root)).toBe(true);
    });

    it('returns false for a single-origin root with a real headline', () => {
        const child = makeNote({ seq: 1, origin: { doc_id: 'a', doc_path: '/repo/a.md' } });
        const root = rootWithChildren(0, '# Real headline', [child]);
        expect(isAggregateRoot(root)).toBe(false);
    });

    it('returns false when children have no origins', () => {
        const root = rootWithChildren(0, '', [makeNote({ seq: 1 })]);
        expect(isAggregateRoot(root)).toBe(false);
    });

    it('returns false for undefined parent_context', () => {
        expect(isAggregateRoot(undefined)).toBe(false);
    });
});

describe('majorityNgView', () => {
    function noteFrom(seq: number, doc_id: string, view: string | undefined): NoteProps {
        return makeNote({ seq, origin: { doc_id, doc_path: doc_id, file_view_type: view } });
    }

    it('returns the majority winner across distinct files', () => {
        const notes = [
            noteFrom(1, 'a', 'kanban'),
            noteFrom(2, 'b', 'kanban'),
            noteFrom(3, 'c', 'document'),
        ];
        expect(majorityNgView(notes)).toBe('kanban');
    });

    it('returns undefined on a tie', () => {
        const notes = [
            noteFrom(1, 'a', 'kanban'),
            noteFrom(2, 'b', 'document'),
        ];
        expect(majorityNgView(notes)).toBeUndefined();
    });

    it('returns undefined when no note has a file_view_type', () => {
        const notes = [noteFrom(1, 'a', undefined), noteFrom(2, 'b', undefined)];
        expect(majorityNgView(notes)).toBeUndefined();
    });

    it('counts one vote per file even when many notes share a doc_id', () => {
        const notes = [
            noteFrom(1, 'a', 'kanban'),
            noteFrom(2, 'a', 'kanban'),
            noteFrom(3, 'a', 'kanban'),
            noteFrom(4, 'b', 'document'),
        ];
        // a votes kanban once, b votes document once → tie → undefined
        expect(majorityNgView(notes)).toBeUndefined();
    });

    it('returns undefined for empty or missing input', () => {
        expect(majorityNgView([])).toBeUndefined();
        expect(majorityNgView(undefined)).toBeUndefined();
    });
});

describe('navigateToNeighbour', () => {
    const a = makeNote({ seq: 1 });
    const b = makeNote({ seq: 2 });
    const c = makeNote({ seq: 3 });

    it('returns the previous note when direction is -1', () => {
        expect(navigateToNeighbour([a, b, c], [2], -1)?.seq).toBe(1);
    });

    it('returns the next note when direction is +1', () => {
        expect(navigateToNeighbour([a, b, c], [2], 1)?.seq).toBe(3);
    });

    it('clamps at the first element when stepping back from the first', () => {
        expect(navigateToNeighbour([a, b, c], [1], -1)?.seq).toBe(1);
    });

    it('clamps at the last element when stepping forward from the last', () => {
        expect(navigateToNeighbour([a, b, c], [3], 1)?.seq).toBe(3);
    });

    it('treats a missing focused seq as before-the-first (up → first, down → first)', () => {
        // current_index = -1; up → max(-1, 0) = 0; down → -1 + 1 = 0
        expect(navigateToNeighbour([a, b, c], [99], -1)?.seq).toBe(1);
        expect(navigateToNeighbour([a, b, c], [99], 1)?.seq).toBe(1);
    });

    it('returns undefined for an empty notes list', () => {
        expect(navigateToNeighbour([], [1], -1)).toBeUndefined();
        expect(navigateToNeighbour([], undefined, 1)).toBeUndefined();
    });

    it('uses the last seq in focused_seqs (the deepest focused note)', () => {
        // chain [1, 2] — deepest is seq 2; down → seq 3
        expect(navigateToNeighbour([a, b, c], [1, 2], 1)?.seq).toBe(3);
    });
});

describe('flattenAllNotes', () => {
    it('produces a flat array with the root at index 0', () => {
        const root = makeNote({ seq: 0, children_body: [] });
        expect(flattenAllNotes(root)).toEqual([root]);
    });

    it('descends children_body in order, skipping seq-0 entries (root only)', () => {
        const child_1 = makeNote({ seq: 1, children_body: [] });
        const child_2 = makeNote({ seq: 2, children_body: [] });
        const root = makeNote({ seq: 0, children_body: [child_1, child_2] });
        expect(flattenAllNotes(root).map(n => n.seq)).toEqual([0, 1, 2]);
    });

    it('walks nested children_body recursively', () => {
        const grandchild = makeNote({ seq: 3, children_body: [] });
        const child = makeNote({ seq: 2, children_body: [grandchild] });
        const root = makeNote({ seq: 0, children_body: [child] });
        expect(flattenAllNotes(root).map(n => n.seq)).toEqual([0, 2, 3]);
    });

    it('skips children without a positive numeric seq (mdast leaves)', () => {
        const mdast_leaf = { type: 'paragraph', children: [], position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } } };
        const real_child = makeNote({ seq: 5, children_body: [] });
        const root = makeNote({ seq: 0, children_body: [mdast_leaf as never, real_child] });
        expect(flattenAllNotes(root).map(n => n.seq)).toEqual([0, 5]);
    });
});

describe('arraysEqual', () => {

    it('treats two undefineds as equal', () => {
        expect(arraysEqual(undefined, undefined)).toBe(true);
    });

    it('returns false when only one side is undefined', () => {
        expect(arraysEqual([1, 2], undefined)).toBe(false);
        expect(arraysEqual(undefined, [1, 2])).toBe(false);
    });

    it('treats two empty arrays as equal', () => {
        expect(arraysEqual([], [])).toBe(true);
    });

    it('compares equal number arrays element-wise', () => {
        expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('compares equal string arrays element-wise', () => {
        expect(arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    });

    it('short-circuits on same reference', () => {
        const a = [1, 2, 3];
        expect(arraysEqual(a, a)).toBe(true);
    });

    it('returns false for different lengths', () => {
        expect(arraysEqual([1, 2], [1, 2, 3])).toBe(false);
        expect(arraysEqual([1, 2, 3], [1, 2])).toBe(false);
    });

    it('returns false when number elements differ', () => {
        expect(arraysEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it('returns false when string elements differ', () => {
        expect(arraysEqual(['a', 'b'], ['a', 'c'])).toBe(false);
    });

    it('is order-sensitive', () => {
        expect(arraysEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    });
});

describe('deriveNaturalColumnOrder', () => {

    function makeStatusNote(seq: number, status: string | undefined): NoteProps {
        const note: NoteProps = {
            seq, level: 1, children_body: [], children: [],
            position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
            headline_raw: '', body_raw: '',
        };
        if (status !== undefined) {
            note.linetags = { status: { key: 'status', key_offset: 0, value: status, value_offset: 0, linktext_offset: 0, note_seq: seq } };
        }
        return note;
    }

    it('returns just [untagged] for an empty notes list', () => {
        expect(deriveNaturalColumnOrder([])).toEqual(['untagged']);
    });

    it('handles undefined input as empty', () => {
        expect(deriveNaturalColumnOrder(undefined as unknown as NoteProps[])).toEqual(['untagged']);
    });

    it('returns alphabetical status values with untagged appended', () => {
        const notes = [
            makeStatusNote(1, 'doing'),
            makeStatusNote(2, 'backlog'),
            makeStatusNote(3, 'done'),
        ];
        expect(deriveNaturalColumnOrder(notes)).toEqual(['backlog', 'doing', 'done', 'untagged']);
    });

    it('deduplicates repeated status values', () => {
        const notes = [
            makeStatusNote(1, 'doing'),
            makeStatusNote(2, 'doing'),
            makeStatusNote(3, 'done'),
            makeStatusNote(4, 'doing'),
        ];
        expect(deriveNaturalColumnOrder(notes)).toEqual(['doing', 'done', 'untagged']);
    });

    it('treats notes with no status linetag as belonging to untagged (not synthesised into the status list)', () => {
        const notes = [
            makeStatusNote(1, 'doing'),
            makeStatusNote(2, undefined),
        ];
        expect(deriveNaturalColumnOrder(notes)).toEqual(['doing', 'untagged']);
    });

    it('places untagged last even when a real status sorts after it alphabetically', () => {
        // 'untagged' alphabetically sorts before 'z*' but the rule pins it last regardless
        const notes = [
            makeStatusNote(1, 'zeta'),
            makeStatusNote(2, 'alpha'),
        ];
        expect(deriveNaturalColumnOrder(notes)).toEqual(['alpha', 'zeta', 'untagged']);
    });
});

function makeStoryNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 3,
        type: 'heading',
        depth: 3,
        children_body: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 50, line: 5 },
        },
        children: [],
        headline_raw: '### Test',
        body_raw: 'body text',
        ...overrides,
    };
}

function idLinetag(value: string): { [key: string]: LineTag } {
    return {
        id: {
            key: 'id',
            key_offset: 0,
            value,
            value_offset: 0,
            linktext_offset: 0,
            note_seq: 0,
        },
    };
}

function originFor(doc_path: string, relative_path: string | undefined, line: number): NoteOrigin {
    return {
        doc_id: doc_path,
        doc_path,
        relative_path,
        source_position: {
            start: { offset: 0, line },
            end: { offset: 10, line },
        },
    };
}

describe('findStableIdCollisions', () => {
    it('groups two notes with the same headline in the same file', () => {
        const a = makeStoryNote({ seq: 1, headline_raw: '### Login flow' });
        const b = makeStoryNote({ seq: 2, headline_raw: '### Login flow' });
        const collisions = findStableIdCollisions([a, b]);
        expect(collisions).toHaveLength(1);
        expect(collisions[0].slug).toBe('login-flow');
        expect(collisions[0].notes).toEqual([a, b]);
    });

    it('returns empty when all headlines are unique', () => {
        const a = makeStoryNote({ seq: 1, headline_raw: '### Alpha' });
        const b = makeStoryNote({ seq: 2, headline_raw: '### Beta' });
        expect(findStableIdCollisions([a, b])).toEqual([]);
    });

    it('groups the same headline across two different files', () => {
        const a = makeStoryNote({ seq: 1, headline_raw: '### Setup', origin: originFor('one.md', 'one.md', 3) });
        const b = makeStoryNote({ seq: 2, headline_raw: '### Setup', origin: originFor('two.md', 'two.md', 7) });
        const collisions = findStableIdCollisions([a, b]);
        expect(collisions).toHaveLength(1);
        expect(collisions[0].slug).toBe('setup');
        expect(collisions[0].notes).toEqual([a, b]);
    });

    it('groups two notes carrying the same explicit id linetag', () => {
        const a = makeStoryNote({ seq: 1, headline_raw: '### One title', linetags: idLinetag('foo') });
        const b = makeStoryNote({ seq: 2, headline_raw: '### Another title', linetags: idLinetag('foo') });
        const collisions = findStableIdCollisions([a, b]);
        expect(collisions).toHaveLength(1);
        expect(collisions[0].slug).toBe('foo');
        expect(collisions[0].notes).toEqual([a, b]);
    });

    it('groups an explicit id against a sibling whose headline derives the same slug', () => {
        const explicit = makeStoryNote({ seq: 1, headline_raw: '### Anything', linetags: idLinetag('shared-thing') });
        const derived = makeStoryNote({ seq: 2, headline_raw: '### Shared thing' });
        const collisions = findStableIdCollisions([explicit, derived]);
        expect(collisions).toHaveLength(1);
        expect(collisions[0].slug).toBe('shared-thing');
        expect(collisions[0].notes).toEqual([explicit, derived]);
    });

    it('excludes the synthetic root and non-heading notes', () => {
        const root = makeStoryNote({ seq: 0, level: 0, type: 'root', headline_raw: '' });
        const list_item = makeStoryNote({ seq: 1, type: 'listItem', headline_raw: 'Repeated body', depth: undefined });
        const list_item_dup = makeStoryNote({ seq: 2, type: 'listItem', headline_raw: 'Repeated body', depth: undefined });
        expect(findStableIdCollisions([root, list_item, list_item_dup])).toEqual([]);
    });

    it('orders groups by first-occurrence seq; notes within a group fall back to seq when source lines tie', () => {
        const later_a = makeStoryNote({ seq: 10, headline_raw: '### Later' });
        const earlier_b = makeStoryNote({ seq: 2, headline_raw: '### Earlier' });
        const earlier_a = makeStoryNote({ seq: 1, headline_raw: '### Earlier' });
        const later_b = makeStoryNote({ seq: 5, headline_raw: '### Later' });
        const collisions = findStableIdCollisions([later_a, earlier_b, earlier_a, later_b]);
        expect(collisions.map(c => c.slug)).toEqual(['earlier', 'later']);
        expect(collisions[0].notes).toEqual([earlier_a, earlier_b]);
        expect(collisions[1].notes).toEqual([later_b, later_a]);
    });

    it('orders notes within a group by source line even when merged seq diverges', () => {
        // folder-mode: a has the earlier merged seq but sits lower in its source file; b is later seq but higher in the file
        const a_lower = makeStoryNote({ seq: 1, headline_raw: '### Dup', origin: originFor('f.md', 'f.md', 50) });
        const b_higher = makeStoryNote({ seq: 2, headline_raw: '### Dup', origin: originFor('f.md', 'f.md', 10) });
        const collisions = findStableIdCollisions([a_lower, b_higher]);
        expect(collisions).toHaveLength(1);
        // ascending source line → line 10 (b) before line 50 (a), regardless of seq
        expect(collisions[0].notes).toEqual([b_higher, a_lower]);
    });
});

describe('collisionNoteLocation', () => {
    it('uses folder-mode source_position line and relative_path when origin present', () => {
        const note = makeStoryNote({ headline_raw: '### Build [](?id=build)', origin: originFor('proj/done.md', 'proj/done.md', 42) });
        expect(collisionNoteLocation(note)).toEqual({
            headline: 'Build',
            relative_path: 'proj/done.md',
            line: 42,
        });
    });

    it('falls back to position line and empty path in single-file mode', () => {
        const note = makeStoryNote({
            headline_raw: '### Single file note',
            position: { start: { offset: 0, line: 9 }, end: { offset: 10, line: 9 } },
        });
        expect(collisionNoteLocation(note)).toEqual({
            headline: 'Single file note',
            relative_path: '',
            line: 9,
        });
    });
});

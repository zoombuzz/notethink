import { findLineTags, parseLineTags, calculateTextChangesForNewLinetagValue, calculateTextChangesForOrdering, flattenOrderingChangeSets, isNamespacedKey, resolveNamespacedTag, NOTETHINK_PREFIXES } from './linetagops';
import { kanbanNoteOrder } from './noteops';
import type { LineTag, NoteProps } from '../types/NoteProps';

describe('findLineTags', () => {

    it('returns empty string for input without linetags', () => {
        expect(findLineTags('# Hello World')).toBe('');
    });

    it('extracts unbracketed linetag from headline', () => {
        const input = '## Task [](?status=doing)';
        const result = findLineTags(input);
        expect(result).toBe('[](?status=doing)');
    });

    it('extracts bracketed linetags from headline', () => {
        const input = '## Task ([](?status=doing))';
        const result = findLineTags(input);
        expect(result).toBe('([](?status=doing))');
    });

    it('extracts multiple linetags', () => {
        const input = '## Task [](?status=doing) [](?priority=high)';
        const result = findLineTags(input);
        expect(result).toContain('status=doing');
        expect(result).toContain('priority=high');
    });

    it('handles linetags with numeric values', () => {
        const input = '## Task [](?nt_kanban_ordering_weight=3)';
        const result = findLineTags(input);
        expect(result).toBe('[](?nt_kanban_ordering_weight=3)');
    });

    it('does not match markdown links as linetags', () => {
        expect(findLineTags('+ [swiper](https://swiperjs.com/)')).toBe('');
        expect(findLineTags('see [docs](https://example.com) for details')).toBe('');
        expect(findLineTags('+ [text](/relative/path)')).toBe('');
    });

    it('matches linetag after markdown link on same line', () => {
        const input = '## [link](https://example.com) [](?status=doing)';
        const result = findLineTags(input);
        expect(result).toContain('status=doing');
    });
});

describe('parseLineTags', () => {

    it('returns undefined for empty linetag string', () => {
        expect(parseLineTags('', 1)).toBeUndefined();
    });

    it('parses single key=value linetag', () => {
        const result = parseLineTags('[](?status=doing)', 1);
        expect(result).toBeDefined();
        expect(result!['status']).toBeDefined();
        expect(result!['status'].key).toBe('status');
        expect(result!['status'].value).toBe('doing');
        expect(result!['status'].note_seq).toBe(1);
    });

    it('parses multiple key=value pairs in one linetag', () => {
        const result = parseLineTags('[](?status=doing&priority=high)', 2);
        expect(result).toBeDefined();
        expect(result!['status'].value).toBe('doing');
        expect(result!['priority'].value).toBe('high');
    });

    it('stores numeric values', () => {
        const result = parseLineTags('[](?nt_kanban_ordering_weight=3)', 1);
        expect(result).toBeDefined();
        expect(result!['nt_kanban_ordering_weight'].value).toBe('3');
        expect(result!['nt_kanban_ordering_weight'].value_numeric).toBe(3);
    });

    it('stores linktext when it matches value', () => {
        const result = parseLineTags('[doing](?status=doing)', 1);
        expect(result).toBeDefined();
        expect(result!['status'].linktext).toBe('doing');
    });

    it('captures key_offset and value_offset', () => {
        const result = parseLineTags('[](?status=doing)', 1);
        expect(result).toBeDefined();
        expect(result!['status'].key_offset).toBeGreaterThanOrEqual(0);
        expect(result!['status'].value_offset).toBeGreaterThanOrEqual(0);
    });

    it('parses linetags from bracketed input', () => {
        const result = parseLineTags('([](?status=backlog))', 1);
        expect(result).toBeDefined();
        expect(result!['status'].value).toBe('backlog');
    });
});

describe('calculateTextChangesForNewLinetagValue', () => {

    function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
        return {
            seq: 1,
            level: 1,
            children_body: [],
            position: {
                start: { offset: 0, line: 1 },
                end: { offset: 10, line: 1 },
            },
            children: [],
            headline_raw: '## Task A',
            body_raw: '',
            ...overrides,
        };
    }

    it('generates a new linetag when note has no linetags', () => {
        const note = makeNote();
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'doing', 'untagged');
        expect(changes).toHaveLength(1);
        expect(changes[0].insert).toContain('status=doing');
        expect(changes[0].from).toBe(9); // note.position.start.offset + headline_raw.length
    });

    it('returns empty changes when setting default value on note without linetags', () => {
        const note = makeNote();
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'untagged', 'untagged');
        expect(changes).toHaveLength(0);
    });

    it('adds field to existing linetag when key does not exist', () => {
        const note = makeNote({
            linetags_from: 10,
            linetags: {
                'status': {
                    key: 'status',
                    value: 'doing',
                    note_seq: 1,
                    key_offset: 4,
                    value_offset: 11,
                    linktext_offset: 0,
                },
            },
        });
        const changes = calculateTextChangesForNewLinetagValue(note, 'priority', 'high', 'normal');
        expect(changes).toHaveLength(1);
        expect(changes[0].insert).toContain('priority=high');
    });

    // regression: reordering a kanban card whose status is inherited from a parent's
    // nt_child_status= attribute used to insert nt_kanban_ordering_weight= at document offset 0
    // (inherited tags carry key_offset 0 and the note has no linetags_from), corrupting the
    // parent heading and wiping the inherited status off every sibling — the whole column vanished
    it('appends a fresh linetag block instead of writing to offset 0 when the only linetag is inherited', () => {
        const note = makeNote({
            linetags: {
                'status': {
                    key: 'status',
                    value: 'done',
                    note_seq: 1,
                    key_offset: 0,
                    value_offset: 0,
                    linktext_offset: 0,
                    inherited: true,
                },
            },
        });
        const changes = calculateTextChangesForNewLinetagValue(note, 'nt_kanban_ordering_weight', '1', '0');
        expect(changes).toHaveLength(1);
        // must NOT land at offset 0 — append at the end of the headline instead
        expect(changes[0].from).toBe(9); // note.position.start.offset + headline_raw.length
        expect(changes[0].insert).toBe(' [](?nt_kanban_ordering_weight=1)');
    });

    it('skips the write when the value already matches an inherited tag', () => {
        // dragging a card within the column it already inherits status= from: no edit needed
        const note = makeNote({
            linetags: {
                'status': {
                    key: 'status',
                    value: 'done',
                    note_seq: 1,
                    key_offset: 0,
                    value_offset: 0,
                    linktext_offset: 0,
                    inherited: true,
                },
            },
        });
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'done', 'untagged');
        expect(changes).toHaveLength(0);
    });

    it('materialises a real linetag when the value differs from an inherited tag', () => {
        // dragging a card OUT of its inherited column: the inherited value must be overridden explicitly
        const note = makeNote({
            linetags: {
                'status': {
                    key: 'status',
                    value: 'done',
                    note_seq: 1,
                    key_offset: 0,
                    value_offset: 0,
                    linktext_offset: 0,
                    inherited: true,
                },
            },
        });
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'doing', 'untagged');
        expect(changes).toHaveLength(1);
        expect(changes[0].from).toBe(9); // appended at the end of the headline
        expect(changes[0].insert).toBe(' [](?status=doing)');
    });

    it('adds the field to the first REAL linetag, skipping an inherited one', () => {
        const note = makeNote({
            linetags_from: 10,
            linetags: {
                'status': {
                    key: 'status', value: 'done', note_seq: 1,
                    key_offset: 0, value_offset: 0, linktext_offset: 0, inherited: true,
                },
                'priority': {
                    key: 'priority', value: 'high', note_seq: 1,
                    key_offset: 4, value_offset: 13, linktext_offset: 0,
                },
            },
        });
        const changes = calculateTextChangesForNewLinetagValue(note, 'nt_kanban_ordering_weight', '1', '0');
        expect(changes).toHaveLength(1);
        expect(changes[0].from).toBe(14); // linetags_from(10) + priority key_offset(4)
        expect(changes[0].insert).toBe('nt_kanban_ordering_weight=1&');
    });

    it('updates existing linetag value', () => {
        const note = makeNote({
            linetags_from: 10,
            linetags: {
                'status': {
                    key: 'status',
                    value: 'doing',
                    note_seq: 1,
                    key_offset: 4,
                    value_offset: 11,
                    linktext_offset: 0,
                },
            },
        });
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'done', 'untagged');
        expect(changes).toHaveLength(1);
        expect(changes[0].from).toBe(21); // linetags_from + value_offset
        expect(changes[0].to).toBe(26); // from + 'doing'.length
        expect(changes[0].insert).toBe('done');
    });

    // --- removal tests (drag to default/untagged) ---

    /**
     * Helper: build a note with realistic linetag offsets by parsing the headline.
     * position.start.offset defaults to 0 unless overridden.
     */
    function makeNoteFromHeadline(headline: string, startOffset = 0, overrides: Partial<NoteProps> = {}): NoteProps {
        const linetags_str = findLineTags(headline);
        const linetags_from = linetags_str ? startOffset + headline.length - linetags_str.length : undefined;
        const linetags = linetags_str ? parseLineTags(linetags_str, 1) : undefined;
        return makeNote({
            position: {
                start: { offset: startOffset, line: 1 },
                end: { offset: startOffset + headline.length, line: 1 },
            },
            headline_raw: headline,
            linetags_from,
            linetags,
            ...overrides,
        });
    }

    /** Apply text changes to a source string and return the result. */
    function applyChanges(text: string, changes: Array<{from: number; to?: number; insert: string}>): string {
        const sorted = [...changes].sort((a, b) => b.from - a.from);
        let result = text;
        for (const c of sorted) {
            const to = c.to ?? c.from;
            result = result.slice(0, c.from) + c.insert + result.slice(to);
        }
        return result;
    }

    it('removes entire linetag when sole key is set to default value', () => {
        const headline = '## Task A [](?status=doing)';
        const note = makeNoteFromHeadline(headline);
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'untagged', 'untagged');
        expect(changes.length).toBeGreaterThan(0);
        const result = applyChanges(headline, changes);
        expect(result).toBe('## Task A');
        // must NOT contain the literal string "untagged"
        expect(result).not.toContain('untagged');
    });

    it('removes only the target key when multiple keys exist (first key)', () => {
        const headline = '## Task A [](?status=doing&priority=high)';
        const note = makeNoteFromHeadline(headline);
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'untagged', 'untagged');
        expect(changes.length).toBeGreaterThan(0);
        const result = applyChanges(headline, changes);
        expect(result).toContain('priority=high');
        expect(result).not.toContain('status');
        expect(result).not.toContain('untagged');
    });

    it('removes only the target key when multiple keys exist (last key)', () => {
        const headline = '## Task A [](?priority=high&status=doing)';
        const note = makeNoteFromHeadline(headline);
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'untagged', 'untagged');
        expect(changes.length).toBeGreaterThan(0);
        const result = applyChanges(headline, changes);
        expect(result).toContain('priority=high');
        expect(result).not.toContain('status');
        expect(result).not.toContain('untagged');
    });

    it('removes sole linetag including leading space', () => {
        // Ensure the space before [](...) is also removed
        const headline = '## Task [](?status=doing)';
        const note = makeNoteFromHeadline(headline);
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'untagged', 'untagged');
        const result = applyChanges(headline, changes);
        expect(result).toBe('## Task');
    });
});

describe('calculateTextChangesForOrdering', () => {

    function makeNote(seq: number, overrides: Partial<NoteProps> = {}): NoteProps {
        return {
            seq,
            level: 1,
            children_body: [],
            position: {
                start: { offset: seq * 20, line: seq },
                end: { offset: seq * 20 + 10, line: seq },
            },
            children: [],
            headline_raw: `## Note ${seq}`,
            body_raw: '',
            ...overrides,
        };
    }

    it('returns empty changes when sequence ordering is sufficient', () => {
        const children = [makeNote(1), makeNote(2), makeNote(3)];
        const result = calculateTextChangesForOrdering(children, 1, 'nt_kanban_ordering_weight');
        expect(result).toHaveLength(0);
    });

    it('assigns weight when inserted note breaks sequence order', () => {
        // seq 3 inserted between seq 1 and seq 2 - seq ordering won't work since 3 > 2
        const children = [makeNote(1), makeNote(3), makeNote(2)];
        const result = calculateTextChangesForOrdering(children, 1, 'nt_kanban_ordering_weight');
        const changes = flattenOrderingChangeSets(result);
        expect(changes.length).toBeGreaterThan(0);
        // should assign a weight to the new child at position 1
        expect(changes[0].insert).toContain('nt_kanban_ordering_weight');
    });

    it('applies weight to new child when predecessor has weight', () => {
        const predecessor = makeNote(1, {
            linetags_from: 20,
            linetags: {
                'nt_kanban_ordering_weight': {
                    key: 'nt_kanban_ordering_weight', value: '5', value_numeric: 5,
                    note_seq: 1, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        });
        const new_child = makeNote(2);
        const successor = makeNote(3);
        const children = [predecessor, new_child, successor];
        const result = calculateTextChangesForOrdering(children, 1, 'nt_kanban_ordering_weight');
        expect(flattenOrderingChangeSets(result).length).toBeGreaterThan(0);
    });

    it('cascades weights when there is no room between predecessor and successor', () => {
        const predecessor = makeNote(1, {
            linetags_from: 20,
            linetags: {
                'nt_kanban_ordering_weight': {
                    key: 'nt_kanban_ordering_weight', value: '5', value_numeric: 5,
                    note_seq: 1, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        });
        // successor has weight 5 too - there's no room between 5 and 5 (especially since seq order 3>2 means -1)
        const new_child = makeNote(3); // seq 3 going before seq 2
        const successor = makeNote(2, {
            linetags_from: 60,
            linetags: {
                'nt_kanban_ordering_weight': {
                    key: 'nt_kanban_ordering_weight', value: '5', value_numeric: 5,
                    note_seq: 2, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        });
        const children = [predecessor, new_child, successor];
        const result = calculateTextChangesForOrdering(children, 1, 'nt_kanban_ordering_weight');
        // should cascade: both new_child and successor get weights
        expect(flattenOrderingChangeSets(result).length).toBeGreaterThanOrEqual(1);
    });

    it('single-file mode returns at most one bucket with undefined doc_path', () => {
        // both children share no origin → undefined doc_path bucket
        const children = [makeNote(1), makeNote(3), makeNote(2)];
        const result = calculateTextChangesForOrdering(children, 1, 'nt_kanban_ordering_weight');
        expect(result).toHaveLength(1);
        expect(result[0].doc_path).toBeUndefined();
    });

    /*
     * round-trip: a column is displayed unweighted by ascending seq (the
     * implicit ordering kanbanNoteOrder now uses). simulate a drop the way
     * KanbanView.dragEndHandler does (filter the dragged note out, splice it
     * into the new index), feed the result to calculateTextChangesForOrdering,
     * apply the produced nt_kanban_ordering_weight values back onto note copies,
     * re-sort with kanbanNoteOrder, and assert the column holds the dropped
     * order. this is the end-to-end correctness the drag code lacked.
     */
    function simulateDrop(initial: NoteProps[], from_index: number, to_index: number): number[] {
        const dragged = initial[from_index];
        const column = initial.filter(n => n.seq !== dragged.seq);
        column.splice(to_index, 0, dragged);
        const changes = flattenOrderingChangeSets(calculateTextChangesForOrdering(column, to_index, 'nt_kanban_ordering_weight'));
        // a brand-new linetag is inserted at note.position.start.offset + headline_raw.length, so map each change back to its note by that offset
        // notes the algorithm assigned weight 0 (the default) get no change and stay unweighted — kanbanNoteOrder ranks them ahead of weighted cards, which is intended
        const weight_by_offset = new Map<number, number>();
        for (const c of changes) {
            const m = /nt_kanban_ordering_weight=(\d+)/.exec(c.insert);
            if (m) { weight_by_offset.set(c.from, Number(m[1])); }
        }
        const applied = column.map(n => {
            const insert_at = n.position.start.offset + n.headline_raw.length;
            const w = weight_by_offset.get(insert_at);
            if (w === undefined) { return n; }
            return {
                ...n,
                linetags: {
                    nt_kanban_ordering_weight: {
                        key: 'nt_kanban_ordering_weight', value: String(w), value_numeric: w,
                        note_seq: n.seq, key_offset: 0, value_offset: 0, linktext_offset: 0,
                    },
                },
            };
        });
        return applied.slice().sort(kanbanNoteOrder).map(n => n.seq);
    }

    it('round-trip: dropping a card at the top holds it first', () => {
        // displayed unweighted by seq: [10, 20, 30, 40]; drag the last to the top
        const column = [makeNote(10), makeNote(20), makeNote(30), makeNote(40)];
        expect(simulateDrop(column, 3, 0)).toEqual([40, 10, 20, 30]);
    });

    it('round-trip: dropping a card at the bottom holds it last', () => {
        const column = [makeNote(10), makeNote(20), makeNote(30), makeNote(40)];
        expect(simulateDrop(column, 0, 3)).toEqual([20, 30, 40, 10]);
    });

    it('round-trip: dropping a card into the middle holds its new position', () => {
        const column = [makeNote(10), makeNote(20), makeNote(30), makeNote(40)];
        // drag seq 30 (index 2) to sit just after seq 10 (index 1)
        expect(simulateDrop(column, 2, 1)).toEqual([10, 30, 20, 40]);
    });

    // weighted single-file note fixture: linetag block sits just after the headline
    function weighted(seq: number, n: number): NoteProps {
        const linetags_from = seq * 20 + `## Note ${seq}`.length;
        return makeNote(seq, {
            linetags_from,
            linetags: {
                'nt_kanban_ordering_weight': {
                    key: 'nt_kanban_ordering_weight', value: String(n), value_numeric: n,
                    note_seq: seq, key_offset: 0, value_offset: 'nt_kanban_ordering_weight='.length, linktext_offset: 0,
                },
            },
        });
    }

    /*
     * minimal + self-removing: weights exist only as long as they are needed to force a
     * non-implicit order. A note that is back in its implicit slot has its stale weight removed;
     * the rest are minimised rather than cascaded ever-upward.
     */
    it('removes a now-unnecessary weight and minimises the rest (no upward cascade)', () => {
        // desired order [pred(seq1,w5), new_child(seq3), successor(seq2,w5)]: seq1<seq3 is already
        // implicit, so pred + new_child are the unweighted prefix; only successor needs a weight
        const predecessor = weighted(1, 5);
        const new_child = makeNote(3);
        const successor = weighted(2, 5);
        const result = calculateTextChangesForOrdering([predecessor, new_child, successor], 1, 'nt_kanban_ordering_weight');
        expect(result).toHaveLength(1);
        expect(result[0].doc_path).toBeUndefined();
        const flat = flattenOrderingChangeSets(result);
        // predecessor's weight is no longer needed → removed (empty insert)
        expect(flat.some(c => c.insert === '')).toBe(true);
        // successor is minimised down to 1 (value update), NOT cascaded up to 6
        expect(flat.some(c => c.insert === '1')).toBe(true);
        // new_child stays unweighted — no fresh weight tag is inserted for it
        expect(flat.some(c => c.insert.includes('nt_kanban_ordering_weight='))).toBe(false);
    });

    /*
     * the acceptance test for "weights are minimal": drag a card out of its implicit slot
     * (which mints weights), then drag it back — the column returns to implicit order and EVERY
     * nt_kanban_ordering_weight is stripped, leaving the file weight-free.
     */
    it('drag a card out of place then back to implicit order strips every weight', () => {
        // state after dragging seq40 to the top: 10→w1, 20→w2, 30→w3 (40 unweighted)
        // now drag seq40 back to the bottom → desired order is the implicit [10,20,30,40]
        const desired = [weighted(10, 1), weighted(20, 2), weighted(30, 3), makeNote(40)];
        const flat = flattenOrderingChangeSets(calculateTextChangesForOrdering(desired, 3, 'nt_kanban_ordering_weight'));
        // three weights to strip, and every emitted change is a removal — none re-applies a weight
        expect(flat.length).toBeGreaterThan(0);
        expect(flat.every(c => c.insert === '')).toBe(true);
    });
});

describe('calculateTextChangesForOrdering cross-file', () => {

    function makeNoteWithOrigin(seq: number, doc_path: string, overrides: Partial<NoteProps> = {}): NoteProps {
        return {
            seq,
            level: 1,
            children_body: [],
            position: {
                start: { offset: seq * 100, line: seq },
                end: { offset: seq * 100 + 10, line: seq },
            },
            children: [],
            headline_raw: `## Note ${seq}`,
            body_raw: '',
            origin: { doc_id: doc_path, doc_path },
            ...overrides,
        };
    }

    function weighted(note: NoteProps, weight: number): NoteProps {
        return {
            ...note,
            linetags_from: note.position.start.offset + note.headline_raw.length - 25,
            linetags: {
                nt_kanban_ordering_weight: {
                    key: 'nt_kanban_ordering_weight', value: `${weight}`, value_numeric: weight,
                    note_seq: note.seq, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        };
    }

    it('drops a file-B note between two weighted file-A notes via gap insertion (no cascade)', () => {
        // weighted file-A notes at 10 and 20; drop a file-B note between them. gap 10..20 → integer 15 fits → only the new_child is written, file-A weights untouched.
        const a_pred = weighted(makeNoteWithOrigin(1, 'a.md'), 10);
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const a_succ = weighted(makeNoteWithOrigin(3, 'a.md'), 20);
        const column = [a_pred, new_child, a_succ];
        const result = calculateTextChangesForOrdering(column, 1, 'nt_kanban_ordering_weight');
        // exactly one bucket — only b.md got an edit
        expect(result).toHaveLength(1);
        expect(result[0].doc_path).toBe('b.md');
        // new_child weight is 15 (midpoint between 10 and 20)
        const flat = flattenOrderingChangeSets(result);
        const insert = flat.find(c => /nt_kanban_ordering_weight=/.test(c.insert));
        expect(insert?.insert).toContain('nt_kanban_ordering_weight=15');
    });

    it('cascade is bounded to the inserted note\'s doc_path when gap insertion fails', () => {
        // file-A neighbours weighted 5 and 6 (no integer gap); a file-B note dropped between them cascades to b.md only
        const a_pred = weighted(makeNoteWithOrigin(1, 'a.md'), 5);
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const a_succ = weighted(makeNoteWithOrigin(3, 'a.md'), 6);
        const column = [a_pred, new_child, a_succ];
        const result = calculateTextChangesForOrdering(column, 1, 'nt_kanban_ordering_weight');
        // all touched docs must be b.md (file-A weights stay untouched)
        for (const set of result) {
            expect(set.doc_path).toBe('b.md');
        }
        // and the algorithm did produce at least one change
        expect(flattenOrderingChangeSets(result).length).toBeGreaterThan(0);
    });

    it('partitions changes by doc_path when cascade naturally hits multiple files', () => {
        // cascade steps through several b.md notes with a file-A note mid-column; the file-A note is skipped and only b.md is rewritten
        const b1 = weighted(makeNoteWithOrigin(1, 'b.md'), 1);
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const a_mid = weighted(makeNoteWithOrigin(3, 'a.md'), 2);
        const b2 = weighted(makeNoteWithOrigin(4, 'b.md'), 3);
        const column = [b1, new_child, a_mid, b2];
        const result = calculateTextChangesForOrdering(column, 1, 'nt_kanban_ordering_weight');
        // every emitted bucket is b.md — a.md never receives a rewrite
        for (const set of result) {
            expect(set.doc_path).toBe('b.md');
        }
    });

    it('weighted predecessor + unweighted successor cascades (successor blocks unweighted)', () => {
        // an unweighted successor would sort before a weighted new_child, so a gap insert would invert the order — the cascade runs and stays bounded to b.md
        const a_pred = weighted(makeNoteWithOrigin(1, 'a.md'), 5);
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const a_succ = makeNoteWithOrigin(3, 'a.md');
        const column = [a_pred, new_child, a_succ];
        const result = calculateTextChangesForOrdering(column, 1, 'nt_kanban_ordering_weight');
        for (const set of result) {
            expect(set.doc_path).toBe('b.md');
        }
    });

    it('mints no weight for a top drop into an all-unweighted column (status change alone places it)', () => {
        // the reported bug: dragging a file into the top of a column whose cards are all
        // unweighted must NOT weight the dragged card — a weight would sort it AFTER the
        // unweighted successors (kanbanNoteOrder case 2) and sink it to the bottom. Implicit
        // mtime order floats the just-saved file up, so the correct ordering edit set is empty.
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const succ1 = makeNoteWithOrigin(1, 'a.md');
        const succ2 = makeNoteWithOrigin(3, 'c.md');
        const column = [new_child, succ1, succ2];
        const result = calculateTextChangesForOrdering(column, 0, 'nt_kanban_ordering_weight');
        expect(result).toHaveLength(0);
    });

    it('mints no weight for a mid drop between two unweighted notes (weight cannot express it)', () => {
        // both neighbours unweighted → any weight on the dragged card jumps it below both;
        // the placement is only expressible by implicit order, so emit nothing
        const pred = makeNoteWithOrigin(1, 'a.md');
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const succ = makeNoteWithOrigin(3, 'c.md');
        const column = [pred, new_child, succ];
        const result = calculateTextChangesForOrdering(column, 1, 'nt_kanban_ordering_weight');
        expect(result).toHaveLength(0);
    });

    it('still weights a top drop above a weighted successor (genuinely expressive)', () => {
        // successor carries a weight, so a gap insert below it is meaningful — the guard must
        // not suppress this. new_child should receive a weight strictly below the successor's.
        const new_child = makeNoteWithOrigin(1, 'b.md');
        const succ = weighted(makeNoteWithOrigin(2, 'a.md'), 5);
        const column = [new_child, succ];
        const result = calculateTextChangesForOrdering(column, 0, 'nt_kanban_ordering_weight');
        expect(flattenOrderingChangeSets(result).length).toBeGreaterThan(0);
        expect(result.every(s => s.doc_path === 'b.md')).toBe(true);
    });

    it('returns partitioned shape with one entry per touched doc_path', () => {
        const a_pred = weighted(makeNoteWithOrigin(1, 'a.md'), 10);
        const new_child = makeNoteWithOrigin(2, 'b.md');
        const a_succ = weighted(makeNoteWithOrigin(3, 'a.md'), 20);
        const column = [a_pred, new_child, a_succ];
        const result = calculateTextChangesForOrdering(column, 1, 'nt_kanban_ordering_weight');
        // each set must have its doc_path stamped
        for (const set of result) {
            expect(set).toHaveProperty('doc_path');
            expect(set).toHaveProperty('changes');
            expect(Array.isArray(set.changes)).toBe(true);
        }
        // and no two sets share a doc_path
        const doc_paths = result.map(s => s.doc_path);
        expect(new Set(doc_paths).size).toBe(doc_paths.length);
    });
});

describe('NOTETHINK_PREFIXES', () => {
    it('lists nt_ before ng_ so the going-forward prefix wins when both are present', () => {
        expect(NOTETHINK_PREFIXES).toEqual(['nt_', 'ng_']);
    });
});

describe('isNamespacedKey', () => {
    it('matches the going-forward nt_ prefix', () => {
        expect(isNamespacedKey('nt_view')).toBe(true);
        expect(isNamespacedKey('nt_child_status')).toBe(true);
        expect(isNamespacedKey('nt_kanban_ordering_weight')).toBe(true);
    });

    it('matches the legacy ng_ prefix', () => {
        expect(isNamespacedKey('ng_view')).toBe(true);
        expect(isNamespacedKey('ng_level')).toBe(true);
    });

    it('rejects unprefixed content attributes', () => {
        expect(isNamespacedKey('status')).toBe(false);
        expect(isNamespacedKey('epic')).toBe(false);
        expect(isNamespacedKey('progress_unit')).toBe(false);
    });
});

describe('resolveNamespacedTag', () => {
    const tag = (key: string): LineTag => ({
        key,
        key_offset: 0,
        value: key,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: 0,
    });

    it('resolves the nt_ form when only it is present', () => {
        expect(resolveNamespacedTag({ nt_view: tag('nt_view') }, 'view')?.key).toBe('nt_view');
    });

    it('falls back to the legacy ng_ form when only it is present', () => {
        expect(resolveNamespacedTag({ ng_view: tag('ng_view') }, 'view')?.key).toBe('ng_view');
    });

    it('prefers nt_ over ng_ when both are present (nt_-first ordering)', () => {
        const resolved = resolveNamespacedTag({ ng_view: tag('ng_view'), nt_view: tag('nt_view') }, 'view');
        expect(resolved?.key).toBe('nt_view');
    });

    it('returns undefined when neither prefix is present', () => {
        expect(resolveNamespacedTag({ status: tag('status') }, 'view')).toBeUndefined();
    });

    it('returns undefined when linetags is undefined', () => {
        expect(resolveNamespacedTag(undefined, 'view')).toBeUndefined();
    });
});

import { findLineTags, parseLineTags, calculateTextChangesForNewLinetagValue, calculateTextChangesForOrdering } from './linetagops';
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
        const input = '## Task [](?kanban_ordering_weight=3)';
        const result = findLineTags(input);
        expect(result).toBe('[](?kanban_ordering_weight=3)');
    });
});
describe('parseLineTags', () => {
    it('returns undefined for empty linetag string', () => {
        expect(parseLineTags('', 1)).toBeUndefined();
    });
    it('parses single key=value linetag', () => {
        const result = parseLineTags('[](?status=doing)', 1);
        expect(result).toBeDefined();
        expect(result['status']).toBeDefined();
        expect(result['status'].key).toBe('status');
        expect(result['status'].value).toBe('doing');
        expect(result['status'].note_seq).toBe(1);
    });
    it('parses multiple key=value pairs in one linetag', () => {
        const result = parseLineTags('[](?status=doing&priority=high)', 2);
        expect(result).toBeDefined();
        expect(result['status'].value).toBe('doing');
        expect(result['priority'].value).toBe('high');
    });
    it('stores numeric values', () => {
        const result = parseLineTags('[](?kanban_ordering_weight=3)', 1);
        expect(result).toBeDefined();
        expect(result['kanban_ordering_weight'].value).toBe('3');
        expect(result['kanban_ordering_weight'].value_numeric).toBe(3);
    });
    it('stores linktext when it matches value', () => {
        const result = parseLineTags('[doing](?status=doing)', 1);
        expect(result).toBeDefined();
        expect(result['status'].linktext).toBe('doing');
    });
    it('captures key_offset and value_offset', () => {
        const result = parseLineTags('[](?status=doing)', 1);
        expect(result).toBeDefined();
        expect(result['status'].key_offset).toBeGreaterThanOrEqual(0);
        expect(result['status'].value_offset).toBeGreaterThanOrEqual(0);
    });
    it('parses linetags from bracketed input', () => {
        const result = parseLineTags('([](?status=backlog))', 1);
        expect(result).toBeDefined();
        expect(result['status'].value).toBe('backlog');
    });
});
describe('calculateTextChangesForNewLinetagValue', () => {
    function makeNote(overrides = {}) {
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
    function makeNoteFromHeadline(headline, startOffset = 0, overrides = {}) {
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
    function applyChanges(text, changes) {
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
        const headline = '## Task [](?status=todo)';
        const note = makeNoteFromHeadline(headline);
        const changes = calculateTextChangesForNewLinetagValue(note, 'status', 'untagged', 'untagged');
        const result = applyChanges(headline, changes);
        expect(result).toBe('## Task');
    });
});
describe('calculateTextChangesForOrdering', () => {
    function makeNote(seq, overrides = {}) {
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
        const changes = calculateTextChangesForOrdering(children, 1, 'kanban_ordering_weight');
        expect(changes).toHaveLength(0);
    });
    it('assigns weight when inserted note breaks sequence order', () => {
        // seq 3 inserted between seq 1 and seq 2 — seq ordering won't work since 3 > 2
        const children = [makeNote(1), makeNote(3), makeNote(2)];
        const changes = calculateTextChangesForOrdering(children, 1, 'kanban_ordering_weight');
        expect(changes.length).toBeGreaterThan(0);
        // should assign a weight to the new child at position 1
        expect(changes[0].insert).toContain('kanban_ordering_weight');
    });
    it('applies weight to new child when predecessor has weight', () => {
        const predecessor = makeNote(1, {
            linetags_from: 20,
            linetags: {
                'kanban_ordering_weight': {
                    key: 'kanban_ordering_weight', value: '5', value_numeric: 5,
                    note_seq: 1, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        });
        const new_child = makeNote(2);
        const successor = makeNote(3);
        const children = [predecessor, new_child, successor];
        const changes = calculateTextChangesForOrdering(children, 1, 'kanban_ordering_weight');
        expect(changes.length).toBeGreaterThan(0);
    });
    it('cascades weights when there is no room between predecessor and successor', () => {
        const predecessor = makeNote(1, {
            linetags_from: 20,
            linetags: {
                'kanban_ordering_weight': {
                    key: 'kanban_ordering_weight', value: '5', value_numeric: 5,
                    note_seq: 1, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        });
        // successor has weight 5 too — there's no room between 5 and 5 (especially since seq order 3>2 means -1)
        const new_child = makeNote(3); // seq 3 going before seq 2
        const successor = makeNote(2, {
            linetags_from: 60,
            linetags: {
                'kanban_ordering_weight': {
                    key: 'kanban_ordering_weight', value: '5', value_numeric: 5,
                    note_seq: 2, key_offset: 4, value_offset: 25, linktext_offset: 0,
                },
            },
        });
        const children = [predecessor, new_child, successor];
        const changes = calculateTextChangesForOrdering(children, 1, 'kanban_ordering_weight');
        // should cascade: both new_child and successor get weights
        expect(changes.length).toBeGreaterThanOrEqual(1);
    });
});

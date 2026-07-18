import {
    FIRST_LEVEL_FOLDER_KEY,
    axisForGroupByKey,
    enumerateGroupByCandidates,
    isNumericTag,
    resolveGroupByAxisKey,
} from './groupbyops';
import { isAxisWritable } from './axisops';
import type { LineTag, NoteOrigin, NoteProps } from '../types/NoteProps';

function tag(key: string, value: string, extra?: Partial<LineTag>): LineTag {
    return { key, value, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1, ...extra };
}

function noteWith(linetags?: Record<string, LineTag>, origin?: NoteOrigin): NoteProps {
    return { seq: 1, level: 3, linetags, origin, children_body: [], children: [], headline_raw: '', body_raw: '', position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } } } as NoteProps;
}

function fileNote(doc_id: string, extra?: Partial<NoteOrigin>): NoteProps {
    return noteWith(undefined, { doc_id, doc_path: `/${doc_id}.md`, ...extra });
}

describe('enumerateGroupByCandidates', () => {
    it('collects an authored text attribute as a categorical candidate with distinct sorted values', () => {
        const notes = [
            noteWith({ assignee: tag('assignee', 'sam') }),
            noteWith({ assignee: tag('assignee', 'alex') }),
        ];
        const candidates = enumerateGroupByCandidates(notes);
        expect(candidates.find(c => c.key === 'assignee')).toEqual({
            key: 'assignee', values: ['alex', 'sam'], kind: 'categorical', writable: true,
        });
    });

    it('treats a numeric-only key as a continuous candidate and does not exclude it', () => {
        const notes = [
            noteWith({ time_taken: tag('time_taken', '30', { value_numeric: 30 }) }),
            noteWith({ time_taken: tag('time_taken', '45', { value_numeric: 45 }) }),
        ];
        const candidates = enumerateGroupByCandidates(notes);
        expect(candidates.find(c => c.key === 'time_taken')).toEqual({
            key: 'time_taken', values: ['30', '45'], kind: 'continuous', writable: true,
        });
    });

    it('excludes namespaced (nt_/ng_) and hidden (id/progress_unit/progress_max) keys', () => {
        const notes = [
            noteWith({
                nt_kanban_ordering_weight: tag('nt_kanban_ordering_weight', '1', { value_numeric: 1 }),
                ng_view: tag('ng_view', 'kanban'),
                id: tag('id', 'my-story'),
                progress_unit: tag('progress_unit', '%'),
                progress_max: tag('progress_max', '100', { value_numeric: 100 }),
                assignee: tag('assignee', 'alex'),
            }),
        ];
        const candidates = enumerateGroupByCandidates(notes);
        expect(candidates.map(c => c.key)).toEqual(['assignee']);
    });

    it('enumerates the implicit first-level-folder key from origins as a read-only implicit candidate', () => {
        const notes = [
            noteWith({}, { doc_id: 'a', doc_path: '/ws/notethink/todo.md', relative_path: 'notethink/docstech/todo.md' }),
            noteWith({}, { doc_id: 'b', doc_path: '/ws/oma/todo.md', relative_path: 'oma/docstech/todo.md' }),
            noteWith({}, { doc_id: 'c', doc_path: '/ws/notethink/done.md', relative_path: 'notethink/docstech/done.md' }),
        ];
        const candidates = enumerateGroupByCandidates(notes);
        expect(candidates.find(c => c.key === FIRST_LEVEL_FOLDER_KEY)).toEqual({
            key: FIRST_LEVEL_FOLDER_KEY, values: ['notethink', 'oma'], kind: 'categorical', writable: false, implicit: true,
        });
    });

    it('does not emit the folder key in single-file mode (no origins)', () => {
        const notes = [noteWith({ assignee: tag('assignee', 'alex') })];
        const candidates = enumerateGroupByCandidates(notes);
        expect(candidates.some(c => c.key === FIRST_LEVEL_FOLDER_KEY)).toBe(false);
    });

    it('counts inherited tags toward a key values', () => {
        const notes = [
            noteWith({ status: tag('status', 'doing') }),
            noteWith({ status: tag('status', 'done', { inherited: true }) }),
        ];
        const candidates = enumerateGroupByCandidates(notes);
        expect(candidates.find(c => c.key === 'status')).toEqual({
            key: 'status', values: ['doing', 'done'], kind: 'categorical', writable: true,
        });
    });

    it('treats a value whose value_numeric is NaN (e.g. "5px") as categorical, not continuous', () => {
        const notes = [
            noteWith({ size: tag('size', '10', { value_numeric: 10 }) }),
            noteWith({ size: tag('size', '5px', { value_numeric: Number('5px') }) }),
        ];
        const candidates = enumerateGroupByCandidates(notes);
        const size = candidates.find(c => c.key === 'size');
        expect(size?.kind).toBe('categorical');
        expect(size?.values).toEqual(['10', '5px']);
    });

    it('returns an empty array for undefined or empty notes', () => {
        expect(enumerateGroupByCandidates(undefined)).toEqual([]);
        expect(enumerateGroupByCandidates([])).toEqual([]);
    });

    it('memoises on the notes array identity, returning the same result reference', () => {
        const notes = [noteWith({ assignee: tag('assignee', 'alex') })];
        expect(enumerateGroupByCandidates(notes)).toBe(enumerateGroupByCandidates(notes));
    });
});

describe('isNumericTag', () => {
    it('is true for a parsed numeric value', () => {
        expect(isNumericTag(tag('time_taken', '30', { value_numeric: 30 }))).toBe(true);
    });

    it('is false when value_numeric is absent', () => {
        expect(isNumericTag(tag('assignee', 'alex'))).toBe(false);
    });

    it('is false when value_numeric is NaN (e.g. "5px")', () => {
        expect(isNumericTag(tag('size', '5px', { value_numeric: Number('5px') }))).toBe(false);
    });
});

describe('resolveGroupByAxisKey', () => {
    it('an explicit (non-auto) selection wins over everything', () => {
        const notes = [fileNote('a', { file_group_by: 'assignee' })];
        expect(resolveGroupByAxisKey(notes, undefined, 'status')).toBe('status');
    });

    it('a focused-note nt_group_by overrides the file vote when the selection is auto', () => {
        const notes = [fileNote('a', { file_group_by: 'assignee' })];
        const focused = [noteWith({ nt_group_by: tag('nt_group_by', 'priority') })];
        expect(resolveGroupByAxisKey(notes, focused, 'auto')).toBe('priority');
    });

    it('majority-votes nt_group_by across files when auto with no focused override', () => {
        const notes = [
            fileNote('a', { file_group_by: 'assignee' }),
            fileNote('b', { file_group_by: 'assignee' }),
            fileNote('c', { file_group_by: 'priority' }),
        ];
        expect(resolveGroupByAxisKey(notes, undefined, undefined)).toBe('assignee');
    });

    it('falls back to the first-level-folder default on a tie or no votes', () => {
        const tied = [
            fileNote('a', { file_group_by: 'assignee' }),
            fileNote('b', { file_group_by: 'priority' }),
        ];
        expect(resolveGroupByAxisKey(tied, undefined, undefined)).toBe(FIRST_LEVEL_FOLDER_KEY);
        expect(resolveGroupByAxisKey([fileNote('a')], undefined, undefined)).toBe(FIRST_LEVEL_FOLDER_KEY);
    });
});

describe('axisForGroupByKey', () => {
    it('builds a writable categorical axis for an authored attribute', () => {
        const notes = [noteWith({ assignee: tag('assignee', 'alex') }, { doc_id: 'a', doc_path: '/a.md' })];
        const axis = axisForGroupByKey('assignee', notes);
        expect(axis).toEqual({ field: 'assignee', kind: 'categorical', writable: true });
        expect(isAxisWritable(axis)).toBe(true);
    });

    it('builds a read-only axis for the implicit first-level-folder key', () => {
        const notes = [fileNote('a', { relative_path: 'projA/x.md' })];
        const axis = axisForGroupByKey(FIRST_LEVEL_FOLDER_KEY, notes);
        expect(axis.writable).toBe(false);
        expect(isAxisWritable(axis)).toBe(false);
    });
});

import {
    ABSENT_VALUE_BUCKET,
    INTRA_CELL_RANK_KEY,
    axisField,
    categoricalLaneFor,
    invertCategoricalAxis,
    invertDrop,
    isAxisWritable,
    normalizeAxis,
    projectNoteOntoAxis,
    type Axis,
} from './axisops';
import type { LineTag, NoteProps } from '../types/NoteProps';

function tag(key: string, value: string): LineTag {
    return { key, value, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 };
}

function noteWith(linetags?: Record<string, LineTag>): NoteProps {
    return { seq: 1, level: 3, linetags, children_body: [], children: [], headline_raw: '', body_raw: '', position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } } } as NoteProps;
}

describe('normalizeAxis', () => {
    it('expands a bare string into a writable categorical axis', () => {
        expect(normalizeAxis('status')).toEqual({ field: 'status', kind: 'categorical' });
    });

    it('returns a spec object unchanged', () => {
        const spec: Axis = { field: 'assignee', kind: 'categorical', writable: false };
        expect(normalizeAxis(spec)).toBe(spec);
    });
});

describe('axisField', () => {
    it('returns the single field for a string axis', () => {
        expect(axisField('status')).toBe('status');
    });

    it('returns the single field for a spec axis', () => {
        expect(axisField({ field: 'assignee', kind: 'categorical' })).toBe('assignee');
    });

    it('joins a compound field slot with a colon', () => {
        expect(axisField({ field: ['project', 'status'], kind: 'categorical' })).toBe('project:status');
    });
});

describe('isAxisWritable', () => {
    it('a bare string axis is writable by default', () => {
        expect(isAxisWritable('status')).toBe(true);
    });

    it('an axis is writable when writable is undefined', () => {
        expect(isAxisWritable({ field: 'assignee', kind: 'categorical' })).toBe(true);
    });

    it('an axis is read-only only when writable is explicitly false', () => {
        expect(isAxisWritable({ field: 'nt_first_level_folder', kind: 'categorical', writable: false })).toBe(false);
    });
});

describe('categoricalLaneFor', () => {
    it('a present value is its own lane', () => {
        expect(categoricalLaneFor('done')).toBe('done');
    });

    it('an undefined value falls into the absent bucket', () => {
        expect(categoricalLaneFor(undefined)).toBe(ABSENT_VALUE_BUCKET);
    });

    it('an empty string falls into the absent bucket', () => {
        expect(categoricalLaneFor('')).toBe(ABSENT_VALUE_BUCKET);
    });
});

describe('projectNoteOntoAxis (forward)', () => {
    it('places a note in the lane named by its linetag value', () => {
        expect(projectNoteOntoAxis(noteWith({ status: tag('status', 'doing') }), 'status')).toBe('doing');
    });

    it('places a note with no value for the axis field in the absent bucket', () => {
        expect(projectNoteOntoAxis(noteWith(), 'status')).toBe(ABSENT_VALUE_BUCKET);
    });

    it('generalises off status - projects an arbitrary attribute field', () => {
        expect(projectNoteOntoAxis(noteWith({ assignee: tag('assignee', 'alex') }), 'assignee')).toBe('alex');
    });
});

describe('invertCategoricalAxis (inverse)', () => {
    it('a real lane returns a set of the field to that lane value', () => {
        expect(invertCategoricalAxis('status', 'done')).toEqual({ kind: 'write', write: { field: 'status', op: 'set', value: 'done' } });
    });

    it('the absent bucket returns a delete of the field', () => {
        expect(invertCategoricalAxis('status', ABSENT_VALUE_BUCKET)).toEqual({ kind: 'write', write: { field: 'status', op: 'delete' } });
    });

    it('a read-only axis rejects the move rather than writing', () => {
        const inversion = invertCategoricalAxis({ field: 'nt_first_level_folder', kind: 'categorical', writable: false }, 'notethink');
        expect(inversion).toEqual({ kind: 'rejected', reason: 'read-only', field: 'nt_first_level_folder' });
    });
});

describe('invertDrop (whole drop)', () => {
    it('writes the writable axes and carries the intra-cell rank', () => {
        const result = invertDrop([{ axis: 'status', lane_value: 'done' }], { key: INTRA_CELL_RANK_KEY, index: 2 });
        expect(result.writes).toEqual([{ field: 'status', op: 'set', value: 'done' }]);
        expect(result.rejected_fields).toEqual([]);
        expect(result.rank).toEqual({ key: INTRA_CELL_RANK_KEY, index: 2 });
    });

    it('collects read-only axes as rejected and does not write them', () => {
        const result = invertDrop([{ axis: { field: 'nt_first_level_folder', kind: 'categorical', writable: false }, lane_value: 'notethink' }]);
        expect(result.writes).toEqual([]);
        expect(result.rejected_fields).toEqual(['nt_first_level_folder']);
    });
});

describe('kanban status drop round-trips identically through the general path', () => {
    it('forward then inverse reproduces the status write for a real lane', () => {
        const note = noteWith({ status: tag('status', 'code-review') });
        const lane = projectNoteOntoAxis(note, 'status');
        expect(lane).toBe('code-review');
        const inversion = invertCategoricalAxis('status', 'done');
        expect(inversion).toEqual({ kind: 'write', write: { field: 'status', op: 'set', value: 'done' } });
    });

    it('a drop onto the absent lane deletes the status linetag, matching kanban untagged', () => {
        const note = noteWith({ status: tag('status', 'doing') });
        expect(projectNoteOntoAxis(note, 'status')).toBe('doing');
        const inversion = invertCategoricalAxis('status', ABSENT_VALUE_BUCKET);
        expect(inversion).toEqual({ kind: 'write', write: { field: 'status', op: 'delete' } });
    });
});

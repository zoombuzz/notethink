import Debug from "debug";
import type { NoteProps } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:axisops");

/*
 * Axis and projection model. An axis is a scale spec (grammar-of-graphics: a field maps through a
 * scale to a position); a drop is the inverse (a position maps back to an attribute write). Building
 * the inverse projection now, while there is exactly one categorical axis, is what keeps grid/gantt
 * additive later instead of a rewrite.
 *
 * Ship: the categorical case (a single field grouped into lanes), forward + inverse projection, the
 * absent-value bucket, per-axis writability, and the intra-cell rank channel. Everything else -
 * continuous scales, log/time, bins, extents, compound keys, multi-axis cross-axis drag - is declared
 * in the types as a slot and NOT implemented here.
 */

export type AxisKind = 'categorical' | 'ordinal' | 'continuous';

// continuous-only scale kinds; a declared slot, not implemented
export type AxisScale = 'linear' | 'log' | 'time';

/**
 * AxisSpec, the rich axis shape. Only the categorical members are live; the continuous members are
 * typed slots the drop handler already accommodates but no view builds yet.
 * - field: the attribute a note maps through; a single field is what ships, a string[] compound key is a slot
 * - kind: categorical ships; ordinal/continuous are slots
 * - order: categorical per-axis lane order (the group order)
 * - scale/domain/bins/extent: continuous-only slots, not implemented
 * - writable: false marks a read-only (computed) axis a drop may not write; undefined/true means writable
 */
export interface AxisSpec {
    field: string | string[];
    kind: AxisKind;
    order?: string[];
    scale?: AxisScale;
    domain?: [number, number];
    bins?: number;
    extent?: { start: number; end: number };
    writable?: boolean;
}

// a bare string is sugar for a writable categorical axis on that field
export type Axis = string | AxisSpec;

/**
 * AxisBucketWrite, the attribute write a categorical inverse projection produces.
 * - op 'set' writes `field := value`; op 'delete' removes the field's linetag (the absent-value bucket)
 */
export interface AxisBucketWrite {
    field: string;
    op: 'set' | 'delete';
    value?: string;
}

/**
 * AxisInversion, the result of inverting one axis at a drop coordinate: either the write to apply, or a
 * rejection when the axis is read-only (the card must snap back along that axis - a drop cannot move a
 * computed value like the first level folder without moving a file on disk).
 */
export type AxisInversion =
    | { kind: 'write'; write: AxisBucketWrite }
    | { kind: 'rejected'; reason: 'read-only'; field: string };

/**
 * IntraCellRank, the rank channel orthogonal to axis bucketing: where a card sits WITHIN its cell,
 * independent of which cell it is in. Carried by the `nt_kanban_ordering_weight` linetag; a single drop
 * resolves which cell (invert each axis) and where in the cell (this rank).
 */
export interface IntraCellRank {
    key: string;
    index: number;
}

/**
 * DropCoordinate, one axis paired with the destination lane value the drop landed in. A drop carries one
 * coordinate per axis the view exposes (one today; grid would carry two).
 */
export interface DropCoordinate {
    axis: Axis;
    lane_value: string;
}

/**
 * DropInversion, the full result of inverting a drop across every axis plus the intra-cell rank.
 * - writes: the bucket writes for the writable axes
 * - rejected_fields: fields whose axis was read-only, so the move is not honoured along them
 * - rank: the intra-cell rank channel, when the drop specifies one
 */
export interface DropInversion {
    writes: AxisBucketWrite[];
    rejected_fields: string[];
    rank?: IntraCellRank;
}

/**
 * The synthetic absent-value bucket: the lane a note with no value for the axis field lands in. No
 * file carries this value - the categorical projection invents it, and dropping onto this lane
 * deletes the field's linetag. The status axis uses 'untagged' as its absent lane.
 */
export const ABSENT_VALUE_BUCKET = 'untagged';

/**
 * The intra-cell rank channel key: the user-chosen order within a cell, carried by this
 * ordering-weight linetag and shared by every grouped view.
 */
export const INTRA_CELL_RANK_KEY = 'nt_kanban_ordering_weight';

/**
 * The implicit read-only axis field for the first-level folder: a note's value on this axis comes
 * from its origin's relative_path, not a linetag. Namespaced to preserve the authored key space; a
 * permanent name. Read-only since a drop along it would have to move a file on disk. Lives here as
 * the neutral home both the lane helpers and the group-by enumeration import without a cycle.
 */
export const FIRST_LEVEL_FOLDER_KEY = 'nt_first_level_folder';

/*
 * The axis kanban lanes by unless its own group-by says otherwise. It is kanban's identity rather than a
 * preference, which is why `auto` on a kanban board means this and not the first-level-folder default
 * every other grouped view falls back to. Several lane helpers still spell it as a default parameter -
 * that is the same value, kept as sugar so a caller grouping a kanban needs no import.
 */
export const KANBAN_AXIS_KEY = 'status';

/** expand the string-sugar form of an axis into a full categorical AxisSpec */
export function normalizeAxis(axis: Axis): AxisSpec {
    if (typeof axis === 'string') { return { field: axis, kind: 'categorical' }; }
    return axis;
}

/**
 * The single field an axis reads: a single-field axis returns it verbatim (the ship case); a
 * compound key (a slot) joins its parts with ':' for a stable string, though no view builds one yet.
 */
export function axisField(axis: Axis): string {
    const spec = normalizeAxis(axis);
    return Array.isArray(spec.field) ? spec.field.join(':') : spec.field;
}

/** an axis is writable unless it explicitly opts out (`writable: false`); read-only axes take no drops */
export function isAxisWritable(axis: Axis): boolean {
    return normalizeAxis(axis).writable !== false;
}

/** map a raw field value to its categorical lane: a present value is its own lane, an absent/empty value is the absent bucket */
export function categoricalLaneFor(raw_value: string | undefined): string {
    return raw_value || ABSENT_VALUE_BUCKET;
}

/**
 * Forward projection: the categorical lane a note occupies on an axis, read from its linetag for the
 * axis field. An implicit key computed from origin (e.g. the first-level folder) is not a linetag,
 * so the caller resolves its value and passes it through `categoricalLaneFor` instead.
 */
export function projectNoteOntoAxis(note: NoteProps, axis: Axis): string {
    return categoricalLaneFor(note.linetags?.[axisField(axis)]?.value);
}

/**
 * Inverse projection for one categorical axis: turns the lane a card was dropped into back into an
 * attribute write. A read-only axis is rejected (the card snaps back); the absent-value lane
 * produces a delete, any other lane a set to that value.
 */
export function invertCategoricalAxis(axis: Axis, lane_value: string): AxisInversion {
    const field = axisField(axis);
    if (!isAxisWritable(axis)) {
        debug('invertCategoricalAxis: read-only axis rejected, field=%s', field);
        return { kind: 'rejected', reason: 'read-only', field };
    }
    if (lane_value === ABSENT_VALUE_BUCKET) {
        return { kind: 'write', write: { field, op: 'delete' } };
    }
    return { kind: 'write', write: { field, op: 'set', value: lane_value } };
}

/**
 * Inverts a whole drop: resolves which cell (each axis) and where in it (rank). Writable axes
 * contribute a bucket write; read-only axes contribute a rejected field and stay unmoved. A view
 * passes a single coordinate today, but the shape is multi-axis so grid/gantt are additive.
 */
export function invertDrop(coordinates: DropCoordinate[], rank?: IntraCellRank): DropInversion {
    const writes: AxisBucketWrite[] = [];
    const rejected_fields: string[] = [];
    for (const coordinate of coordinates) {
        const inversion = invertCategoricalAxis(coordinate.axis, coordinate.lane_value);
        if (inversion.kind === 'write') {
            writes.push(inversion.write);
        } else {
            rejected_fields.push(inversion.field);
        }
    }
    debug('invertDrop: %d write(s), %d rejected axis/axes', writes.length, rejected_fields.length);
    return { writes, rejected_fields, rank };
}

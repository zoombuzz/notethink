import * as l10n from "@vscode/l10n";
import { ABSENT_VALUE_BUCKET, type Axis } from "./axisops";
import { kanbanColumnValue, mergeSavedGroupDisplay } from "./noteops";
import type { GroupDisplayEntry } from "../types/Messages";
import type { NoteProps } from "../types/NoteProps";

/**
 * The group orders a grouped board can draw in: `custom` is today's hand-dragged order (the saved
 * `groupDisplay` order, then any group it never named, alphabetically), and the other four are
 * automatic - recomputed from the live notes on every render rather than from a saved order at all.
 * `newestFirst` and `newestLast` read a group's latest ordering timestamp in opposite directions; what
 * that timestamp IS is a card type's own business (`cardregistryops.ts`'s `OrderTimestampFn`), not
 * this module's - a group's values pass through `orderGroupValues` with a plain note-to-timestamp
 * function, so this module never imports a card type or agent code and works the same for any of them.
 */
export const GROUP_ORDERS = ['custom', 'newestFirst', 'newestLast', 'alphabetical', 'cardCount'] as const;
export type GroupOrderMode = typeof GROUP_ORDERS[number];
export const GROUP_ORDER_DEFAULT: GroupOrderMode = 'custom';

/** true for a value this module knows how to order by, so a stale or malformed cascade value falls back safely */
export function isGroupOrderMode(value: unknown): value is GroupOrderMode {
    return (GROUP_ORDERS as ReadonlyArray<unknown>).includes(value);
}

/** a cascade value coerced to a known mode, defaulting to custom for anything else (undefined included) */
export function resolveGroupOrderMode(value: unknown): GroupOrderMode {
    return isGroupOrderMode(value) ? value : GROUP_ORDER_DEFAULT;
}

/** the group order select's own name for a mode, shared by the settings drawer and its own tests */
export function groupOrderLabel(mode: GroupOrderMode): string {
    if (mode === 'newestFirst') { return l10n.t('Newest first'); }
    if (mode === 'newestLast') { return l10n.t('Newest last'); }
    if (mode === 'alphabetical') { return l10n.t('Alphabetical'); }
    if (mode === 'cardCount') { return l10n.t('Card count'); }
    return l10n.t('Custom');
}

/** the distinct values, alphabetical, with the absent-value bucket forced last wherever it sorts */
function alphabeticalOrder(group_values: ReadonlyArray<string>): string[] {
    const named = group_values.filter(value => value !== ABSENT_VALUE_BUCKET).sort();
    return group_values.includes(ABSENT_VALUE_BUCKET) ? [...named, ABSENT_VALUE_BUCKET] : named;
}

/**
 * A note's ordering timestamp, in epoch ms, or undefined when it carries none. Supplied by the caller -
 * in practice `cardregistryops.ts`'s `noteOrderTimestampFn`, bound to the card type actually on screen
 * and (for a card type that reads it) the live agent activity snapshot - so this module stays pure and
 * works the same whatever a card type's own rule turns out to be.
 */
export type NoteTimestampFn = (note: NoteProps) => number | undefined;

/**
 * Named group values split into the ones with a timestamp (unsorted, each with its latest ms) and the
 * ones without (sorted alphabetically). Shared by `newestFirstOrder` and `newestLastOrder`, which each
 * sort the timed bucket in their own direction and lead with a different end of the split.
 */
function splitGroupsByTimestamp(
    group_values: ReadonlyArray<string>,
    notes: ReadonlyArray<NoteProps>,
    axis: Axis,
    timestamp_of: NoteTimestampFn,
): { timed: Array<{ value: string; ms: number }>; untimed_alphabetical: string[] } {
    const named_values = group_values.filter(value => value !== ABSENT_VALUE_BUCKET);
    const timed: Array<{ value: string; ms: number }> = [];
    const untimed: string[] = [];
    for (const value of named_values) {
        const group_notes = notes.filter(note => kanbanColumnValue(note, axis) === value);
        let latest: number | undefined;
        for (const note of group_notes) {
            const ms = timestamp_of(note);
            if (ms === undefined) { continue; }
            if (latest === undefined || ms > latest) { latest = ms; }
        }
        if (latest === undefined) { untimed.push(value); } else { timed.push({ value, ms: latest }); }
    }
    return { timed, untimed_alphabetical: untimed.sort() };
}

/**
 * Group values with time flowing left to right: the groups with no timestamp come first, alphabetically,
 * then the groups that have one, oldest to newest, so the most recently changed group is the rightmost
 * named group. The absent-value bucket is always last.
 */
function newestLastOrder(
    group_values: ReadonlyArray<string>,
    notes: ReadonlyArray<NoteProps>,
    axis: Axis,
    timestamp_of: NoteTimestampFn,
): string[] {
    const { timed, untimed_alphabetical } = splitGroupsByTimestamp(group_values, notes, axis, timestamp_of);
    const timed_oldest_first = [...timed].sort((a, b) => a.ms - b.ms).map(entry => entry.value);
    const ordered = [...untimed_alphabetical, ...timed_oldest_first];
    return group_values.includes(ABSENT_VALUE_BUCKET) ? [...ordered, ABSENT_VALUE_BUCKET] : ordered;
}

/**
 * The mirror of `newestLastOrder`: the most recently changed group leads, newest to oldest, then the
 * groups with no timestamp follow, alphabetically. The absent-value bucket is always last.
 */
function newestFirstOrder(
    group_values: ReadonlyArray<string>,
    notes: ReadonlyArray<NoteProps>,
    axis: Axis,
    timestamp_of: NoteTimestampFn,
): string[] {
    const { timed, untimed_alphabetical } = splitGroupsByTimestamp(group_values, notes, axis, timestamp_of);
    const timed_newest_first = [...timed].sort((a, b) => b.ms - a.ms).map(entry => entry.value);
    const ordered = [...timed_newest_first, ...untimed_alphabetical];
    return group_values.includes(ABSENT_VALUE_BUCKET) ? [...ordered, ABSENT_VALUE_BUCKET] : ordered;
}

/** group values by card count, most first, ties alphabetical, the absent bucket always last */
function cardCountOrder(group_values: ReadonlyArray<string>, notes: ReadonlyArray<NoteProps>, axis: Axis): string[] {
    const named_values = group_values.filter(value => value !== ABSENT_VALUE_BUCKET);
    const counted = named_values.map(value => ({ value, count: notes.filter(note => kanbanColumnValue(note, axis) === value).length }));
    counted.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)));
    const ordered = counted.map(entry => entry.value);
    return group_values.includes(ABSENT_VALUE_BUCKET) ? [...ordered, ABSENT_VALUE_BUCKET] : ordered;
}

/**
 * The group order a board (and its settings drawer chips, so the two can never disagree) draws in, for
 * one of the five modes. `custom` reproduces today's hand-dragged behaviour exactly - `saved_display`'s
 * own order, then any group it never named, alphabetically - and reads neither `notes` nor
 * `timestamp_of`. Every automatic mode ignores `saved_display` entirely and recomputes fresh from
 * `notes` (and, for `newestFirst` / `newestLast`, `timestamp_of`) on every call, which is what lets a
 * group move as its cards change. The absent-value bucket is always last, in every mode.
 */
export function orderGroupValues(
    group_values: ReadonlyArray<string>,
    notes: ReadonlyArray<NoteProps>,
    axis: Axis,
    mode: GroupOrderMode,
    saved_display: ReadonlyArray<GroupDisplayEntry>,
    timestamp_of: NoteTimestampFn,
): string[] {
    if (mode === 'alphabetical') { return alphabeticalOrder(group_values); }
    if (mode === 'cardCount') { return cardCountOrder(group_values, notes, axis); }
    if (mode === 'newestFirst') { return newestFirstOrder(group_values, notes, axis, timestamp_of); }
    if (mode === 'newestLast') { return newestLastOrder(group_values, notes, axis, timestamp_of); }
    return mergeSavedGroupDisplay([...saved_display], alphabeticalOrder(group_values)).map(entry => entry.value);
}

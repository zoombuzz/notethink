import * as l10n from "@vscode/l10n";
import {
    normaliseActivityPath,
    sessionStateOf,
    sessionsForStory,
    storyKeyForNote,
    type ActivitySnapshot,
    type ActivityStoryKey,
} from "./agentactivityops";
import { isVirtualNote } from "./virtualnoteops";
import type { ActivityStoryProgress } from "../types/AgentActivity";
import type { LineTag, MdastNode, NoteProps } from "../types/NoteProps";

/*
 * How far along a story is, as a whole percent, and where that figure came from. Three sources, first
 * found wins: the coordinator's own entry for the story's id, then the story's `progress` linetag,
 * then the ticked task boxes over all task boxes in the story. Everything here is pure, so the card
 * that draws the pie and the column order that reads the entry's time share one answer.
 */

// the story statuses that show a pie; a story at any other status shows one only while an agent is bound to it
export const IN_FLIGHT_STORY_STATUSES = ['doing', 'code-review', 'testing'] as const;

export const STORY_PROGRESS_SOURCES = ['coordinator', 'linetag', 'tasks'] as const;
export type StoryProgressSource = typeof STORY_PROGRESS_SOURCES[number];

/**
 * StoryProgress is one story's resolved percentage.
 * - pct: whole percent, 0 to 100
 * - source: which of the three sources supplied it
 * - at: epoch ms of the coordinator's entry, present only for that source
 * - note: the coordinator's remark, present only for that source
 * - done, total: the ticked and all task boxes, present only for the `tasks` source
 */
export interface StoryProgress {
    pct: number;
    source: StoryProgressSource;
    at?: number;
    note?: string;
    done?: number;
    total?: number;
}

/** a task-box count: how many are ticked, and how many there are */
export interface TaskCount {
    done: number;
    total: number;
}

/**
 * The ticked and total task boxes in a story's own body. A list item counts when it carries a `[ ]`
 * or `[X]` box (a plain bullet has none and is left out), at any list depth. The walk never enters a
 * heading, since a heading below a story is another story whose boxes are its own.
 */
export function taskCountOf(items: ReadonlyArray<NoteProps | MdastNode> | undefined): TaskCount {
    const count: TaskCount = { done: 0, total: 0 };
    for (const item of items ?? []) {
        const note = item as NoteProps;
        if (note.type === 'heading') { continue; }
        if (note.type === 'listItem' && typeof note.checked === 'boolean') {
            count.total++;
            if (note.checked) { count.done++; }
        }
        const nested = taskCountOf(note.children_body);
        count.done += nested.done;
        count.total += nested.total;
    }
    return count;
}

/** a count as a whole percent, undefined when there are no boxes to measure against */
export function percentOfCount(count: TaskCount): number | undefined {
    if (count.total <= 0) { return undefined; }
    return Math.round(count.done * 100 / count.total);
}

/**
 * The percentage a story's own `progress` linetag states, undefined when it states none a pie can
 * draw. With a `progress_max` sibling the value is taken as a share of it; without one a value
 * between 0 and 100 is itself the percentage. Never reads a sibling that is absent.
 */
export function linetagProgressPct(linetags: { [key: string]: LineTag } | undefined): number | undefined {
    const value = linetags?.progress?.value_numeric;
    if (value === undefined || Number.isNaN(value)) { return undefined; }
    const max = linetags?.progress_max?.value_numeric;
    const pct = max !== undefined && max > 0 ? value * 100 / max : value;
    if (pct < 0 || pct > 100) { return undefined; }
    return Math.round(pct);
}

/** the text the `progress` linetag draws as: a share of `progress_max` where both are numbers, else its own value, each followed by the unit when there is one */
export function progressLinetagText(linetags: { [key: string]: LineTag } | undefined): string {
    const tag = linetags?.progress;
    if (!tag) { return ''; }
    const max = linetags?.progress_max?.value_numeric;
    const shown = max && tag.value_numeric ? Math.round(tag.value_numeric * 100 / max) : tag.value;
    return `${shown}${linetags?.progress_unit?.value ?? ''}`;
}

/** whether a story's own (not inherited) status puts it in flight */
export function hasInFlightStatus(note: NoteProps | undefined): boolean {
    const status = note?.linetags?.status;
    if (!status || status.inherited) { return false; }
    return (IN_FLIGHT_STORY_STATUSES as ReadonlyArray<string>).includes(status.value);
}

/** whether a story is a heading the pie may draw on: a parsed story, never a virtual stand-in for an agent bound to none */
export function isStoryNote(note: NoteProps | undefined): boolean {
    return !!note && note.type === 'heading' && !isVirtualNote(note);
}

/** whether an agent that has not ended is bound to the story, which shows a pie whatever the story's status */
export function hasLiveAgentBound(snapshot: ActivitySnapshot | undefined, key: ActivityStoryKey | undefined): boolean {
    return sessionsForStory(snapshot, key).some(state => {
        const session_state = sessionStateOf(state.session);
        return session_state === 'working' || session_state === 'waiting' || session_state === 'idle';
    });
}

/**
 * The coordinator's entry for a story: the one whose id matches and whose repository holds the
 * story's document, the deepest such repository where they nest (an empty `root_relative`, a
 * repository that is the workspace folder, holds every path).
 */
export function progressEntryForStory(snapshot: ActivitySnapshot | undefined, key: ActivityStoryKey | undefined): ActivityStoryProgress | undefined {
    if (!snapshot || !key) { return undefined; }
    const doc_path = normaliseActivityPath(key.doc_path);
    let best: ActivityStoryProgress | undefined;
    for (const entry of snapshot.progress ?? []) {
        if (entry.story_id !== key.id) { continue; }
        const base = normaliseActivityPath(entry.root_relative);
        if (base && !doc_path.startsWith(`${base}/`)) { continue; }
        if (!best || base.length > normaliseActivityPath(best.root_relative).length) { best = entry; }
    }
    return best;
}

/**
 * A story's percentage and its source, or undefined when the story is not one the pie draws on or
 * no source has a figure. The story shows a pie when its own status is in flight or an agent that
 * has not ended is bound to it.
 */
export function resolveStoryProgress(note: NoteProps | undefined, snapshot: ActivitySnapshot | undefined, fallback_doc_path?: string): StoryProgress | undefined {
    if (!note || !isStoryNote(note)) { return undefined; }
    const key = storyKeyForNote(note, fallback_doc_path);
    if (!hasInFlightStatus(note) && !hasLiveAgentBound(snapshot, key)) { return undefined; }
    const entry = progressEntryForStory(snapshot, key);
    if (entry) {
        const at = Date.parse(entry.at);
        return { pct: entry.pct, source: 'coordinator', at: Number.isNaN(at) ? undefined : at, note: entry.note };
    }
    const tagged = linetagProgressPct(note.linetags);
    if (tagged !== undefined) { return { pct: tagged, source: 'linetag' }; }
    const count = taskCountOf(note.children_body);
    const counted = percentOfCount(count);
    if (counted !== undefined) { return { pct: counted, source: 'tasks', done: count.done, total: count.total }; }
    return undefined;
}

/** the accessible label of a pie: the whole percent, read aloud as "<n>% complete" */
export function progressLabel(progress: StoryProgress): string {
    return l10n.t('{0}% complete', progress.pct);
}

/** a pie's tooltip: the label with the source that supplied the figure, and the coordinator's remark where it left one */
export function progressTooltip(progress: StoryProgress): string {
    let source: string;
    if (progress.source === 'coordinator') { source = l10n.t('coordinator estimate'); }
    else if (progress.source === 'linetag') { source = l10n.t('progress tag'); }
    else { source = l10n.t('{0} of {1} tasks ticked', progress.done ?? 0, progress.total ?? 0); }
    const base = l10n.t('{0}% complete ({1})', progress.pct, source);
    return progress.note ? `${base}: ${progress.note}` : base;
}

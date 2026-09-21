import Debug from "debug";
import { convertMdastToNoteHierarchy, type MdastInput } from "./convertMdastToNoteHierarchy";
import { stripHeadlineLinetags, storyStableIdSlug } from "./noteops";
import { resolveNamespacedTag } from "./linetagops";
import { FOLDER_VIEW_STATE_ID, resolveIntegrationMode } from "./viewstateops";
import { buildProjectLabels, hueForProjectName, projectNameFromRelativePath } from "./originops";
import { INTEGRATION_MODE_FOLDER } from "../types/IntegrationMode";
import type { LineTag, MdastNode, NoteProps, NoteOrigin } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:mergeAggregateRoot");

/**
 * Aggregate (Folder) mode entry point.
 *
 * Takes a map of source documents and an integration folder path; returns a single
 * synthetic root NoteProps whose children are the depth-3 "stories" gathered from every
 * doc, each stamped with origin metadata so callers can route edits back to the source file.
 *
 * A merge is incremental. A FolderMergeCache lets one board carry two things between merges:
 * each doc's parsed tree, keyed on its content, and each doc's stamped story subtrees, keyed on
 * every input the stamp reads. A doc whose keys are unchanged contributes the SAME NoteProps
 * objects it contributed last time, and that reference stability is what lets the React memo
 * chain stop at the cards whose own file actually changed.
 *
 * Stamping clones, it does not version. The stamp writes seq, level, parent_notes, origin and
 * stable_id onto the notes it walks, so running it over a cached subtree would change what a card
 * renders without changing anything React compares, and the board would keep showing the old one.
 * Every stamp therefore runs over a fresh clone and the parsed tree itself is never written to. A
 * version counter was the alternative and is worse: it still hands React the same object, so every
 * memo comparison in the tree has to opt into checking it and one that forgets fails silently,
 * whereas a clone makes "this subtree changed" and "these are different objects" the same fact.
 * The single field a reused subtree does take is `parent_notes[0]`, re-pointed at the current
 * merge's synthetic root; the two roots carry identical observable fields, so nothing a note
 * renders depends on which of them it points at.
 *
 * Seqs are laid out on a fixed grid rather than counted off a running total, so one file's
 * numbers do not move when a sibling file changes - see storySeqBase. The grid has two bounds, and
 * breaking either gives two notes the same seq rather than an error: a board may carry fewer than
 * SEQ_FILE_SLOT_COUNT files, and a story fewer than SEQ_STORY_STRIDE notes. Both constants carry
 * what holds them and what raising them costs.
 *
 * See design in docstech/users/alex.stanhope/todo.md (story "Aggregate (Folder) view").
 */

/**
 * AggregatedDocInput is one source file's contribution to mergeAggregateRoot.
 * - mtime: on-disk modification time (epoch ms) - stamped onto every story's origin so within-band ordering can surface recently-edited files
 * - hash_sha256: content hash, the key the per-doc caches compare; absent, they fall back to comparing `text`
 */
export interface AggregatedDocInput {
    id: string;
    path: string;
    relative_path?: string;
    content: MdastInput;
    text: string;
    mtime?: number;
    hash_sha256?: string;
}

export interface MergeAggregateRootResult {
    root: NoteProps;
    all_notes: NoteProps[];
}

/**
 * one parsed source file.
 * - root: synthetic root from convertMdastToNoteHierarchy
 * - h1: the file's # heading, if any
 */
interface PerFileParse {
    doc: AggregatedDocInput;
    root: NoteProps;
    h1: NoteProps | undefined;
}

/**
 * an epic registry entry. `name` is the stripped headline.
 */
interface EpicEntry {
    name: string;
    id: string | undefined;
}

/**
 * mutable accumulator threaded through walkStorySubtree.
 * - all_notes: flat list every walked note is pushed onto, in pre-order
 * - next_seq: the next seq to assign, seeded at the story's block base and incremented per note
 */
interface SeqWalkContext {
    all_notes: NoteProps[];
    next_seq: number;
}

interface CollectedStory {
    story: NoteProps;
    origin: NoteOrigin;
}

/**
 * one doc's parsed tree, held between merges.
 * - content_key: the doc content this tree was parsed from, compared to decide a re-parse
 */
interface ConvertedDoc {
    content_key: string;
    root: NoteProps;
}

/**
 * one file's stamped contribution to a board, held between merges.
 * - content_key / stamp_key: every input the stamp read, split so the content comparison stays a single string compare
 * - stories: the file's selected story roots, rank 0 first
 * - notes: each story's own pre-order note list, parallel to `stories`
 */
interface StampedFileEntry {
    content_key: string;
    stamp_key: string;
    stories: NoteProps[];
    notes: NoteProps[][];
}

/**
 * ConversionProbe counts the work merges actually did, for the perf harness and for tests that
 * assert the per-doc cache is doing its job.
 * - conversions: convertMdastToNoteHierarchy calls made on behalf of a folder merge
 * - merges: mergeAggregateRoot calls
 */
export interface ConversionProbe {
    conversions: number;
    merges: number;
}

// file H1 `order` linetag value: newest stories are appended at the bottom of the file (e.g. done.md)
const ORDER_NEWEST_AT_BOTTOM = 'newest-at-bottom';

/*
 * Seqs reserved for one story's subtree. A story holding more notes than this runs into the next
 * story's block and two notes end up sharing a seq, so the stamp reports any story that gets close.
 * The largest story in the repo's own boards is three orders of magnitude below it.
 */
export const SEQ_STORY_STRIDE = 8192;

/*
 * File slots in one rank band, and so the ceiling on how many source files a merged board can
 * number independently. A board carrying SEQ_FILE_SLOT_COUNT files or more would give the file at
 * slot 1024 the same seqs as the file at slot 0 one rank up: a silent identity collision, not a
 * crash. `MAX_AGGREGATE_FILES` in client/extension/src/constants.ts is what holds it, and
 * mergeAggregateRoot.test.ts pins the two together so raising that cap past this one turns the
 * suite red. Raising the cap means raising this constant in the same change.
 */
export const SEQ_FILE_SLOT_COUNT = 1024;

const conversion_probe: ConversionProbe = { conversions: 0, merges: 0 };

// the perf harness reads these counts off the page, where it has no way to reach a module-private binding
(globalThis as { __notethink_conversion_probe?: ConversionProbe }).__notethink_conversion_probe = conversion_probe;

export { FOLDER_VIEW_STATE_ID, anyViewInFolderMode } from "./viewstateops";

/**
 * A snapshot of the conversion probe. Returns a copy so a caller can compare two readings.
 */
export function conversionProbe(): ConversionProbe {
    return { ...conversion_probe };
}

/**
 * Zero the conversion probe. Each test case that asserts on it resets first, since the counts are
 * process-wide.
 */
export function resetConversionProbe(): void {
    conversion_probe.conversions = 0;
    conversion_probe.merges = 0;
}

/**
 * The content identity of a doc: its hash when the extension sent one, else the text itself, which
 * compares by reference for the docs a board actually re-merges.
 */
function docContentKey(doc: AggregatedDocInput): string {
    return doc.hash_sha256 ?? doc.text;
}

/**
 * Parse one doc into a NoteProps tree, counting the call for the probe.
 */
function convertCounted(doc: AggregatedDocInput): NoteProps {
    conversion_probe.conversions++;
    return convertMdastToNoteHierarchy(doc.content, doc.text);
}

/**
 * FolderMergeCache is one folder board's memory between merges, and the reason a watcher event on
 * one file does not re-parse and re-render the other 199. It holds each doc's parsed tree and each
 * doc's stamped story subtrees, both keyed on the inputs that produced them, and forgets a doc the
 * moment it leaves the board. A merge without one is correct and simply does all the work again,
 * which is what the tests that construct no cache exercise.
 *
 * Owned by the composer (one instance per mounted folder view) rather than by this module, so two
 * views, a test and a harness run never share counts or entries.
 */
export class FolderMergeCache {
    private conversions = new Map<string, ConvertedDoc>();
    private stamped = new Map<string, StampedFileEntry>();

    /**
     * The doc's parsed tree, re-parsing only when its content key has moved.
     */
    convert(doc: AggregatedDocInput): NoteProps {
        const content_key = docContentKey(doc);
        const cached = this.conversions.get(doc.id);
        if (cached && cached.content_key === content_key) { return cached.root; }
        const root = convertCounted(doc);
        this.conversions.set(doc.id, { content_key, root });
        return root;
    }

    /**
     * The doc's stamped stories when every stamp input still matches, else undefined.
     */
    stampedFor(doc_id: string, content_key: string, stamp_key: string): StampedFileEntry | undefined {
        const cached = this.stamped.get(doc_id);
        if (!cached || cached.content_key !== content_key || cached.stamp_key !== stamp_key) { return undefined; }
        return cached;
    }

    putStamped(doc_id: string, entry: StampedFileEntry): void {
        this.stamped.set(doc_id, entry);
    }

    /**
     * Forget every doc outside `doc_ids`, so a file removed from the board (deleted, renamed, or
     * filtered out) stops holding its parsed tree and its stamped subtrees alive.
     */
    retain(doc_ids: Set<string>): void {
        for (const id of [...this.conversions.keys()]) {
            if (!doc_ids.has(id)) { this.conversions.delete(id); }
        }
        for (const id of [...this.stamped.keys()]) {
            if (!doc_ids.has(id)) { this.stamped.delete(id); }
        }
    }
}

/**
 * The first seq of one story's block.
 *
 * Seqs sit on a fixed (file_rank, file_slot) grid instead of counting off a running total, so a
 * story's numbers follow from its own file's position and its own rank within that file and from
 * nothing any other file does: a sibling file gaining, losing or rewriting a story leaves them
 * alone, which is what keeps an unchanged card out of the memo comparisons that read a seq. Rank is
 * the major term because the merged reading order is rank-major (rank 0 of every file, then rank 1),
 * so block bases still sort exactly where the round-robin interleave puts their stories. The grid is
 * sparse by construction: seqs are unique and ordered, never contiguous.
 */
function storySeqBase(file_slot: number, file_rank: number): number {
    if (file_slot >= SEQ_FILE_SLOT_COUNT) {
        debug('file slot %d is past the %d-slot grid, so this file shares its seqs with another file', file_slot, SEQ_FILE_SLOT_COUNT);
    }
    return ((file_rank * SEQ_FILE_SLOT_COUNT) + file_slot + 1) * SEQ_STORY_STRIDE;
}

// a children_body entry is a child note rather than a raw mdast body node when it carries a seq
function isChildNoteItem(item: NoteProps | MdastNode): boolean {
    return 'seq' in item && typeof (item as NoteProps).seq === 'number';
}

/**
 * Deep-copy one story subtree, sharing everything the stamp never writes: the mdast `children`
 * arrays (so the node-keyed render cache in renderops still hits for an unchanged doc), `position`,
 * and any pre-rendered headline. `children_body` mixes child notes with raw mdast nodes and its
 * notes are the same objects as `child_notes`, so both go through one `clones` map and the copy
 * keeps that shared identity. Linetags are copied because the stamp writes `note_seq` into them.
 */
function cloneStorySubtree(note: NoteProps, clones: Map<NoteProps, NoteProps>): NoteProps {
    const existing = clones.get(note);
    if (existing) { return existing; }
    const clone: NoteProps = { ...note };
    clones.set(note, clone);
    if (note.linetags) {
        const linetags: { [key: string]: LineTag } = {};
        for (const key of Object.keys(note.linetags)) {
            linetags[key] = { ...note.linetags[key] };
        }
        clone.linetags = linetags;
    }
    if (note.child_notes) {
        clone.child_notes = note.child_notes.map(child => cloneStorySubtree(child, clones));
    }
    clone.children_body = (note.children_body ?? []).map(item => (
        isChildNoteItem(item) ? cloneStorySubtree(item as NoteProps, clones) : item
    ));
    return clone;
}

/**
 * Select a single file's contributed stories for the merged view: trim to at
 * most `max` entries and orient them newest-first so they sort consistently
 * with `newest-at-top` files.
 *
 * `order` is the file H1's `order` linetag value. `newest-at-bottom` means the
 * newest stories sit at the END of the file: keep the LAST `max`, then reverse
 * so the newest (document-bottom) story gets the smallest merged seq and sorts
 * to the top of its column - the reversal applies even when uncapped. Anything
 * else (`newest-at-top`, an unrecognised value, or absent) keeps the FIRST
 * `max` in document order, which is already newest-first. `max` undefined → no
 * cap; `<= 0` → keep none; `>=` length → keep all.
 */
function selectFileStories<T>(stories: T[], max: number | undefined, order: string | undefined): T[] {
    const newest_at_bottom = order === ORDER_NEWEST_AT_BOTTOM;
    let kept: T[];
    if (max === undefined || max >= stories.length) {
        kept = stories;
    } else if (max <= 0) {
        kept = [];
    } else if (newest_at_bottom) {
        kept = stories.slice(stories.length - max);
    } else {
        kept = stories.slice(0, max);
    }
    // newest-at-bottom files are stored oldest-first; reverse (on a copy - kept may alias the caller's array) so the newest story sorts to the top of its column
    return newest_at_bottom ? [...kept].reverse() : kept;
}

/**
 * Strip a heading's markdown prefix + trailing linetags down to its bare display text. Tolerates an
 * undefined headline (returns '').
 */
function safeStripHeadline(headline_raw: string | undefined): string {
    return headline_raw ? stripHeadlineLinetags(headline_raw) : '';
}

/**
 * Build an EpicEntry from a depth-2 (`##`) heading note: its stripped headline as the name and its
 * `id=` linetag as the id. The single source of the structural-epic shape, shared by the registry
 * builder, the folder-mode collect loop, and the single-file descent.
 */
function epicEntryFromHeading(note: NoteProps): EpicEntry {
    return { name: safeStripHeadline(note.headline_raw), id: note.linetags?.id?.value };
}

/**
 * Identify the file H1 (a single depth-1 note among the doc root's direct children).
 * If multiple or none, returns undefined. Exported so the App-layer auto-integration
 * resolver can read the opened file's H1 linetags (nt_integration_mode / nt_breadcrumb_last)
 * the same way file_view_type is read here.
 */
export function findFileH1(root: NoteProps): NoteProps | undefined {
    const h1s = (root.child_notes || []).filter(n => n.depth === 1);
    if (h1s.length === 1) { return h1s[0]; }
    return undefined;
}

/**
 * The view type a single file declares: its H1 `nt_view` (legacy `ng_view`) over the front-matter
 * value (most-specific wins) - the single-file analogue of the per-file file_view_type folder mode
 * captures. The composer uses it to decide whether a nested file renders as a column-based board (and
 * so should descend to story cards). undefined when the file declares no view.
 */
export function fileDeclaredViewType(root: NoteProps): string | undefined {
    const h1 = findFileH1(root);
    return resolveNamespacedTag(h1?.linetags, 'view')?.value ?? resolveNamespacedTag(root.linetags, 'view')?.value;
}

/**
 * The card type a single file declares: its H1 `nt_card` (legacy `ng_card`) over the front-matter
 * value (most-specific wins) - the card-axis analogue of fileDeclaredViewType, orthogonal to it. Every
 * story of the file carries it on origin.file_card_type, and AutoView majority-votes it across the
 * merged tree exactly as it votes the view type. undefined when the file declares no card type.
 */
export function fileDeclaredCardType(root: NoteProps): string | undefined {
    const h1 = findFileH1(root);
    return resolveNamespacedTag(h1?.linetags, 'card')?.value ?? resolveNamespacedTag(root.linetags, 'card')?.value;
}

/**
 * The group-by key a single file declares: its H1 `nt_group_by` over the front-matter value
 * (most-specific wins) - the per-file analogue of file_group_by, majority-voted across the merged tree
 * to auto-resolve the Line view's group key exactly as fileDeclaredViewType feeds view-type auto. Value
 * is a candidate key ('assignee') or an implicit key in nt_ form ('nt_first_level_folder').
 */
export function fileDeclaredGroupBy(root: NoteProps): string | undefined {
    const h1 = findFileH1(root);
    return resolveNamespacedTag(h1?.linetags, 'group_by')?.value ?? resolveNamespacedTag(root.linetags, 'group_by')?.value;
}

/**
 * The lane order a single file declares: its H1 `nt_group_order` over the front-matter value. The
 * authored per-axis order for grouped's group key; captured onto every story's origin so the view can
 * seed lane order from the files without a separate config round-trip.
 */
export function fileDeclaredGroupOrder(root: NoteProps): string | undefined {
    const h1 = findFileH1(root);
    return resolveNamespacedTag(h1?.linetags, 'group_order')?.value ?? resolveNamespacedTag(root.linetags, 'group_order')?.value;
}

/**
 * Resolve `epic` linetag value against this file's epic registry.
 * Returns origin.epic shape, or `{ name: value, id: undefined }` for unresolved literals.
 */
function resolveEpicLinetag(
    value: string,
    file_epic_by_id: Map<string, EpicEntry>,
    file_epic_by_name: Map<string, EpicEntry>,
): EpicEntry {
    const by_id = file_epic_by_id.get(value);
    if (by_id) { return by_id; }
    const by_name = file_epic_by_name.get(value);
    if (by_name) { return by_name; }
    return { name: value, id: undefined };
}

/**
 * Build a file's epic registries from its depth-2 (`##`) headings: by `id=` linetag and by stripped
 * headline name. Shared by folder mode (mergeAggregateRoot) and single-file descent
 * (flattenSingleFileStories) so an `epic=` linetag resolves identically in both. `walk_children` is the
 * level-2 children of the file H1 (or document root when there is no single H1).
 */
function buildFileEpicRegistries(walk_children: NoteProps[]): { file_epic_by_id: Map<string, EpicEntry>; file_epic_by_name: Map<string, EpicEntry> } {
    const file_epic_by_id = new Map<string, EpicEntry>();
    const file_epic_by_name = new Map<string, EpicEntry>();
    for (const c of walk_children) {
        if (c.depth === 2) {
            const entry = epicEntryFromHeading(c);
            if (entry.id) { file_epic_by_id.set(entry.id, entry); }
            if (entry.name) { file_epic_by_name.set(entry.name, entry); }
        }
    }
    return { file_epic_by_id, file_epic_by_name };
}

/**
 * extend an ordinal child path by one level. A subtree root's own path is '', so its first child is
 * '0' and that child's third child is '0.2'.
 */
function extendChildPath(child_path: string, index: number): string {
    return child_path === '' ? `${index}` : `${child_path}.${index}`;
}

/**
 * walk a story subtree: assign seqs from the story's own block, rewrite parent_notes/level, stamp
 * origin (including the pre-merge `source_position` copy of `position` so the
 * editor-caret matcher can resolve folder-mode focus in source-file offsets), and
 * keep linetag.note_seq in sync with the assigned seq. `child_path` is the note's
 * ordinal position under the story root, '' at the root itself: the root takes
 * `story_stable_id` verbatim and descendants derive `${story_stable_id}:${child_path}`,
 * so a length-changing edit anywhere in the file leaves their ids alone and only a
 * sibling insert or remove within the story renumbers them. Mutates the notes and
 * `ctx` (seq counter + all_notes list) in place.
 */
function walkStorySubtree(
    note: NoteProps,
    new_ancestors: NoteProps[],
    origin: NoteOrigin,
    story_stable_id: string,
    child_path: string,
    ctx: SeqWalkContext,
): void {
    note.seq = ctx.next_seq++;
    note.level = new_ancestors.length;
    note.parent_notes = new_ancestors.length ? [...new_ancestors] : undefined;
    // stamp a per-note origin that carries this note's source-file offsets; cloning here keeps cross-note origin shape (doc_id, project_hue, …) shared while source_position varies per-note
    const source_position = note.position ? {
        start: { offset: note.position.start.offset, line: note.position.start.line },
        end: { offset: note.position.end.offset, line: note.position.end.line },
        end_body: note.position.end_body ? { offset: note.position.end_body.offset, line: note.position.end_body.line } : undefined,
    } : undefined;
    note.origin = { ...origin, source_position };
    if (note.linetags) {
        for (const key of Object.keys(note.linetags)) {
            note.linetags[key].note_seq = note.seq;
        }
    }
    note.stable_id = child_path === '' ? story_stable_id : `${story_stable_id}:${child_path}`;
    ctx.all_notes.push(note);
    for (const [index, child] of (note.child_notes || []).entries()) {
        walkStorySubtree(child, [...new_ancestors, note], origin, story_stable_id, extendChildPath(child_path, index), ctx);
    }
}

/**
 * Parse every usable doc in the map, in the merge's stable file order (relative_path, falling back
 * to path). With a cache only the docs whose content key has moved are parsed again; without one
 * every doc is parsed, which is the behaviour a caller that passes no cache asks for.
 */
function parseAggregatedDocs(
    docs: { [key: string]: AggregatedDocInput | undefined },
    cache: FolderMergeCache | undefined,
): PerFileParse[] {
    const parsed: PerFileParse[] = [];
    for (const id of Object.keys(docs)) {
        const doc = docs[id];
        if (!doc || !doc.content || !doc.text) { continue; }
        const root = cache ? cache.convert(doc) : convertCounted(doc);
        parsed.push({ doc, root, h1: findFileH1(root) });
    }
    parsed.sort((a, b) => {
        const ar = a.doc.relative_path ?? a.doc.path;
        const br = b.doc.relative_path ?? b.doc.path;
        return ar < br ? -1 : ar > br ? 1 : 0;
    });
    return parsed;
}

/**
 * The universe of project names pill labels are derived against: the workspace list when the
 * extension supplied one, then any visible-set project it did not already name. The
 * workspace-driven seed keeps labels stable across folder descents. Hue needs no universe - it is
 * an identity hash of the project name (hueForProjectName) and so is set-independent.
 */
function distinctProjectNames(parsed: PerFileParse[], workspace_projects: string[] | undefined): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of (workspace_projects ?? [])) {
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }
    for (const file of parsed) {
        const project_name = projectNameFromRelativePath(file.doc.relative_path);
        if (project_name && !seen.has(project_name)) {
            seen.add(project_name);
            names.push(project_name);
        }
    }
    return names;
}

/**
 * The synthetic root one merge hangs its stories off. Built fresh each merge so a board whose
 * content changed hands React a new note list, and carrying integration_path for breadcrumb/debug.
 */
function makeSyntheticRoot(integration_path: string): NoteProps {
    const synthetic_root: NoteProps = {
        seq: 0,
        level: 0,
        type: 'root',
        position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } },
        children: [],
        children_body: [],
        child_notes: [],
        headline_raw: '',
        body_raw: '',
        stable_id: `__folder__:${integration_path}`,
    };
    (synthetic_root as NoteProps & { integration_path?: string }).integration_path = integration_path;
    return synthetic_root;
}

/**
 * Every stamp input that does not come from the doc's content, joined into one comparable key. A
 * mismatch is what forces a file's stories to be stamped onto fresh clones, so anything the stamp
 * reads and the content key does not cover belongs here: the doc's own location and mtime, the
 * project label (derived against the whole board's universe), the file's slot in the merged file
 * order, and the per-file story cap.
 */
function fileStampKey(
    doc: AggregatedDocInput,
    file_slot: number,
    project_label: string | undefined,
    maxNotesPerFile: number | undefined,
): string {
    return [
        doc.path,
        doc.relative_path ?? '',
        doc.mtime ?? '',
        project_label ?? '',
        file_slot,
        maxNotesPerFile ?? '',
    ].join(' ');
}

/**
 * This file's full ordered story contribution (direct + epic-nested) in document order.
 * selectFileStories then trims and orients it, and the round-robin pass interleaves it with the
 * other files. Stories are still the parsed tree's own notes here - the stamp clones them.
 */
function collectFileStories(walk_children: NoteProps[], base_origin: Omit<NoteOrigin, 'epic'>): CollectedStory[] {
    const file_stories: CollectedStory[] = [];
    for (const c of walk_children) {
        if (c.depth === 3) {
            // story directly under H1 (or doc root, in no-H1 case)
            file_stories.push({ story: c, origin: { ...base_origin } });
        } else if (c.depth === 2) {
            // epic: recurse one level
            const epic_entry = epicEntryFromHeading(c);
            for (const g of (c.child_notes || [])) {
                if (g.depth === 3) {
                    file_stories.push({ story: g, origin: { ...base_origin, epic: epic_entry } });
                }
            }
        }
        // ignore other depths and non-heading types at file root
    }
    return file_stories;
}

/**
 * Resolve a collected story's `epic` linetag (direct > inherited > structural). The
 * applyChildAttributeInheritance pass during convertMdastToNoteHierarchy has already collapsed an
 * inherited nt_child_epic= onto the story as a regular `epic` linetag (with inherited: true), and a
 * direct linetag overwrites an inherited one, so this covers both uniformly. With no linetag the
 * structural epic set during collection stays, or undefined.
 */
function resolveCollectedEpic(
    collected_story: CollectedStory,
    file_epic_by_id: Map<string, EpicEntry>,
    file_epic_by_name: Map<string, EpicEntry>,
): void {
    const epic_linetag: LineTag | undefined = collected_story.story.linetags?.epic;
    if (epic_linetag?.value) {
        collected_story.origin.epic = resolveEpicLinetag(epic_linetag.value, file_epic_by_id, file_epic_by_name);
    }
}

/**
 * The per-file origin every one of its stories starts from, before rank and epic are stamped on.
 * Each file-level value takes an H1 linetag over the front-matter one (most-specific wins).
 */
function fileBaseOrigin(
    file: PerFileParse,
    project_name: string | undefined,
    project_label: string | undefined,
): Omit<NoteOrigin, 'epic'> {
    const { doc, root } = file;
    return {
        doc_id: doc.id,
        doc_path: doc.path,
        relative_path: doc.relative_path,
        file_view_type: fileDeclaredViewType(root),
        file_card_type: fileDeclaredCardType(root),
        file_group_by: fileDeclaredGroupBy(root),
        file_group_order: fileDeclaredGroupOrder(root),
        file_mtime: doc.mtime,
        project_hue: project_name ? hueForProjectName(project_name) : undefined,
        project_label,
    };
}

/**
 * Stamp one file's selected stories onto clones of its parsed subtrees, each numbered from its own
 * (file_slot, rank) block. The clone is what keeps the parsed tree reusable and what makes a real
 * change visible to React as a new object.
 */
function stampFileStories(
    file: PerFileParse,
    file_slot: number,
    project_label: string | undefined,
    maxNotesPerFile: number | undefined,
    synthetic_root: NoteProps,
): { stories: NoteProps[]; notes: NoteProps[][] } {
    const { doc, root, h1 } = file;
    // walk_children returns the level-2 children of either H1 or doc root
    const walk_children = h1 ? (h1.child_notes || []) : (root.child_notes || []);
    // register this file's epics (## headings) so direct/inherited epic= linetags resolve by id or name
    const { file_epic_by_id, file_epic_by_name } = buildFileEpicRegistries(walk_children);
    const base_origin = fileBaseOrigin(file, projectNameFromRelativePath(doc.relative_path), project_label);
    // `order` for the per-file cap: an H1 value overrides the document-root (front-matter) value
    const file_order = h1?.linetags?.order?.value ?? root.linetags?.order?.value;
    const selected = selectFileStories(collectFileStories(walk_children, base_origin), maxNotesPerFile, file_order);
    const stories: NoteProps[] = [];
    const notes: NoteProps[][] = [];
    // per-(doc_id, slug) counter so two same-headline stories in a file get distinct ids (#1, #2, …)
    const slug_counts = new Map<string, number>();
    for (const [rank, collected_story] of selected.entries()) {
        resolveCollectedEpic(collected_story, file_epic_by_id, file_epic_by_name);
        // stamp the per-file rank so relevance ordering can break ties among equal-rank stories
        collected_story.origin.file_rank = rank;
        const story = cloneStorySubtree(collected_story.story, new Map());
        const ctx: SeqWalkContext = { all_notes: [], next_seq: storySeqBase(file_slot, rank) };
        walkStorySubtree(story, [synthetic_root], collected_story.origin, storyStableIdFor(collected_story, slug_counts), '', ctx);
        if (ctx.all_notes.length > SEQ_STORY_STRIDE) {
            debug('story %s holds %d notes, past the %d-seq block stride', story.stable_id, ctx.all_notes.length, SEQ_STORY_STRIDE);
        }
        stories.push(story);
        notes.push(ctx.all_notes);
    }
    return { stories, notes };
}

/**
 * The story's stable_id: `${doc_id}:${slug}`, with a `#N` occurrence ordinal when the file already
 * used that slug.
 */
function storyStableIdFor(collected_story: CollectedStory, slug_counts: Map<string, number>): string {
    const slug_key = `${collected_story.origin.doc_id}:${storyStableIdSlug(collected_story.story)}`;
    const prior_count = slug_counts.get(slug_key) ?? 0;
    slug_counts.set(slug_key, prior_count + 1);
    return prior_count === 0 ? slug_key : `${slug_key}#${prior_count}`;
}

/**
 * Point a reused file's notes at this merge's synthetic root. The old and new roots carry identical
 * observable fields, so this is the one write a cached subtree takes and nothing rendered from it
 * changes; it exists so no note holds a root the current tree has replaced.
 */
function reparentStampedFile(entry: StampedFileEntry, synthetic_root: NoteProps): void {
    for (const story_notes of entry.notes) {
        for (const note of story_notes) {
            if (note.parent_notes?.length) { note.parent_notes[0] = synthetic_root; }
        }
    }
}

/**
 * One file's stamped contribution, taken from the cache when every stamp input still matches and
 * built (and cached) otherwise.
 */
function fileContribution(
    file: PerFileParse,
    file_slot: number,
    project_label_by_name: Map<string, string>,
    maxNotesPerFile: number | undefined,
    synthetic_root: NoteProps,
    cache: FolderMergeCache | undefined,
): StampedFileEntry {
    const project_name = projectNameFromRelativePath(file.doc.relative_path);
    const project_label = project_name ? project_label_by_name.get(project_name) : undefined;
    const content_key = docContentKey(file.doc);
    const stamp_key = fileStampKey(file.doc, file_slot, project_label, maxNotesPerFile);
    const cached = cache?.stampedFor(file.doc.id, content_key, stamp_key);
    if (cached) {
        reparentStampedFile(cached, synthetic_root);
        return cached;
    }
    const stamped = stampFileStories(file, file_slot, project_label, maxNotesPerFile, synthetic_root);
    const entry: StampedFileEntry = { content_key, stamp_key, ...stamped };
    cache?.putStamped(file.doc.id, entry);
    return entry;
}

/**
 * Build the merged synthetic root from a set of documents.
 *
 * Walks each doc's H1 (or document root if no H1) and collects depth-3 headings as stories.
 * Depth-2 headings are treated as epics: their depth-3 children become stories with
 * structural origin.epic. Direct `epic=` linetags (including those propagated from
 * `nt_child_epic=` ancestors via applyChildAttributeInheritance) override structural.
 *
 * Interleaves the files round-robin by per-file rank so each column shows the latest picture across
 * projects: rank 0 of every file in stable file order, then rank 1, and so on, a file with fewer
 * stories simply dropping out of later rounds. Assigns each story's subtree its own seq block and
 * rewrites parent_notes so the merged tree has a single root.
 *
 * `maxNotesPerFile` (optional) caps how many top-level stories each source file
 * contributes. Undefined → no cap (unchanged behaviour). Which end is kept depends on
 * the file H1's `order` linetag (see selectFileStories).
 *
 * `workspace_projects` (optional) is the universe of top-level subfolder names of the
 * VS Code workspace root (already exclude-filter applied and sorted by the extension).
 * When provided + non-empty, this is the stable universe used to assign pill labels and
 * hue indices so descending into a sub-project doesn't re-derive labels against a smaller
 * visible set (e.g. "NT" suddenly becoming "NO"). When undefined / empty, falls back to
 * the visible-set derivation (preserves the legacy behaviour for tests and single-file callers).
 *
 * `cache` (optional) is the board's FolderMergeCache. Pass the same instance on every merge of one
 * board and an unchanged file re-contributes the very NoteProps objects it contributed last time;
 * omit it and every file is parsed and stamped afresh.
 */
export function mergeAggregateRoot(
    docs: { [key: string]: AggregatedDocInput | undefined },
    integration_path: string,
    maxNotesPerFile?: number,
    workspace_projects?: string[],
    cache?: FolderMergeCache,
): MergeAggregateRootResult {
    conversion_probe.merges++;
    const parsed = parseAggregatedDocs(docs, cache);
    // 2-character pill label per project - first letter + earliest character that differentiates this project from any other in the universe (notethink→NT, notebook→NB)
    const project_label_by_name = buildProjectLabels(distinctProjectNames(parsed, workspace_projects));
    const synthetic_root = makeSyntheticRoot(integration_path);
    const per_file = parsed.map((file, file_slot) => fileContribution(file, file_slot, project_label_by_name, maxNotesPerFile, synthetic_root, cache));
    const all_notes: NoteProps[] = [synthetic_root];
    const max_file_stories = per_file.reduce((max_len, entry) => Math.max(max_len, entry.stories.length), 0);
    for (let rank = 0; rank < max_file_stories; rank++) {
        for (const entry of per_file) {
            if (rank >= entry.stories.length) { continue; }
            synthetic_root.child_notes!.push(entry.stories[rank]);
            synthetic_root.children_body.push(entry.stories[rank]);
            for (const note of entry.notes[rank]) { all_notes.push(note); }
        }
    }
    cache?.retain(new Set(parsed.map(file => file.doc.id)));
    return { root: synthetic_root, all_notes };
}

/**
 * Reads the integration_path from the folder viewState. Checks the canonical key first, then
 * falls back to the first legacy entry that resolves to folder mode for state stranded under a
 * doc-path key by the pre-fix dispatch bug (legacy rescue). An `auto` view state whose path was
 * seeded by auto-resolution resolves folder via resolveIntegrationMode, so it is picked up here.
 */
export function firstIntegrationPath(
    view_states: Record<string, { display_options?: { integration_mode?: string; integration_path?: string } }> | undefined,
): string | undefined {
    if (!view_states) { return undefined; }
    const canonical = view_states[FOLDER_VIEW_STATE_ID];
    if (canonical && resolveIntegrationMode(canonical.display_options) === INTEGRATION_MODE_FOLDER && typeof canonical.display_options?.integration_path === 'string') {
        return canonical.display_options.integration_path;
    }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        const v = view_states[id];
        if (v && resolveIntegrationMode(v.display_options) === INTEGRATION_MODE_FOLDER && typeof v.display_options?.integration_path === 'string') {
            return v.display_options.integration_path;
        }
    }
    return undefined;
}

/**
 * stamp `stable_id` onto every note in a single-file parsed tree (the result of
 * convertMdastToNoteHierarchy). Mirrors the folder-mode rule but uses the
 * active doc id as the namespacing prefix, since single-file notes carry no
 * `origin`. Walks every note in the tree and treats each note in the chain as
 * a candidate "story root" using the same slug derivation as folder mode
 * (linetags.id when present, else stripped headline). Depth-3 headings act as
 * story roots (matching the kanban card grouping); their descendants get
 * `${story_stable_id}:${child_path}`, an ordinal path that only a sibling
 * insert or remove disturbs. Notes shallower than depth-3 (the file's H1 and
 * ## epic wrappers) get their own slug-based stable_id so view code that keys
 * on them remains stable across re-parse too.
 *
 * Mutates the passed root tree in place. Idempotent - safe to call twice.
 */
export function stampSingleFileStableIds(root: NoteProps, doc_id: string): void {
    // synthetic root keys off doc_id so single-file view-state survives a flip to/from folder mode
    root.stable_id = `${doc_id}:__root__`;
    const slug_counts = new Map<string, number>();
    for (const [index, child] of (root.child_notes ?? []).entries()) {
        walkSingleFileStableIds(child, doc_id, slug_counts, null, extendChildPath('', index));
    }
}

/**
 * recursively stamp `stable_id` down one subtree. A story-candidate note (depth ≤ 3)
 * mints a fresh slug-based id (deduplicated within the file via `slug_counts`) and
 * becomes the story root passed to its descendants, which resets `child_path` to ''
 * so ordinals count from that root; deeper notes derive
 * `${story_stable_id}:${child_path}` and so survive any length-changing edit,
 * churning only when a sibling on the path is inserted or removed. A note ahead of
 * the file's first heading has no enclosing story and hangs off the synthetic root
 * as `${doc_id}:__root__:${child_path}` instead.
 */
function walkSingleFileStableIds(
    note: NoteProps,
    doc_id: string,
    slug_counts: Map<string, number>,
    story_stable_id: string | null,
    child_path: string,
): void {
    let next_story_stable_id = story_stable_id;
    let next_parent_path = child_path;
    if (note.depth !== undefined && note.depth <= 3) {
        const slug_key = `${doc_id}:${storyStableIdSlug(note)}`;
        const prior_count = slug_counts.get(slug_key) ?? 0;
        slug_counts.set(slug_key, prior_count + 1);
        note.stable_id = prior_count === 0 ? slug_key : `${slug_key}#${prior_count}`;
        next_story_stable_id = note.stable_id;
        next_parent_path = '';
    } else if (story_stable_id !== null) {
        note.stable_id = `${story_stable_id}:${child_path}`;
    } else {
        note.stable_id = `${doc_id}:__root__:${child_path}`;
    }
    for (const [index, child] of (note.child_notes ?? []).entries()) {
        walkSingleFileStableIds(child, doc_id, slug_counts, next_story_stable_id, extendChildPath(next_parent_path, index));
    }
}

/**
 * Re-level a lifted single-file story subtree so the story root sits at `level` directly under
 * `parent_chain`, descendants incrementing from there. Mirrors walkStorySubtree's level/parent_notes
 * rewrite but leaves seq / position / stable_id untouched - single-file mode keeps the file's own
 * text coordinates so edit offsets stay valid. Mutates in place.
 */
function relevelStorySubtree(note: NoteProps, parent_chain: NoteProps[], level: number): void {
    note.level = level;
    note.parent_notes = parent_chain.length ? [...parent_chain] : undefined;
    for (const child of (note.child_notes ?? [])) {
        relevelStorySubtree(child, [...parent_chain, note], level + 1);
    }
}

/**
 * Single-file (current_file) story descent - the current_file companion to mergeAggregateRoot's
 * folder-mode flatten. When the opened doc is NESTED (a `##` epic with `###` story children),
 * restructure the rendered scope (its H1, or the document root when there is no single H1) so its
 * children are the `###` stories: a nested file opened on its own then renders its stories as kanban
 * cards partitioned by status, each tagged with its `##` epic - matching the folder-mode board and the
 * AUTHORING_GUIDE's "### is the unit that becomes a card" contract. FLAT files (`##` directly under
 * `#`, no `###` grandchildren) are detected structurally and left byte-identical.
 *
 * Epic resolution reuses the folder-mode machinery (buildFileEpicRegistries + resolveEpicLinetag), so
 * precedence is identical: a direct `epic=` linetag (or an inherited `nt_child_epic=` already collapsed
 * onto the story by convertMdastToNoteHierarchy) overrides the structural `##` parent. Each lifted
 * story is re-leveled to 1 (so MarkdownNoteHeadline's `level === 1` gate renders the epic chip) and
 * stamped a MINIMAL origin = { doc_id, doc_path, epic } - no relative_path / project_* / source_position
 * - so OriginPill renders the epic chip without a project pill, the editor-caret matcher falls through
 * to its in-tree path, and drag-drop routes the one doc. note.position and note.seq are preserved
 * verbatim. Mutates the tree in place; run before stampSingleFileStableIds.
 *
 * Requires a single file H1 (the `#` root the AUTHORING_GUIDE assumes): the stories lift under it,
 * which keeps the H1 as the rendered scope and stops the document root (seq 0, empty headline) from
 * looking like a folder aggregate. A file with zero or multiple H1s is left unchanged.
 */
export function flattenSingleFileStories(root: NoteProps, doc_id: string, doc_path: string): void {
    const parent = findFileH1(root);
    if (!parent) { return; }
    const walk_children = parent.child_notes ?? [];
    const is_nested = walk_children.some(c => c.depth === 2 && (c.child_notes ?? []).some(g => g.depth === 3));
    if (!is_nested) { return; }
    const { file_epic_by_id, file_epic_by_name } = buildFileEpicRegistries(walk_children);
    // collect ### stories: directly under the scope (no structural epic) and under ## epics (structural epic = the ## headline), mirroring mergeAggregateRoot's walk_children pass
    const collected: Array<{ story: NoteProps; structural_epic: EpicEntry | undefined }> = [];
    for (const c of walk_children) {
        if (c.depth === 3) {
            collected.push({ story: c, structural_epic: undefined });
        } else if (c.depth === 2) {
            const epic_entry = epicEntryFromHeading(c);
            for (const g of (c.child_notes ?? [])) {
                if (g.depth === 3) { collected.push({ story: g, structural_epic: epic_entry }); }
            }
        }
    }
    for (const { story, structural_epic } of collected) {
        const epic_linetag = story.linetags?.epic;
        const resolved_epic = epic_linetag?.value
            ? resolveEpicLinetag(epic_linetag.value, file_epic_by_id, file_epic_by_name)
            : structural_epic;
        // keep the epic object whenever one resolved (matching folder mode, which stamps a structural epic even for an empty ## headline); only a story with no epic at all carries undefined
        story.origin = { doc_id, doc_path, epic: resolved_epic ? { name: resolved_epic.name, id: resolved_epic.id } : undefined };
        relevelStorySubtree(story, [parent], 1);
    }
    // re-link the scope so both the kanban card set (child_notes) and the flatten-walk source (children_body, read by flattenAllNotes) are exactly the lifted stories
    const lifted = collected.map(c => c.story);
    parent.child_notes = lifted;
    parent.children_body = lifted;
}

// MdastNode is re-exported as a convenience to consumers that already import from this file
export type { MdastNode };

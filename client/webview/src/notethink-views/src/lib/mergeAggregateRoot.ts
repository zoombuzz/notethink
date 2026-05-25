import Debug from "debug";
import { convertMdastToNoteHierarchy, type MdastInput } from "./convertMdastToNoteHierarchy";
import { stripHeadlineLinetags } from "./noteops";
import { buildProjectLabels, hueForProjectIndex, projectNameFromRelativePath } from "../components/notes/OriginPill";
import type { LineTag, MdastNode, NoteProps, NoteOrigin } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:mergeAggregateRoot");

/**
 * Aggregate (Folder) mode entry point.
 *
 * Takes a map of source documents and an integration folder path; returns a single
 * synthetic root NoteProps whose children are the depth-3 "stories" gathered from every
 * doc, each stamped with origin metadata so callers can route edits back to the source file.
 *
 * See design in docstech/users/alex.stanhope/todo.md (story "Aggregate (Folder) view").
 */

/**
 * AggregatedDocInput is one source file's contribution to mergeAggregateRoot.
 * - mtime: on-disk modification time (epoch ms) — stamped onto every story's origin so within-band ordering can surface recently-edited files
 */
export interface AggregatedDocInput {
    id: string;
    path: string;
    relative_path?: string;
    content: MdastInput;
    text: string;
    mtime?: number;
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
 * derive the story-level stable_id slug from its raw headline + linetags. Prefers
 * the explicit `[](?id=...)` linetag (canonical, author-controlled) and falls back
 * to the stripped headline text. The caller is responsible for namespacing with
 * `doc_id` and disambiguating duplicates across the file. See the NoteProps
 * header comment for the full derivation rationale.
 */
function storyStableIdSlug(story: NoteProps): string {
    const id_value = story.linetags?.id?.value;
    if (id_value) { return id_value; }
    const stripped = stripHeadlineLinetags(story.headline_raw ?? '');
    return stripped || `headline:${story.position?.start?.line ?? 0}`;
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
 * - all_notes: flat list every walked note is pushed onto
 * - next_seq: the next global seq to assign (incremented per note)
 */
interface SeqWalkContext {
    all_notes: NoteProps[];
    next_seq: number;
}

interface CollectedStory {
    story: NoteProps;
    origin: NoteOrigin;
    file_epic_by_id: Map<string, EpicEntry>;
    file_epic_by_name: Map<string, EpicEntry>;
}

// file H1 `order` linetag value: newest stories are appended at the bottom of the file (e.g. done.md)
const ORDER_NEWEST_AT_BOTTOM = 'newest-at-bottom';

/**
 * canonical viewState key for folder mode. All folder-mode reads and writes use this key so settings (column_order, filters, view type, etc.) survive a flip to current_file mode and back.
 */
export const FOLDER_VIEW_STATE_ID = '__folder__';

/**
 * Select a single file's contributed stories for the merged view: trim to at
 * most `max` entries and orient them newest-first so they sort consistently
 * with `newest-at-top` files.
 *
 * `order` is the file H1's `order` linetag value. `newest-at-bottom` means the
 * newest stories sit at the END of the file: keep the LAST `max`, then reverse
 * so the newest (document-bottom) story gets the smallest merged seq and sorts
 * to the top of its column — the reversal applies even when uncapped. Anything
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
    // newest-at-bottom files are stored oldest-first; reverse (on a copy — kept may alias the caller's array) so the newest story sorts to the top of its column
    return newest_at_bottom ? [...kept].reverse() : kept;
}

/**
 * Resolve the absolute path of the folder the aggregation is scoped to.
 * For breadcrumb segmenting we pass this through unchanged; callers segment it.
 */
function safeStripHeadline(headline_raw: string | undefined): string {
    return headline_raw ? stripHeadlineLinetags(headline_raw) : '';
}

/**
 * Identify the file H1 (a single depth-1 note among the doc root's direct children).
 * If multiple or none, returns undefined.
 */
function findFileH1(root: NoteProps): NoteProps | undefined {
    const h1s = (root.child_notes || []).filter(n => n.depth === 1);
    if (h1s.length === 1) { return h1s[0]; }
    return undefined;
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
 * walk a story subtree: assign sequential seqs, rewrite parent_notes/level, stamp
 * origin, and keep linetag.note_seq in sync with the renumbered seq. The story root
 * takes `story_stable_id` verbatim; descendants derive
 * `${story_stable_id}:${relative_offset}` against the story's own start offset so
 * sibling-story insertions elsewhere in the file don't churn their ids. Mutates the
 * notes and `ctx` (seq counter + all_notes list) in place.
 */
function walkStorySubtree(
    note: NoteProps,
    new_ancestors: NoteProps[],
    origin: NoteOrigin,
    story_stable_id: string,
    story_start_offset: number,
    is_story_root: boolean,
    ctx: SeqWalkContext,
): void {
    note.seq = ctx.next_seq++;
    note.level = new_ancestors.length;
    note.parent_notes = new_ancestors.length ? [...new_ancestors] : undefined;
    note.origin = origin;
    if (note.linetags) {
        for (const key of Object.keys(note.linetags)) {
            note.linetags[key].note_seq = note.seq;
        }
    }
    if (is_story_root) {
        note.stable_id = story_stable_id;
    } else {
        const relative_offset = (note.position?.start?.offset ?? 0) - story_start_offset;
        note.stable_id = `${story_stable_id}:${relative_offset}`;
    }
    ctx.all_notes.push(note);
    for (const child of (note.child_notes || [])) {
        walkStorySubtree(child, [...new_ancestors, note], origin, story_stable_id, story_start_offset, false, ctx);
    }
}

/**
 * Build the merged synthetic root from a set of documents.
 *
 * Walks each doc's H1 (or document root if no H1) and collects depth-3 headings as stories.
 * Depth-2 headings are treated as epics: their depth-3 children become stories with
 * structural origin.epic. Direct `epic=` linetags (including those propagated from
 * `ng_child_epic=` ancestors via applyChildAttributeInheritance) override structural.
 *
 * Renumbers seqs globally and rewrites parent_notes so the merged tree has a single root.
 *
 * `max_notes_per_file` (optional) caps how many top-level stories each source file
 * contributes. Undefined → no cap (unchanged behaviour). Which end is kept depends on
 * the file H1's `order` linetag (see trimFileStories).
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function mergeAggregateRoot(
    docs: { [key: string]: AggregatedDocInput | undefined },
    integration_path: string,
    max_notes_per_file?: number,
): MergeAggregateRootResult {
    // 1. parse each doc once
    const parsed: PerFileParse[] = [];
    for (const id of Object.keys(docs)) {
        const doc = docs[id];
        if (!doc || !doc.content || !doc.text) { continue; }
        const root = convertMdastToNoteHierarchy(doc.content, doc.text);
        parsed.push({ doc, root, h1: findFileH1(root) });
    }

    // stable file ordering: by relative_path, then path
    parsed.sort((a, b) => {
        const ar = a.doc.relative_path ?? a.doc.path;
        const br = b.doc.relative_path ?? b.doc.path;
        return ar < br ? -1 : ar > br ? 1 : 0;
    });

    // assign each distinct project (first path segment of relative_path) a hue based on its position in the sorted enumeration, fed through the golden-angle spread. The old djb2(name)%360 fallback in OriginPill happens to collide for real-world pairs like calfam/shopify-uncomplicated and notegit/countingsheet; a sorted-index assignment is the only way to guarantee a minimum gap on the hue wheel for arbitrary project names
    const project_hue_by_name = new Map<string, number>();
    const distinct_project_names: string[] = [];
    for (const file of parsed) {
        const project_name = projectNameFromRelativePath(file.doc.relative_path);
        if (project_name && !project_hue_by_name.has(project_name)) {
            project_hue_by_name.set(project_name, hueForProjectIndex(project_hue_by_name.size));
            distinct_project_names.push(project_name);
        }
    }
    // 2-character pill label per project — first letter + earliest character that differentiates this project from any other in the merged aggregate (notegit→NG, notethink→NT)
    const project_label_by_name = buildProjectLabels(distinct_project_names);

    // 2. for each file, build epic registries and collect stories
    // each file's selected stories, kept in stable file order (parsed is sorted by relative_path)
    const per_file_lists: CollectedStory[][] = [];

    for (const file of parsed) {
        const { doc, root, h1 } = file;
        const file_epic_by_id = new Map<string, EpicEntry>();
        const file_epic_by_name = new Map<string, EpicEntry>();

        // walk_children returns the level-2 children of either H1 or doc root
        const walk_children = h1 ? (h1.child_notes || []) : (root.child_notes || []);

        // first pass over walk_children: register epics
        for (const c of walk_children) {
            if (c.depth === 2) {
                const epic_id = c.linetags?.id?.value;
                const epic_name = safeStripHeadline(c.headline_raw);
                const entry: EpicEntry = { name: epic_name, id: epic_id };
                if (epic_id) { file_epic_by_id.set(epic_id, entry); }
                if (epic_name) { file_epic_by_name.set(epic_name, entry); }
            }
        }

        // capture file-level ng_view from the H1 linetags (used by AutoView's majority vote)
        const file_view_type = h1?.linetags?.ng_view?.value;

        // file H1 `order` linetag decides which end the per-file cap keeps
        const file_order = h1?.linetags?.order?.value;

        const project_name = projectNameFromRelativePath(doc.relative_path);
        const base_origin: Omit<NoteOrigin, 'epic'> = {
            doc_id: doc.id,
            doc_path: doc.path,
            relative_path: doc.relative_path,
            file_view_type,
            file_mtime: doc.mtime,
            project_hue: project_name ? project_hue_by_name.get(project_name) : undefined,
            project_label: project_name ? project_label_by_name.get(project_name) : undefined,
        };

        // assemble this file's full ordered story contribution (direct + epic-nested) in document order; selectFileStories then trims + orients it, and the round-robin pass below interleaves it with the other files
        const file_stories: CollectedStory[] = [];
        for (const c of walk_children) {
            if (c.depth === 3) {
                // story directly under H1 (or doc root, in no-H1 case)
                file_stories.push({
                    story: c,
                    origin: { ...base_origin },
                    file_epic_by_id,
                    file_epic_by_name,
                });
            } else if (c.depth === 2) {
                // epic: recurse one level
                const epic_entry: EpicEntry = {
                    name: safeStripHeadline(c.headline_raw),
                    id: c.linetags?.id?.value,
                };
                for (const g of (c.child_notes || [])) {
                    if (g.depth === 3) {
                        file_stories.push({
                            story: g,
                            origin: { ...base_origin, epic: epic_entry },
                            file_epic_by_id,
                            file_epic_by_name,
                        });
                    }
                }
            }
            // ignore other depths and non-heading types at file root
        }

        per_file_lists.push(selectFileStories(file_stories, max_notes_per_file, file_order));
    }

    // interleave round-robin by per-file rank so each column shows the latest picture across projects: rank-0 of every file (in stable file order), then rank-1, etc; a file with fewer stories simply drops out of later rounds while longer ones keep contributing
    const collected: CollectedStory[] = [];
    const max_file_stories = per_file_lists.reduce((max_len, list) => Math.max(max_len, list.length), 0);
    for (let rank = 0; rank < max_file_stories; rank++) {
        for (const list of per_file_lists) {
            if (rank < list.length) {
                const cs = list[rank];
                // stamp the per-file rank so relevance ordering can break ties among equal-rank stories
                cs.origin.file_rank = rank;
                collected.push(cs);
            }
        }
    }

    // 3. resolve epic linetags on each story (direct > inherited > structural)
    // the applyChildAttributeInheritance pass during convertMdastToNoteHierarchy has already collapsed inherited ng_child_epic= onto stories as a regular `epic` linetag (with inherited: true); direct linetags overwrite inherited (child's own wins), so this step covers both direct and inherited uniformly
    for (const c of collected) {
        const epic_linetag: LineTag | undefined = c.story.linetags?.epic;
        if (epic_linetag?.value) {
            c.origin.epic = resolveEpicLinetag(
                epic_linetag.value,
                c.file_epic_by_id,
                c.file_epic_by_name,
            );
        }
        // else: structural origin.epic (set during the walk) stays, or undefined
    }

    // 4. build synthetic root and rewire each story's subtree
    const root_position = { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } };
    const synthetic_root: NoteProps = {
        seq: 0,
        level: 0,
        type: 'root',
        position: root_position,
        children: [],
        children_body: [],
        child_notes: [],
        headline_raw: '',
        body_raw: '',
        stable_id: `__folder__:${integration_path}`,
    };

    const ctx: SeqWalkContext = { all_notes: [synthetic_root], next_seq: 1 };
    // per-(doc_id, slug) counter so two same-headline stories in a file get distinct ids (#1, #2, …)
    const stable_id_slug_counts = new Map<string, number>();
    for (const c of collected) {
        const slug_key = `${c.origin.doc_id}:${storyStableIdSlug(c.story)}`;
        const prior_count = stable_id_slug_counts.get(slug_key) ?? 0;
        stable_id_slug_counts.set(slug_key, prior_count + 1);
        const story_stable_id = prior_count === 0 ? slug_key : `${slug_key}#${prior_count}`;
        const story_start_offset = c.story.position?.start?.offset ?? 0;
        walkStorySubtree(c.story, [synthetic_root], c.origin, story_stable_id, story_start_offset, true, ctx);
        synthetic_root.child_notes!.push(c.story);
        synthetic_root.children_body.push(c.story);
    }

    // expose integration_path on the root for breadcrumb / debug
    (synthetic_root as NoteProps & { integration_path?: string }).integration_path = integration_path;

    return { root: synthetic_root, all_notes: ctx.all_notes };
}

/**
 * helper used by NoteRenderer to detect whether any of the supplied view states has switched to folder aggregation. Exported so tests can exercise it. Checks the canonical FOLDER_VIEW_STATE_ID first, then falls back to a scan for any entry tagged integration_mode='folder' so a stranded doc-path-keyed viewState still resolves to folder mode.
 */
export function anyViewInFolderMode(
    view_states: Record<string, { display_options?: { integration_mode?: string } }> | undefined,
): boolean {
    if (!view_states) { return false; }
    if (view_states[FOLDER_VIEW_STATE_ID]?.display_options?.integration_mode === 'folder') { return true; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        if (view_states[id]?.display_options?.integration_mode === 'folder') { return true; }
    }
    return false;
}

/**
 * Reads the integration_path from the folder viewState. Checks the canonical key first,
 * then falls back to the first legacy entry tagged integration_mode='folder' for state
 * stranded under a doc-path key by the pre-fix dispatch bug.
 */
export function firstIntegrationPath(
    view_states: Record<string, { display_options?: { integration_mode?: string; integration_path?: string } }> | undefined,
): string | undefined {
    if (!view_states) { return undefined; }
    const canonical = view_states[FOLDER_VIEW_STATE_ID];
    if (canonical?.display_options?.integration_mode === 'folder' && typeof canonical.display_options.integration_path === 'string') {
        return canonical.display_options.integration_path;
    }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        const v = view_states[id];
        if (v?.display_options?.integration_mode === 'folder' && typeof v.display_options.integration_path === 'string') {
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
 * `${story_stable_id}:${relative_offset}` so sibling-story insertions outside
 * the story don't churn descendant ids. Notes shallower than depth-3 (the
 * file's H1 and ## epic wrappers) get their own slug-based stable_id so view
 * code that keys on them remains stable across re-parse too.
 *
 * Mutates the passed root tree in place. Idempotent — safe to call twice.
 */
export function stampSingleFileStableIds(root: NoteProps, doc_id: string): void {
    // synthetic root keys off doc_id so single-file view-state survives a flip to/from folder mode
    root.stable_id = `${doc_id}:__root__`;
    const slug_counts = new Map<string, number>();
    for (const child of (root.child_notes ?? [])) {
        walkSingleFileStableIds(child, doc_id, slug_counts, null, null);
    }
}

/**
 * recursively stamp `stable_id` down one subtree. A story-candidate note (depth ≤ 3)
 * mints a fresh slug-based id (deduplicated within the file via `slug_counts`) and
 * becomes the story root passed to its descendants; deeper notes derive
 * `${story_stable_id}:${relative_offset}` against that root's offset so they survive
 * sibling-story insertions elsewhere in the file. Notes with no enclosing story fall
 * back to a doc-relative offset id.
 */
function walkSingleFileStableIds(
    note: NoteProps,
    doc_id: string,
    slug_counts: Map<string, number>,
    story_stable_id: string | null,
    story_start_offset: number | null,
): void {
    let next_story_stable_id = story_stable_id;
    let next_story_start_offset = story_start_offset;
    if (note.depth !== undefined && note.depth <= 3) {
        const slug_key = `${doc_id}:${storyStableIdSlug(note)}`;
        const prior_count = slug_counts.get(slug_key) ?? 0;
        slug_counts.set(slug_key, prior_count + 1);
        note.stable_id = prior_count === 0 ? slug_key : `${slug_key}#${prior_count}`;
        next_story_stable_id = note.stable_id;
        next_story_start_offset = note.position?.start?.offset ?? 0;
    } else if (story_stable_id !== null) {
        const relative_offset = (note.position?.start?.offset ?? 0) - (story_start_offset ?? 0);
        note.stable_id = `${story_stable_id}:${relative_offset}`;
    } else {
        note.stable_id = `${doc_id}:offset:${note.position?.start?.offset ?? 0}`;
    }
    for (const child of (note.child_notes ?? [])) {
        walkSingleFileStableIds(child, doc_id, slug_counts, next_story_stable_id, next_story_start_offset);
    }
}

// MdastNode is re-exported as a convenience to consumers that already import from this file
export type { MdastNode };

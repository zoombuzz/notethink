import type { LineTag, MdastNode, NoteProps, NoteOrigin } from "../types/NoteProps";
import { convertMdastToNoteHierarchy, type MdastInput } from "./convertMdastToNoteHierarchy";
import { stripHeadlineLinetags } from "./noteops";

/**
 * Aggregate (Folder) mode entry point.
 *
 * Takes a map of source documents and an integration folder path; returns a single
 * synthetic root NoteProps whose children are the depth-3 "stories" gathered from every
 * doc, each stamped with origin metadata so callers can route edits back to the source file.
 *
 * See design in docstech/users/alex.stanhope/todo.md (story "Aggregate (Folder) view").
 */

export interface AggregatedDocInput {
    id: string;
    path: string;
    relative_path?: string;
    content: MdastInput;
    text: string;
}

export interface MergeAggregateRootResult {
    root: NoteProps;
    all_notes: NoteProps[];
}

interface PerFileParse {
    doc: AggregatedDocInput;
    root: NoteProps;          // synthetic root from convertMdastToNoteHierarchy
    h1: NoteProps | undefined; // the file's # heading, if any
}

interface EpicEntry {
    name: string;       // stripped headline
    id: string | undefined;
}

// file H1 `order` linetag value: newest stories are appended at the bottom of the file (e.g. done.md)
const ORDER_NEWEST_AT_BOTTOM = 'newest-at-bottom';

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

    // 2. for each file, build epic registries and collect stories
    interface CollectedStory {
        story: NoteProps;
        origin: NoteOrigin;
        file_epic_by_id: Map<string, EpicEntry>;
        file_epic_by_name: Map<string, EpicEntry>;
    }
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

        const base_origin: Omit<NoteOrigin, 'epic'> = {
            doc_id: doc.id,
            doc_path: doc.path,
            relative_path: doc.relative_path,
            file_view_type,
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
    };

    const all_notes: NoteProps[] = [synthetic_root];
    let seq_counter = 1;

    // walk a story subtree, assigning new seqs and rewriting parent_notes/level
    const walk = (
        note: NoteProps,
        new_ancestors: NoteProps[],
        origin: NoteOrigin,
    ): void => {
        note.seq = seq_counter++;
        note.level = new_ancestors.length;
        note.parent_notes = new_ancestors.length ? [...new_ancestors] : undefined;
        note.origin = origin;
        // keep linetag.note_seq in sync with the renumbered story seq
        if (note.linetags) {
            for (const key of Object.keys(note.linetags)) {
                note.linetags[key].note_seq = note.seq;
            }
        }
        all_notes.push(note);

        // rebuild child_notes order from current child_notes (preserved from parse)
        const direct_children = note.child_notes || [];
        for (const child of direct_children) {
            walk(child, [...new_ancestors, note], origin);
        }
    };

    for (const c of collected) {
        walk(c.story, [synthetic_root], c.origin);
        synthetic_root.child_notes!.push(c.story);
        synthetic_root.children_body.push(c.story);
    }

    // expose integration_path on the root for breadcrumb / debug
    (synthetic_root as NoteProps & { integration_path?: string }).integration_path = integration_path;

    return { root: synthetic_root, all_notes };
}

/**
 * Helper used by NoteRenderer to detect whether any of the supplied view states
 * has switched to folder aggregation. Exported so tests can exercise it.
 */
export function anyViewInFolderMode(
    view_states: Record<string, { display_options?: { integration_mode?: string } }> | undefined,
): boolean {
    if (!view_states) { return false; }
    for (const id of Object.keys(view_states)) {
        if (view_states[id]?.display_options?.integration_mode === 'folder') { return true; }
    }
    return false;
}

/**
 * Reads the integration_path from the first view state in folder mode, if any.
 */
export function firstIntegrationPath(
    view_states: Record<string, { display_options?: { integration_mode?: string; integration_path?: string } }> | undefined,
): string | undefined {
    if (!view_states) { return undefined; }
    for (const id of Object.keys(view_states)) {
        const v = view_states[id];
        if (v?.display_options?.integration_mode === 'folder' && typeof v.display_options.integration_path === 'string') {
            return v.display_options.integration_path;
        }
    }
    return undefined;
}

// MdastNode is re-exported as a convenience to consumers that already import from this file
export type { MdastNode };

import type {ReactElement, MouseEvent} from "react";
import type { Nodes as MdastNodesImport } from "mdast";

export interface ClickPositionInfo {
    from: number;
    to: number | undefined;
    selection_from: number | undefined;
    selection_to: number | undefined;
    type: string;
}

export type NoteClickHandler = (event: MouseEvent<HTMLElement>, note: NoteProps | undefined, position: ClickPositionInfo) => void;

/**
 * NoteDisplayOptions, per-view display state threaded onto each note's display_options.
 * - integration_mode_selection: the persisted integration-mode choice (auto / current_file / folder), carried alongside the composer-resolved concrete integration_mode so the toolbar selector can render "Auto (…)" vs the concrete label; never persisted itself - the composer re-stamps it from the canonical folder view-state each render
 * - view_caret: the view's own caret offset when no editor is live, in in-tree (merged-tree) offset space so it resolves via findDeepestNote in both single-file and folder mode; augmented state only, never text - files stay master
 * - parent_context_id / parent_context_seq: the note-hierarchy scope this view opens at. The id is the persisted half (a stable_id from a drill-in or breadcrumb click, else the authored nt_breadcrumb_last headline label) and is re-resolved against the current tree by resolveParentContextNote on every render; the seq is the resolved result, derived per render and never persisted
 * - view_expanded_ids: stable_ids of the notes the user manually expanded past their clip height, newest last and capped by nextExpandedIds so the persisted list cannot grow without bound; the manual override layer under autoExpandFocusedNote, and the reason expansion outlives a remount
 */
export interface NoteDisplayOptions {
    id?: string;
    view_id?: string;
    level?: number;
    parent_context_id?: string;
    parent_context_seq?: number;
    settings?: {
        showContextBars?: boolean;
        showLinetagsInHeadlines?: boolean;
        showLineNumbers?: boolean;
        watchUnopenedFilesInViewer?: boolean;
        kanbanAnimateTransitions?: boolean;
        openNewEditorIfNoneOpen?: boolean;
        scrollTextIntoView?: boolean;
        scrollNoteIntoView?: boolean;
        autoExpandFocusedNote?: boolean;
        columnOrder?: string[];
        orientation?: 'columns' | 'rows';
        groupBy?: string;
    };
    deepest?: {
        selectable_level?: number;
        selectable_note?: NoteProps;
        rendered_level?: number;
        note?: NoteProps;
    };
    focused_notes?: NoteProps[];
    focused_seqs?: number[];
    selected_seqs?: number[];
    selected_notes?: NoteProps[];
    cropped_focused_seqs?: number[];
    cropped_selected_seqs?: number[];
    // --- per-view interaction state (view-driven, persisted on display_options); these hold note stable_ids (invariant across re-parse), unlike the per-render focused_seqs/selected_seqs above which stay seq-based ---
    view_focused_ids?: string[];
    view_selected_ids?: string[];
    view_expanded_ids?: string[];
    view_caret?: number;
    integration_mode?: string;
    integration_mode_selection?: string;
    integration_path?: string;
    includeFilter?: string;
    excludeFilter?: string;
    maxNotesPerFile?: number;
    additional_classes?: string[];
    total_columns?: number;
    provided?: {
        draggableProps?: Record<string, unknown>;
        dragHandleProps?: Record<string, unknown>;
        innerRef?: ((instance: HTMLDivElement | null) => void) | { current: HTMLDivElement | null };
        droppableProps?: Record<string, unknown>;
    };
    [key: string]: unknown;
}

/**
 * NoteHandlers, the per-note handler surface threaded from a view down to each rendered note.
 * - descendToFolder: switch the view into folder integration mode at the given absolute folder path; used by the origin pill click to descend the folder view into the pill's project subfolder
 * - setNoteExpanded: add or remove the note's stable_id from the view's view_expanded_ids; the "Show more" / "Show less" bars dispatch through it, which is what keeps expansion out of component-instance state
 */
export interface NoteHandlers {
    click?: NoteClickHandler;
    singleClick?: NoteClickHandler;
    doubleClick?: NoteClickHandler;
    setCaretPosition?: (position: number) => void;
    setParentContextId?: (id: string | undefined) => void;
    setNoteExpanded?: (stable_id: string, expanded: boolean) => void;
    postMessage?: (message: unknown) => void;
    descendToFolder?: (folder_path: string) => void;
    [key: string]: unknown;
}

/**
 * NoteProps is the unified shape every view consumes. One instance per parsed
 * heading / list / code-block / list-item paragraph; constructed by
 * convertMdastToNoteHierarchy and (in folder mode) re-stamped by
 * mergeAggregateRoot.
 * - seq: 1-based document-order index assigned during parse. Globally
 *   renumbered by mergeAggregateRoot when the per-file trees are interleaved,
 *   which is why React must NOT key on this - see stable_id. A seq is valid only
 *   within the render pass that derived it: the moment one outlives a re-parse
 *   (cached in a memo, written to view state, stashed in a ref, or put in the DOM
 *   to be looked up later) it addresses whichever note now holds that number. Use
 *   stable_id, or a source offset, for anything that crosses an update boundary.
 *   A seq is NOT an index into the flat `notes` array, however much it looks like
 *   one: the two coincide for a plain parse (both numbering passes append in the
 *   same document-order walk that assigns the seq) and diverge as soon as
 *   flattenSingleFileStories lifts `###` stories out from under their `##` epics,
 *   which drops the epic headings from the walked tree without renumbering. Look
 *   notes up with findNoteBySeq, never `notes.at(seq)`.
 * - origin: folder mode metadata stamped on every story and its descendants by
 *   mergeAggregateRoot; lets callers route edits back to the source file and
 *   drives implicit cross-file ordering (single-file mode leaves it
 *   undefined).
 * - stable_id: identity that survives re-parse and merge shuffles. Used as the
 *   React key for the kanban view (so DnD + FLIP rect-capture survive
 *   reparses) and for cross-update animation. Derivation: for story-level
 *   notes (depth-3 headings collected by mergeAggregateRoot), it is
 *   `${doc_id}:${slug}` where `slug` is the story's `linetags.id` value when
 *   present (canonical and author-controlled), otherwise the stripped headline
 *   plus a same-headline duplicate-occurrence ordinal (`#N` for the N-th
 *   duplicate in the file). For descendant notes inside a story's subtree it
 *   is `${story_stable_id}:${child_path}`, where `child_path` is the
 *   dot-joined 0-based ordinal of each step from the story root down to the
 *   note (`0.2` is the third child of the first child). That is invariant
 *   under every length-changing edit, inside the story or outside it, and
 *   churns only when a sibling is inserted or removed on the path down to the
 *   note, which shifts each later sibling's ordinal. In single-file mode the
 *   composer stamps it without an origin so `doc_id` is the active doc id
 *   instead, and a note ahead of the file's first heading has no enclosing
 *   story, so it hangs off the synthetic root as
 *   `${doc_id}:__root__:${child_path}`. Byte offsets / `seq` / `file_rank`
 *   are deliberately NOT in the derivation: those churn under merge
 *   re-shuffles, global seq renumbering, and unrelated sibling additions, and
 *   using them would defeat the whole point.
 */
export interface NoteProps {
    seq: number;
    level: number;
    stable_id?: string;
    children_body: Array<NoteProps | MdastNode>;
    // --- mdast passthrough ---
    type?: string;
    depth?: number;
    lang?: string;
    value?: string;
    checked?: boolean;
    position: {
        start: TextPosition,
        end: TextPosition,
        end_body?: TextPosition,
    }
    children: Array<MdastNode>;
    // --- tree links ---
    parent_notes?: Array<NoteProps>;
    child_notes?: Array<NoteProps>;
    linetags?: {
        [key: string]: LineTag
    };
    linetags_from?: number;
    headline_raw: string;
    body_raw: string;
    // --- change flags + folder-mode metadata ---
    hash_sha256?: string;
    updated?: number;
    updated_by_view?: string;
    origin?: NoteOrigin;
    // --- rendered at parse time ---
    headline?: ReactElement;
    body?: ReactElement;
    // --- runtime decoration added at React render stage ---
    focused?: boolean;
    selected?: boolean;
    locked?: boolean;
    display_options?: NoteDisplayOptions;
    handlers?: NoteHandlers;
    selection?: TextSelection;
}

/**
 * NoteOrigin: folder mode metadata stamped on every story and its
 * descendants by mergeAggregateRoot; lets callers route edits back to the
 * source file and drives implicit cross-file ordering.
 * - file_view_type: the nt_view (legacy ng_view) value declared on the originating file's H1, if any; used by AutoView to majority-vote view type across the merged tree (one vote per file)
 * - file_group_by: the nt_group_by value declared on the originating file's H1 (front-matter fallback), if any; majority-voted across files to auto-resolve the Line view's group-by key, mirroring file_view_type
 * - file_group_order: the nt_group_order value declared on the originating file's H1 (front-matter fallback), if any; the authored per-axis lane order that seeds grouped's group order
 * - file_rank: 0-based index of this story within its source file's selected story list (after the per-file cap + `order` reversal); the implicit ordering weight - equal across files means equal priority, which relevance ordering then breaks by file_mtime (newer first)
 * - file_mtime: on-disk mtime (epoch ms) of the source file at parse time; within a file_rank band, stories from more recently modified files sort first - background edits by another tool (or a save of the file currently open) naturally surface to the top without any explicit "active file" signal
 * - project_hue: identity hash of the project name (0-359), set-independent; stamped by mergeAggregateRoot via hueForProjectName(project_name) so the colour is fixed at the project name alone and cannot change as the workspace universe fills in on first paint
 * - project_label: pre-computed 2-character pill label; stamped by mergeAggregateRoot using buildProjectLabels - the first char is the project's initial, the second is the earliest character that differentiates this project from any other in the aggregate (so `notethink`→`NT`, `notebook`→`NB`, cobalt→`CO`); OriginPill falls back to a single-project first+second-character abbreviation when this is absent (single-file mode, legacy origins)
 * - source_position: the note's pre-merge offset range in its source file, preserved through mergeAggregateRoot's global seq + position re-numbering so the editor-caret → note-focus derivation can match by source-file offsets in folder mode (where merged `position` is in synthetic merged-tree coordinates and doesn't share a coordinate system with any single editor)
 */
export interface NoteOrigin {
    doc_id: string;
    doc_path: string;
    relative_path?: string;
    epic?: {
        name: string;
        id?: string;
    };
    file_view_type?: string;
    file_group_by?: string;
    file_group_order?: string;
    file_rank?: number;
    file_mtime?: number;
    project_hue?: number;
    project_label?: string;
    source_position?: {
        start: TextPosition;
        end: TextPosition;
        end_body?: TextPosition;
    };
}

export type MdastNodes = MdastNodesImport;
export type MdastNode = {
    type?: string;
    depth?: number;
    lang?: string;
    value?: string;
    checked?: boolean;
    position: {
        start: TextPosition,
        end: TextPosition,
        end_body?: TextPosition,
    }
    children: Array<MdastNode>;
}

/**
 * LineTag, thing at the end of a line used to encode metadata. Changes to
 * LineTag types need to be parsed in `parseLineTag`.
 * - note_seq: attachment flag binding this tag to its owning note
 * - inherited: true when this linetag was propagated from a parent's nt_child_* attribute
 * - updated / updated_by_view: change flags
 * - handlers: added at the React render stage
 */
export interface LineTag {
    key: string,
    key_offset: number,
    value: string,
    value_offset: number,
    value_numeric?: number,
    value_previous?: string,
    value_numeric_previous?: number,
    linktext?: string,
    linktext_offset: number,
    note_seq: number,
    inherited?: true,
    updated?: number,
    updated_by_view?: string,
    handlers?: NoteHandlers,
}

export interface TextPosition {
    offset: number,
    line: number,
}

export interface TextSelection {
    main: {
        head: number,
        anchor: number,
    },
}

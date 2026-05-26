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

export interface NoteDisplayOptions {
    id?: string;
    view_id?: string;
    level?: number;
    parent_context_seq?: number;
    settings?: {
        showContextBars?: boolean;
        showLinetagsInHeadlines?: boolean;
        showLineNumbers?: boolean;
        watchUnopenedFilesInViewer?: boolean;
        scrollTextIntoView?: boolean;
        scrollNoteIntoView?: boolean;
        autoExpandFocusedNote?: boolean;
        columnOrder?: string[];
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
    integration_mode?: string;
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

export interface NoteHandlers {
    click?: NoteClickHandler;
    singleClick?: NoteClickHandler;
    doubleClick?: NoteClickHandler;
    setCaretPosition?: (position: number) => void;
    setParentContextSeq?: (seq: number) => void;
    postMessage?: (message: unknown) => void;
    [key: string]: unknown;
}

/**
 * NoteProps is the unified shape every view consumes. One instance per parsed
 * heading / list / code-block / list-item paragraph; constructed by
 * convertMdastToNoteHierarchy and (in folder mode) re-stamped by
 * mergeAggregateRoot.
 * - seq: 1-based document-order index assigned during parse. Globally
 *   renumbered by mergeAggregateRoot when the per-file trees are interleaved,
 *   which is why React must NOT key on this — see stable_id.
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
 *   is `${story_stable_id}:${note_offset_minus_story_offset}` — a relative
 *   offset within the story body, which is invariant under sibling story
 *   insertions OUTSIDE the story (those shift both offsets by the same delta)
 *   and changes only when the story's own body changes. In single-file mode
 *   the composer stamps it without an origin so `doc_id` is the active doc id
 *   instead. Byte offsets / `seq` / `file_rank` are deliberately NOT in the
 *   derivation: those churn under merge re-shuffles, global seq renumbering,
 *   and unrelated sibling additions, and using them would defeat the whole
 *   point.
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
 * - file_view_type: the ng_view value declared on the originating file's H1, if any; used by AutoView to majority-vote view type across the merged tree (one vote per file)
 * - file_rank: 0-based index of this story within its source file's selected story list (after the per-file cap + `order` reversal); the implicit ordering weight — equal across files means equal priority, which relevance ordering then breaks by file_mtime (newer first)
 * - file_mtime: on-disk mtime (epoch ms) of the source file at parse time; within a file_rank band, stories from more recently modified files sort first — background edits by another tool (or a save of the file currently open) naturally surface to the top without any explicit "active file" signal
 * - project_hue: pre-computed hue (0-359) for the project pill colour; stamped by mergeAggregateRoot using the project's index in the sorted enumeration of all distinct project names visible in the aggregate, fed through hueForProjectIndex (golden-angle spread) — bypasses the djb2-hash fallback in OriginPill, which can collide for some real-world name pairs
 * - project_label: pre-computed 2-character pill label; stamped by mergeAggregateRoot using buildProjectLabels — the first char is the project's initial, the second is the earliest character that differentiates this project from any other in the aggregate (so notegit→`NG`, notethink→`NT`, countingsheet→`CO`); OriginPill falls back to a single-project first+second-character abbreviation when this is absent (single-file mode, legacy origins)
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
    file_rank?: number;
    file_mtime?: number;
    project_hue?: number;
    project_label?: string;
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
 * - inherited: true when this linetag was propagated from a parent's ng_child_* attribute
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

import type {ReactElement, MouseEvent} from "react";

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
        show_context_bars?: boolean;
        show_linetags_in_headlines?: boolean;
        show_line_numbers?: boolean;
        watch_unopened_files_in_viewer?: boolean;
        scroll_text_into_view?: boolean;
        scroll_note_into_view?: boolean;
        auto_expand_focused_note?: boolean;
        column_order?: string[];
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
    include_filter?: string;
    exclude_filter?: string;
    max_notes_per_file?: number;
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

export interface NoteProps {
    seq: number;
    level: number;
    children_body: Array<NoteProps | MdastNode>;
    // manually inherited fields
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
    // note fields
    parent_notes?: Array<NoteProps>;
    child_notes?: Array<NoteProps>;
    linetags?: {
        [key: string]: LineTag
    };
    linetags_from?: number;
    headline_raw: string;
    body_raw: string;
    // change flags
    hash_sha256?: string;
    updated?: number;
    updated_by_view?: string;
    // folder mode: which file this note originated in (undefined in single-file mode; set on stories and their descendants by mergeAggregateRoot)
    origin?: NoteOrigin;
    // rendered at Note parse time
    headline?: ReactElement;
    body?: ReactElement;
    // fields added at the React render stage
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

export type MdastNodes = import("mdast").Nodes;
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
 * LineTag, thing at the end of a line used to encode metadata
 * changes to LineTag types need to be parsed in `parseLineTag`
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

    // attachment flags
    note_seq: number,

    // inheritance flag: true when this linetag was propagated from a parent's ng_child_* attribute
    inherited?: true,

    // change flags
    updated?: number,
    updated_by_view?: string,

    // fields added at the React render stage
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

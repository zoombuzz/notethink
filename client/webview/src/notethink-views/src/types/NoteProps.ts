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
        scroll_text_into_view?: boolean;
        scroll_note_into_view?: boolean;
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

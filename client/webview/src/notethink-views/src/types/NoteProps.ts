import {ReactElement} from "react";

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
    display_options?: any;
    handlers?: any;
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
    handlers?: any,
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

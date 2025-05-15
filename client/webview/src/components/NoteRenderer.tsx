import React, { ReactElement, useEffect, useRef, useState, useCallback } from 'react';
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import { HashMapOf } from "../types/general";

export type MdastNodes = import("mdast").Nodes;

export function renderNodeUnified(node: any): ReactElement {
    const hast = sanitize(toHast(node as MdastNodes));
    // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
    return toJsxRuntime(hast, {Fragment, jsx, jsxs});
}

export default function NoteRenderer(props: {
    notes: HashMapOf<any>
}) {
    const ref = useRef<HTMLDivElement>(null);
    const rendered_notes = Object.keys(props.notes).map((note_id: string) => {
        const note = props.notes[note_id];
        return renderNodeUnified(note.content);
    });
    const fragment = rendered_notes.map((rnote: any, index: number) => {
        return <div key={`rnote-${index}`} className="note-renderer">
            {rnote}
        </div>;
    });
    return <div ref={ref} data-testid="NoteRenderer">
        {fragment}
    </div>;
}

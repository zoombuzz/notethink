import React, { ReactElement, Suspense, useRef } from 'react';
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import type { HashMapOf, Doc } from "../types/general";
import { convertMdastToNoteHierarchy } from "../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { DocumentView } from "../notethink-views/src/components";
import type { ViewProps } from "../notethink-views/src/types/ViewProps";

export type MdastNodes = import("mdast").Nodes;

export function renderNodeUnified(node: MdastNodes): ReactElement {
    const hast = sanitize(toHast(node));
    // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
    return toJsxRuntime(hast, {Fragment, jsx, jsxs});
}

export default function NoteRenderer(props: {
    notes: HashMapOf<Doc>
}) {
    const ref = useRef<HTMLDivElement>(null);
    const rendered_notes = Object.entries(props.notes).map(([note_id, note]) => {
        if (!note.content) {
            return null;
        }
        // use DocumentView when raw text is available (new path)
        if (note.text) {
            const root_note = convertMdastToNoteHierarchy(note.content, note.text);
            const view_props: ViewProps = {
                id: note_id,
                type: 'document',
                display_options: {},
                nested: {
                    parent_context: root_note,
                },
            };
            return <Suspense key={note_id} fallback={<div>Loading...</div>}>
                <DocumentView {...view_props} />
            </Suspense>;
        }
        // fallback: raw MDAST rendering for docs without text
        return <div key={note_id} className="note-renderer">
            {renderNodeUnified(note.content)}
        </div>;
    });
    return <div ref={ref} data-testid="NoteRenderer">
        {rendered_notes}
    </div>;
}

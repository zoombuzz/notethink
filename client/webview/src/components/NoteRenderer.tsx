import React, { ReactElement, Suspense, useRef } from 'react';
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import type { HashMapOf, Doc } from "../types/general";
import { convertMdastToNoteHierarchy } from "../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { GenericView, ErrorBoundary } from "../notethink-views/src/components";
import type { ViewProps } from "../notethink-views/src/types/ViewProps";
import type { NoteProps, NoteDisplayOptions, TextSelection } from "../notethink-views/src/types/NoteProps";
import type { ViewState } from './ExtensionReceiver';

export type MdastNodes = import("mdast").Nodes;

export function renderNodeUnified(node: MdastNodes): ReactElement {
    const hast = sanitize(toHast(node));
    // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
    return toJsxRuntime(hast, {Fragment, jsx, jsxs});
}

interface NoteRendererProps {
    notes: HashMapOf<Doc>;
    selections?: { [docPath: string]: TextSelection };
    postMessage?: (message: unknown) => void;
    viewStates?: Record<string, ViewState>;
    setViewManagedState?: (updates: Array<Record<string, unknown>>) => void;
    onNavigationCommand?: React.MutableRefObject<((direction: string) => void) | undefined>;
}

/**
 * NoteView converts MDAST to NoteProps and renders GenericView.
 * By doing the conversion inside this component's render, any errors
 * thrown by convertMdastToNoteHierarchy are caught by the parent ErrorBoundary.
 */
function NoteView({ note_id, note, props }: { note_id: string; note: Doc; props: NoteRendererProps }) {
    const root_note = convertMdastToNoteHierarchy(note.content!, note.text!);
    const selection = note.path ? props.selections?.[note.path] : undefined;
    const all_notes = flattenAllNotes(root_note);

    const view_state = props.viewStates?.[note_id] || props.viewStates?.['__default'];
    const view_type = view_state?.type || 'auto';
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
    };

    const view_props: ViewProps = {
        id: note_id,
        type: view_type,
        display_options: view_display_options,
        nested: {
            parent_context: root_note,
        },
        notes: all_notes,
        selection,
        handlers: {
            setViewManagedState: props.setViewManagedState || (() => {}),
            deleteViewFromManagedState: () => {},
            revertAllViewsToDefaultState: () => {},
            onNavigationCommand: props.onNavigationCommand,
            postMessage: props.postMessage ? (message: unknown) => {
                if (message && typeof message === 'object' && 'type' in message) {
                    props.postMessage!({
                        ...message,
                        docId: note_id,
                        docPath: note.path,
                    });
                } else {
                    props.postMessage!(message);
                }
            } : undefined,
        },
    };

    return <GenericView {...view_props} />;
}

export default function NoteRenderer(props: NoteRendererProps) {
    const ref = useRef<HTMLDivElement>(null);
    const rendered_notes = Object.entries(props.notes).map(([note_id, note]) => {
        if (!note.content) {
            return null;
        }
        if (note.text) {
            return <Suspense key={note_id} fallback={<div>Loading...</div>}>
                <ErrorBoundary>
                    <NoteView note_id={note_id} note={note} props={props} />
                </ErrorBoundary>
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

/**
 * Flatten NoteProps tree into a flat array (root at index 0, children follow by seq).
 */
function flattenAllNotes(root: NoteProps): NoteProps[] {
    const result: NoteProps[] = [root];
    function walk(items: Array<unknown>) {
        for (const item of items) {
            if (item && typeof item === 'object' && 'seq' in item && typeof (item as NoteProps).seq === 'number' && (item as NoteProps).seq > 0) {
                const note = item as NoteProps;
                result.push(note);
                if (note.children_body?.length) {
                    walk(note.children_body);
                }
            }
        }
    }
    if (root.children_body) { walk(root.children_body); }
    return result;
}

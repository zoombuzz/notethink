import React, { ReactElement, Suspense, useCallback, useMemo, useRef } from 'react';
import {sanitize} from "hast-util-sanitize";
import {toHast} from "mdast-util-to-hast";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import type { HashMapOf, Doc } from "../types/general";
import { convertMdastToNoteHierarchy } from "../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { GenericView, ErrorBoundary } from "../notethink-views/src/components";
import type { ViewProps } from "../notethink-views/src/types/ViewProps";
import type { NoteProps, NoteDisplayOptions, TextSelection } from "../notethink-views/src/types/NoteProps";
import type { GlobalSettingsPayload } from "../notethink-views/src/types/Messages";
import type { ViewState } from './ExtensionReceiver';

export type MdastNodes = import("mdast").Nodes;

export function renderNodeUnified(node: MdastNodes): ReactElement {
    try {
        const hast = sanitize(toHast(node));
        // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
        return toJsxRuntime(hast, {Fragment, jsx, jsxs});
    } catch (err) {
        console.error('renderNodeUnified failed:', err);
        return <></>;
    }
}

interface NoteRendererProps {
    notes: HashMapOf<Doc>;
    selections?: { [docPath: string]: TextSelection };
    postMessage?: (message: unknown) => void;
    viewStates?: Record<string, ViewState>;
    setViewManagedState?: (updates: Array<Record<string, unknown>>) => void;
    onNavigationCommand?: React.MutableRefObject<((direction: string) => void) | undefined>;
    workspace_root?: string;
    globalSettings?: GlobalSettingsPayload;
}

/**
 * NoteView converts MDAST to NoteProps and renders GenericView.
 * By doing the conversion inside this component's render, any errors
 * thrown by convertMdastToNoteHierarchy are caught by the parent ErrorBoundary.
 */
function NoteView({ note_id, note, props }: { note_id: string; note: Doc; props: NoteRendererProps }) {
    // memoize conversion keyed on content hash - avoids redundant work when only selection changes
    const root_note = useMemo(
        () => convertMdastToNoteHierarchy(note.content!, note.text!),
        [note.hash_sha256]
    );
    const selection = note.path ? props.selections?.[note.path] : undefined;
    const all_notes = flattenAllNotes(root_note);

    const view_state = props.viewStates?.[note_id] || props.viewStates?.['__default'];
    const view_type = view_state?.type || 'auto';
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        settings: {
            show_line_numbers: props.globalSettings?.show_line_numbers ?? false,
            ...view_state?.display_options?.settings,
        },
    };

    const view_props: ViewProps = {
        id: note_id,
        type: view_type,
        doc_path: note.path,
        doc_relative_path: note.relative_path,
        doc_text: note.text,
        workspace_root: props.workspace_root,
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

    const handleRenderError = useCallback((error: Error) => {
        props.postMessage?.({
            type: 'renderError',
            message: error.message,
            stack: error.stack,
        });
    }, [props.postMessage]);

    const rendered_notes = Object.entries(props.notes).map(([note_id, note]) => {
        if (!note.content) {
            return null;
        }
        if (note.text) {
            return <Suspense key={note_id} fallback={<div>Loading...</div>}>
                <ErrorBoundary onError={handleRenderError}>
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

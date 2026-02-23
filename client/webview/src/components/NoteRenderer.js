import { jsx as _jsx } from "react/jsx-runtime";
import { Suspense, useRef } from 'react';
import { sanitize } from "hast-util-sanitize";
import { toHast } from "mdast-util-to-hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { convertMdastToNoteHierarchy } from "../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { GenericView } from "../notethink-views/src/components";
export function renderNodeUnified(node) {
    const hast = sanitize(toHast(node));
    // @ts-ignore safe to ignore type error on jsx and jsxs (https://github.com/syntax-tree/hast-util-to-jsx-runtime)
    return toJsxRuntime(hast, { Fragment, jsx, jsxs });
}
export default function NoteRenderer(props) {
    const ref = useRef(null);
    const rendered_notes = Object.entries(props.notes).map(([note_id, note]) => {
        if (!note.content) {
            return null;
        }
        // use GenericView when raw text is available (new path)
        if (note.text) {
            const root_note = convertMdastToNoteHierarchy(note.content, note.text);
            // Look up selection state for this document
            const selection = note.path ? props.selections?.[note.path] : undefined;
            const all_notes = flattenAllNotes(root_note);
            // Resolve view state: check note-specific state, fall back to __default
            const view_state = props.viewStates?.[note_id] || props.viewStates?.['__default'];
            const view_type = view_state?.type || 'auto';
            const view_display_options = {
                ...view_state?.display_options,
            };
            const view_props = {
                id: note_id,
                type: view_type,
                display_options: view_display_options,
                nested: {
                    parent_context: root_note,
                },
                notes: all_notes,
                selection,
                handlers: {
                    setViewManagedState: props.setViewManagedState || (() => { }),
                    deleteViewFromManagedState: () => { },
                    revertAllViewsToDefaultState: () => { },
                    onNavigationCommand: props.onNavigationCommand,
                    postMessage: props.postMessage ? (message) => {
                        // Inject docId and docPath into outgoing messages
                        if (message && typeof message === 'object' && 'type' in message) {
                            props.postMessage({
                                ...message,
                                docId: note_id,
                                docPath: note.path,
                            });
                        }
                        else {
                            props.postMessage(message);
                        }
                    } : undefined,
                },
            };
            return _jsx(Suspense, { fallback: _jsx("div", { children: "Loading..." }), children: _jsx(GenericView, { ...view_props }) }, note_id);
        }
        // fallback: raw MDAST rendering for docs without text
        return _jsx("div", { className: "note-renderer", children: renderNodeUnified(note.content) }, note_id);
    });
    return _jsx("div", { ref: ref, "data-testid": "NoteRenderer", children: rendered_notes });
}
/**
 * Flatten NoteProps tree into a flat array (root at index 0, children follow by seq).
 */
function flattenAllNotes(root) {
    const result = [root];
    function walk(items) {
        for (const item of items) {
            if (item && typeof item === 'object' && 'seq' in item && typeof item.seq === 'number' && item.seq > 0) {
                const note = item;
                result.push(note);
                if (note.children_body?.length) {
                    walk(note.children_body);
                }
            }
        }
    }
    if (root.children_body) {
        walk(root.children_body);
    }
    return result;
}

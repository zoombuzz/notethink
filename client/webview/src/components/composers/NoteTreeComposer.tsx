import Debug from "debug";
import { type ReactElement, useMemo } from "react";
import { GenericView } from "../../notethink-views/src/components";
import { convertMdastToNoteHierarchy } from "../../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { stampSingleFileStableIds } from "../../notethink-views/src/lib/mergeAggregateRoot";
import type { Doc } from "../../types/general";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../NoteRenderer";

const debug = Debug("nodejs:notethink:NoteTreeComposer");

/**
 * NoteTreeComposer composes a NoteProps tree from a single Doc and renders GenericView.
 *
 * Tree-composers sit one layer above views (Document/Kanban/Auto): each composer produces
 * the note tree handed to a leaf view. NoteTreeComposer is the single-file composer;
 * FolderTreeComposer is the folder-mode companion.
 *
 * By doing the MDAST conversion inside this component's render, any errors thrown by
 * convertMdastToNoteHierarchy are caught by the parent ErrorBoundary.
 *
 * stable_id is stamped here (no `origin` is present in single-file mode) so React keying
 * and FLIP rect-capture in the kanban view stay invariant under re-parse.
 */
export default function NoteTreeComposer({ note_id, note, props }: { note_id: string; note: Doc; props: NoteRendererProps }): ReactElement {
    // memoize conversion keyed on content hash - avoids redundant work when only selection changes
    const root_note = useMemo(
        () => {
            const root = convertMdastToNoteHierarchy(note.content!, note.text!);
            stampSingleFileStableIds(root, note_id);
            return root;
        },
        [note.hash_sha256, note_id]
    );
    const selection = note.path ? props.selections?.[note.path] : undefined;
    const all_notes = flattenAllNotes(root_note);

    const view_state = props.viewStates?.[note_id] || props.viewStates?.['__default'];
    const view_type = view_state?.type || 'auto';
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        settings: {
            show_line_numbers: props.globalSettings?.show_line_numbers ?? false,
            watch_unopened_files_in_viewer: props.globalSettings?.watch_unopened_files_in_viewer ?? true,
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
                    const m = message as Record<string, unknown>;
                    // respect docId/docPath already on the message — in folder mode the click handler attaches the origin doc's path from note.origin
                    // in single-file mode the per-note origin is undefined, so we stamp the view's own docId/docPath as before
                    props.postMessage!({
                        ...m,
                        docId: m.docId ?? note_id,
                        docPath: m.docPath ?? note.path,
                    });
                } else {
                    props.postMessage!(message);
                }
            } : undefined,
        },
    };

    return <GenericView {...view_props} />;
}

/**
 * Flatten a NoteProps tree into a flat array (root at index 0, children follow by seq).
 */
function flattenAllNotes(root: NoteProps): NoteProps[] {
    const result: NoteProps[] = [root];
    function walk(items: Array<unknown>): void {
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

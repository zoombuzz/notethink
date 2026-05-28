import Debug from "debug";
import { type ReactElement, useMemo } from "react";
import { GenericView } from "../../notethink-views/src/components";
import { convertMdastToNoteHierarchy } from "../../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { stampSingleFileStableIds } from "../../notethink-views/src/lib/mergeAggregateRoot";
import { flattenAllNotes } from "../../notethink-views/src/lib/noteops";
import { buildViewDisplayOptions } from "../../lib/composerops";
import { INTEGRATION_MODE_CURRENT_FILE } from "../../notethink-views/src/types/IntegrationMode";
import type { Doc } from "../../types/general";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
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
    // explicit `current_file` stamp makes the composer the single source of truth for the toolbar selector + breadcrumb (symmetric with FolderTreeComposer's `integration_mode: 'folder'` stamp); without it the toolbar's selector falls back to a hard-coded default and any stale stranded tag on this view's display_options can still register as folder
    const { viewType, view_display_options } = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
    const cascade = props.settingsCascade;
    const view_state_ids = props.viewStates ? Object.keys(props.viewStates) : undefined;

    const view_props: ViewProps = {
        id: note_id,
        type: viewType,
        doc_path: note.path,
        doc_relative_path: note.relative_path,
        doc_text: note.text,
        workspace_root: props.workspace_root,
        settingsCascadeHasWorkspaceOverrides: cascade?.hasWorkspaceOverrides,
        view_state_ids,
        display_options: view_display_options,
        nested: {
            parent_context: root_note,
        },
        notes: all_notes,
        selection,
        // in current_file mode this view's doc IS the active doc; passing it makes useViewContext's per-doc matcher work uniformly across both modes
        active_editor_doc_path: note.path,
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

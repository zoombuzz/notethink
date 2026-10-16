import { type ReactElement, useMemo } from "react";
import { GenericView } from "../../notethink-views/src/components";
import { convertMdastToNoteHierarchy } from "../../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { fileDeclaredViewType, flattenSingleFileStories, stampSingleFileStableIds } from "../../notethink-views/src/lib/mergeAggregateRoot";
import { flattenAllNotes } from "../../notethink-views/src/lib/noteops";
import { chainOf, registryWithUserTypes } from "../../notethink-views/src/lib/viewregistryops";
import { buildViewDisplayOptions } from "../../lib/composerops";
import { INTEGRATION_MODE_CURRENT_FILE } from "../../notethink-views/src/types/IntegrationMode";
import type { Doc } from "../../types/general";
import type { UserViewType } from "../../notethink-views/src/types/Messages";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
import type { NoteRendererProps } from "../NoteRenderer";

/**
 * True when `view_type`'s chain passes through kanban - kanban itself, or a saved type parented (however
 * deep) on it - the shape every kanban-descended board needs flattened into story cards. A literal
 * `view_type === 'kanban'` check went stale the moment saved view types became real nodes with their own
 * ids: a type saved from Kanban drew as one undifferentiated card holding the whole document, since its
 * epics were never lifted out from under it.
 */
function drawsAsKanban(view_type: string, user_types: UserViewType[]): boolean {
    return chainOf(view_type, registryWithUserTypes(user_types)).includes('kanban');
}

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
    const view_state = props.viewStates?.[note_id] || props.viewStates?.['__default'];
    // the current_file stamp is this composer's source of truth for the toolbar selector, mirroring the folder stamp
    const { viewType, view_display_options } = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
    const view_user_types = view_display_options.settings?.viewUserTypes ?? [];
    // memoize conversion keyed on content hash - avoids redundant work when only selection changes
    const root_note = useMemo(
        () => {
            const root = convertMdastToNoteHierarchy(note.content!, note.text!);
            // flattens epics into story cards for a kanban-shaped board; runs before the stable-id stamp to key off final structure
            if (drawsAsKanban(viewType, view_user_types) || fileDeclaredViewType(root) === 'kanban') {
                flattenSingleFileStories(root, note_id, note.path ?? '');
            }
            stampSingleFileStableIds(root, note_id);
            return root;
        },
        [note.hash_sha256, note_id, note.path, viewType, view_user_types]
    );
    const selection = note.path ? props.selections?.[note.path] : undefined;
    // the flat list only changes when the tree does, and every view memo downstream keys on its identity
    const all_notes = useMemo(() => flattenAllNotes(root_note), [root_note]);
    const cascade = props.settingsCascade;
    const view_state_ids = props.viewStates ? Object.keys(props.viewStates) : undefined;
    const view_props: ViewProps = {
        // --- identity + opened-doc location ---
        id: note_id,
        type: viewType,
        doc_path: note.path,
        doc_relative_path: note.relative_path,
        doc_text: note.text,
        workspace_root: props.workspace_root,
        // --- settings-cascade mirror: camelCase (not snake_case) because these carry VS Code config values whose keys (notethink.settings.*) are camelCase end-to-end, unlike the snake_case note-tree wire data ---
        settingsCascadeHasWorkspaceOverrides: cascade?.hasWorkspaceOverrides,
        settingsCascadeHasAnyOverrides: cascade?.hasAnyOverrides,
        settingsCascadeDiverged: cascade?.diverged,
        // --- view state + the opened file's declared integration intent ---
        view_state_ids,
        file_declared_integration: props.fileDeclaredIntegration,
        display_options: view_display_options,
        // --- note tree ---
        nested: {
            parent_context: root_note,
        },
        notes: all_notes,
        // --- editor-derived inputs: in current_file mode this view's doc IS the active doc, so useViewContext's per-doc caret matcher works uniformly across both modes ---
        selection,
        active_editor_doc_path: note.path,
        // --- handler functions (view→host dispatch) ---
        handlers: {
            setViewManagedState: props.setViewManagedState || (() => {}),
            deleteViewFromManagedState: () => {},
            revertAllViewsToDefaultState: () => {},
            onNavigationCommand: props.onNavigationCommand,
            postMessage: props.postMessage ? (message: unknown) => {
                if (message && typeof message === 'object' && 'type' in message) {
                    const m = message as Record<string, unknown>;
                    // respects an existing docId/docPath; folder mode sets it from note.origin, single-file mode stamps this view's own
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

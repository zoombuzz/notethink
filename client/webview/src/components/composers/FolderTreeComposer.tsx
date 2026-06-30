import Debug from "debug";
import { useMemo } from "react";
import { GenericView } from "../../notethink-views/src/components";
import { mergeAggregateRoot, FOLDER_VIEW_STATE_ID, type AggregatedDocInput } from "../../notethink-views/src/lib/mergeAggregateRoot";
import { INTEGRATION_MODE_FOLDER } from "../../notethink-views/src/types/IntegrationMode";
import { DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, DEFAULT_MAX_NOTES_PER_FILE } from "../../constants";
import { buildViewDisplayOptions } from "../../lib/composerops";
import type { ReactElement } from "react";
import type { HashMapOf, Doc } from "../../types/general";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
import type { TextSelection } from "../../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../NoteRenderer";

const debug = Debug("nodejs:notethink:FolderTreeComposer");

/**
 * FolderTreeComposer merges every loaded Doc into a single synthetic-root tree and
 * renders one GenericView for the whole folder.
 *
 * Tree-composers sit one layer above views (Document/Kanban/Auto): each composer produces
 * the note tree handed to a leaf view. Companion to NoteTreeComposer for single-file mode.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export default function FolderTreeComposer({ docs, integration_path, props }: { docs: HashMapOf<Doc>; integration_path: string; props: NoteRendererProps }): ReactElement {
    // memoize merged root keyed on the joined content hashes of the docs - changes when any doc reparses
    const merge_key = useMemo(() => {
        return Object.entries(docs)
            .map(([id, d]) => `${id}:${d.hash_sha256 ?? ''}`)
            .sort()
            .join('|');
    }, [docs]);

    // folder mode reads and writes through the canonical FOLDER_VIEW_STATE_ID; the scan-by-tag fallback rescues any folder-tagged viewState stranded under a doc-path key
    const view_state_id = FOLDER_VIEW_STATE_ID;
    const view_state = (() => {
        if (!props.viewStates) { return undefined; }
        const canonical = props.viewStates[FOLDER_VIEW_STATE_ID];
        if (canonical) { return canonical; }
        for (const id of Object.keys(props.viewStates)) {
            if (id === FOLDER_VIEW_STATE_ID) { continue; }
            if (props.viewStates[id]?.display_options?.integration_mode === INTEGRATION_MODE_FOLDER) {
                return props.viewStates[id];
            }
        }
        return undefined;
    })();

    // precedence for every cascading setting below: per-session viewState override > cascade resolved by the extension > webview built-in default
    const cascade = props.settingsCascade;
    const maxNotesPerFile = view_state?.display_options?.maxNotesPerFile
        ?? cascade?.maxNotesPerFile
        ?? DEFAULT_MAX_NOTES_PER_FILE;

    const workspace_projects = props.workspace_projects;
    const workspace_projects_key = workspace_projects ? workspace_projects.join('|') : '';
    const { merged_root, all_notes } = useMemo(() => {
        const input: { [key: string]: AggregatedDocInput | undefined } = {};
        for (const [id, d] of Object.entries(docs)) {
            if (d.content && d.text !== undefined) {
                input[id] = {
                    id,
                    path: d.path,
                    relative_path: d.relative_path,
                    content: d.content,
                    text: d.text,
                    mtime: d.mtime,
                };
            }
        }
        const { root, all_notes } = mergeAggregateRoot(input, integration_path, maxNotesPerFile, workspace_projects);
        return { merged_root: root, all_notes };
    }, [merge_key, integration_path, maxNotesPerFile, workspace_projects_key]);
    const { viewType, view_display_options } = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_FOLDER, integration_path);

    // number of source files actually loaded into the merged view (the breadcrumb shows this)
    const file_count = Object.keys(docs).length;
    // top-level stories merged into the synthetic root - the "X" in the breadcrumb "(X in Y files)"
    const note_count = merged_root.child_notes?.length ?? 0;

    // the include/exclude globs are config-tier cascade settings with a SINGLE source of truth: the extension resolves them (workspace > user > built-in) and is the only thing that discovers files with them, then echoes the effective values back as props.{include,exclude}Filter. The drawer must mirror exactly what discovery used, so do NOT layer a per-view viewState override on top - that store can drift from (and silently shadow) the config the extension actually discovered with, leaving the box showing one glob while the loaded file set was filtered by another, and making the cascade Reset buttons (which only clear config) appear to do nothing. cascade is the fallback before the first echo arrives; `''` is a valid user value so ?? is correct (only null/undefined fall through)
    const includeFilter = props.includeFilter ?? cascade?.includeFilter ?? DEFAULT_INCLUDE_FILTER;
    const excludeFilter = props.excludeFilter ?? cascade?.excludeFilter ?? DEFAULT_EXCLUDE_FILTER;

    // loaded source files (workspace-relative where known) for the Files drawer list, stable order
    const aggregate_loaded_files = Object.values(docs)
        .map(d => d.relative_path ?? d.path)
        .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

    const view_state_ids = props.viewStates ? Object.keys(props.viewStates) : undefined;

    // pass the active editor's doc path + its current selection: the per-doc matcher in useViewContext uses these to find which merged note the editor caret currently sits inside
    const active_editor_doc_path = props.activeEditorDocPath;
    const active_selection: TextSelection | undefined = active_editor_doc_path ? props.selections?.[active_editor_doc_path] : undefined;

    const view_props: ViewProps = {
        // --- identity (doc_path/doc_relative_path/doc_text intentionally undefined for the merged view) ---
        id: view_state_id,
        type: viewType,
        workspace_root: props.workspace_root,
        // --- folder aggregate metadata ---
        file_count,
        aggregate_total_discovered: props.aggregate_total_discovered,
        note_count,
        aggregate_loaded_files,
        // --- settings-cascade mirror: camelCase (not snake_case) because these carry VS Code config values whose keys (notethink.settings.*) are camelCase end-to-end, unlike the snake_case note-tree wire data ---
        includeFilter,
        excludeFilter,
        settingsCascadeHasWorkspaceOverrides: cascade?.hasWorkspaceOverrides,
        settingsCascadeHasAnyOverrides: cascade?.hasAnyOverrides,
        // --- view state + the opened file's declared integration intent ---
        view_state_ids,
        file_declared_integration: props.fileDeclaredIntegration,
        display_options: view_display_options,
        // --- note tree ---
        nested: {
            parent_context: merged_root,
        },
        notes: all_notes,
        // --- editor-derived inputs: the active editor's doc + its selection drive useViewContext's per-doc caret matcher ---
        selection: active_selection,
        active_editor_doc_path,
        // --- handler functions (view→host dispatch) ---
        handlers: {
            setViewManagedState: props.setViewManagedState || (() => {}),
            deleteViewFromManagedState: () => {},
            revertAllViewsToDefaultState: () => {},
            onNavigationCommand: props.onNavigationCommand,
            postMessage: props.postMessage ? (message: unknown) => {
                // folder mode click handlers attach docPath from note.origin; we don't stamp a synthetic doc here, so messages without origin context pass through and the extension drops anything it can't route
                props.postMessage!(message);
            } : undefined,
        },
    };

    return <GenericView {...view_props} />;
}

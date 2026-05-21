import Debug from "debug";
import { useMemo } from "react";
import type { HashMapOf, Doc } from "../../types/general";
import { mergeAggregateRoot, FOLDER_VIEW_STATE_ID, type AggregatedDocInput } from "../../notethink-views/src/lib/mergeAggregateRoot";
import { GenericView } from "../../notethink-views/src/components";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
import type { NoteDisplayOptions } from "../../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../NoteRenderer";
import { DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, DEFAULT_MAX_NOTES_PER_FILE } from "../../constants";
const debug = Debug("nodejs:notethink:FolderTreeComposer");

/**
 * FolderTreeComposer merges every loaded Doc into a single synthetic-root tree and
 * renders one GenericView for the whole folder.
 *
 * Tree-composers sit one layer above views (Document/Kanban/Auto): each composer produces
 * the note tree handed to a leaf view. Companion to NoteTreeComposer for single-file mode.
 */
export default function FolderTreeComposer({ docs, integration_path, props }: { docs: HashMapOf<Doc>; integration_path: string; props: NoteRendererProps }) {
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
            if (props.viewStates[id]?.display_options?.integration_mode === 'folder') {
                return props.viewStates[id];
            }
        }
        return undefined;
    })();

    // precedence for every cascading setting below: per-session viewState override > cascade resolved by the extension > webview built-in default
    const cascade = props.folderViewSettings;
    const max_notes_per_file = view_state?.display_options?.max_notes_per_file
        ?? cascade?.max_notes_per_file
        ?? DEFAULT_MAX_NOTES_PER_FILE;

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
        const { root, all_notes } = mergeAggregateRoot(input, integration_path, max_notes_per_file);
        return { merged_root: root, all_notes };
    }, [merge_key, integration_path, max_notes_per_file]);
    const view_type = view_state?.type || cascade?.view_type || 'auto';
    const cascade_column_order = cascade?.column_order && cascade.column_order.length > 0
        ? cascade.column_order
        : undefined;
    const cascade_settings: Record<string, unknown> = {
        show_line_numbers: props.globalSettings?.show_line_numbers ?? false,
        watch_unopened_files_in_viewer: props.globalSettings?.watch_unopened_files_in_viewer ?? true,
        show_context_bars: cascade?.show_context_bars ?? true,
    };
    if (cascade_column_order) { cascade_settings.column_order = cascade_column_order; }
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        integration_mode: 'folder',
        integration_path,
        settings: {
            ...cascade_settings,
            ...view_state?.display_options?.settings,
        },
    };

    // number of source files actually loaded into the merged view (the breadcrumb shows this)
    const file_count = Object.keys(docs).length;
    // top-level stories merged into the synthetic root — the "X" in the breadcrumb "(X in Y files)"
    const note_count = merged_root.child_notes?.length ?? 0;

    // precedence: per-session override > extension's echoed effective globs > cascade > built-in default. `''` is a valid user value (exclude cleared) so ?? is correct (only null/undefined fall through)
    const include_filter = view_state?.display_options?.include_filter
        ?? props.include_filter ?? cascade?.include_filter ?? DEFAULT_INCLUDE_FILTER;
    const exclude_filter = view_state?.display_options?.exclude_filter
        ?? props.exclude_filter ?? cascade?.exclude_filter ?? DEFAULT_EXCLUDE_FILTER;

    // loaded source files (workspace-relative where known) for the Files drawer list, stable order
    const aggregate_loaded_files = Object.values(docs)
        .map(d => d.relative_path ?? d.path)
        .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

    const view_props: ViewProps = {
        id: view_state_id,
        type: view_type,
        // doc_path/doc_relative_path/doc_text intentionally undefined for the merged view
        workspace_root: props.workspace_root,
        file_count,
        aggregate_total_discovered: props.aggregate_total_discovered,
        note_count,
        include_filter,
        exclude_filter,
        aggregate_loaded_files,
        folder_view_cascade_has_workspace_overrides: cascade?.has_workspace_overrides,
        display_options: view_display_options,
        nested: {
            parent_context: merged_root,
        },
        notes: all_notes,
        // no single selection in folder mode
        selection: undefined,
        handlers: {
            setViewManagedState: props.setViewManagedState || (() => {}),
            deleteViewFromManagedState: () => {},
            revertAllViewsToDefaultState: () => {},
            onNavigationCommand: props.onNavigationCommand,
            postMessage: props.postMessage ? (message: unknown) => {
                // in folder mode the click handlers attach docPath from note.origin
                // we don't stamp a synthetic doc here — messages without origin context are passed through and the extension drops anything it can't route
                props.postMessage!(message);
            } : undefined,
        },
    };

    return <GenericView {...view_props} />;
}

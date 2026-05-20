import Debug from "debug";
import { useMemo } from "react";
import type { HashMapOf, Doc } from "../../types/general";
import { mergeAggregateRoot, type AggregatedDocInput } from "../../notethink-views/src/lib/mergeAggregateRoot";
import { GenericView } from "../../notethink-views/src/components";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
import type { NoteDisplayOptions } from "../../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../NoteRenderer";
const debug = Debug("nodejs:notethink:AggregateTreeComposer");

// webview-side mirror of the extension's aggregate-filter defaults (notethinkEditor.ts
// DEFAULT_AGGREGATE_INCLUDE/EXCLUDE); used until the extension echoes the effective globs
export const DEFAULT_AGGREGATE_INCLUDE = '**/*.md';
export const DEFAULT_AGGREGATE_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,dist,build,out,.next,.cache,coverage}/**';
// webview-only cap on top-level stories taken per source file when merging the aggregate; not round-tripped to the extension
export const DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE = 10;

/**
 * AggregateTreeComposer merges every loaded Doc into a single synthetic-root tree and
 * renders one GenericView for the whole folder.
 *
 * Tree-composers sit one layer above views (Document/Kanban/Auto): each composer produces
 * the note tree handed to a leaf view. Companion to NoteTreeComposer for single-file mode.
 */
export default function AggregateTreeComposer({ docs, integration_path, props }: { docs: HashMapOf<Doc>; integration_path: string; props: NoteRendererProps }) {
    // memoize merged root keyed on the joined content hashes of the docs - changes when any doc reparses
    const merge_key = useMemo(() => {
        return Object.entries(docs)
            .map(([id, d]) => `${id}:${d.hash_sha256 ?? ''}`)
            .sort()
            .join('|');
    }, [docs]);

    // pick the first view state in folder mode as the source of display_options for the merged view
    // use that view state's id for the GenericView too, so settings/column-reorder dispatches round-trip back to the same state the renderer reads
    const { view_state_id, view_state } = (() => {
        if (!props.viewStates) { return { view_state_id: '__aggregate__', view_state: undefined }; }
        for (const id of Object.keys(props.viewStates)) {
            if (props.viewStates[id]?.display_options?.integration_mode === 'folder') {
                return { view_state_id: id, view_state: props.viewStates[id] };
            }
        }
        return { view_state_id: '__aggregate__', view_state: props.viewStates['__default'] };
    })();

    // effective per-file story cap: the user's persisted per-view override wins, else the webview default; applied purely webview-side by mergeAggregateRoot (never round-trips to the extension)
    const max_notes_per_file = view_state?.display_options?.aggregate_max_notes_per_file
        ?? DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE;

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
                };
            }
        }
        const { root, all_notes } = mergeAggregateRoot(input, integration_path, max_notes_per_file);
        return { merged_root: root, all_notes };
    }, [merge_key, integration_path, max_notes_per_file]);
    const view_type = view_state?.type || 'auto';
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        integration_mode: 'folder',
        integration_path,
        settings: {
            show_line_numbers: props.globalSettings?.show_line_numbers ?? false,
            watch_unopened_files_in_viewer: props.globalSettings?.watch_unopened_files_in_viewer ?? true,
            ...view_state?.display_options?.settings,
        },
    };

    // number of source files actually loaded into the merged view (the breadcrumb shows this)
    const file_count = Object.keys(docs).length;
    // top-level stories merged into the synthetic root — the "X" in the breadcrumb "(X in Y files)"
    const note_count = merged_root.child_notes?.length ?? 0;

    // effective filters: the user's persisted per-view override wins, else the extension's echoed globs, else the defaults; '' is a valid user value (exclude cleared) so ?? is correct (only null/undefined fall through)
    const aggregate_include = view_state?.display_options?.aggregate_include
        ?? props.aggregate_include ?? DEFAULT_AGGREGATE_INCLUDE;
    const aggregate_exclude = view_state?.display_options?.aggregate_exclude
        ?? props.aggregate_exclude ?? DEFAULT_AGGREGATE_EXCLUDE;

    // loaded source files (workspace-relative where known) for the Files drawer list, stable order
    const aggregate_files = Object.values(docs)
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
        aggregate_include,
        aggregate_exclude,
        aggregate_files,
        active_doc_path: props.active_doc_path,
        display_options: view_display_options,
        nested: {
            parent_context: merged_root,
        },
        notes: all_notes,
        // no single selection in aggregate mode
        selection: undefined,
        handlers: {
            setViewManagedState: props.setViewManagedState || (() => {}),
            deleteViewFromManagedState: () => {},
            revertAllViewsToDefaultState: () => {},
            onNavigationCommand: props.onNavigationCommand,
            postMessage: props.postMessage ? (message: unknown) => {
                // in aggregate mode the click handlers attach docPath from note.origin
                // we don't stamp a synthetic doc here — messages without origin context are passed through and the extension drops anything it can't route
                props.postMessage!(message);
            } : undefined,
        },
    };

    return <GenericView {...view_props} />;
}

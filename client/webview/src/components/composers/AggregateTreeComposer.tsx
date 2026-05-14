import Debug from "debug";
import { useMemo } from "react";
import type { HashMapOf, Doc } from "../../types/general";
import { mergeAggregateRoot, type AggregatedDocInput } from "../../notethink-views/src/lib/mergeAggregateRoot";
import { GenericView } from "../../notethink-views/src/components";
import type { ViewProps } from "../../notethink-views/src/types/ViewProps";
import type { NoteDisplayOptions } from "../../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../NoteRenderer";
const debug = Debug("nodejs:notethink:AggregateTreeComposer");

/**
 * AggregateTreeComposer merges every loaded Doc into a single synthetic-root tree and
 * renders one GenericView for the whole directory.
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
        const { root, all_notes } = mergeAggregateRoot(input, integration_path);
        return { merged_root: root, all_notes };
    }, [merge_key, integration_path]);

    // pick the first view state in directory mode as the source of display_options for the merged view
    // use that view state's id for the GenericView too, so settings/column-reorder dispatches round-trip back to the same state the renderer reads
    const { view_state_id, view_state } = (() => {
        if (!props.viewStates) { return { view_state_id: '__aggregate__', view_state: undefined }; }
        for (const id of Object.keys(props.viewStates)) {
            if (props.viewStates[id]?.display_options?.integration_mode === 'directory') {
                return { view_state_id: id, view_state: props.viewStates[id] };
            }
        }
        return { view_state_id: '__aggregate__', view_state: props.viewStates['__default'] };
    })();
    const view_type = view_state?.type || 'auto';
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        integration_mode: 'directory',
        integration_path,
        settings: {
            show_line_numbers: props.globalSettings?.show_line_numbers ?? false,
            ...view_state?.display_options?.settings,
        },
    };

    const view_props: ViewProps = {
        id: view_state_id,
        type: view_type,
        // doc_path/doc_relative_path/doc_text intentionally undefined for the merged view
        workspace_root: props.workspace_root,
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

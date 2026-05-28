import Debug from "debug";
import { INTEGRATION_MODE_FOLDER } from "../types/IntegrationMode";
import type { ViewApi, ViewProps } from "../types/ViewProps";

const debug = Debug("nodejs:notethink-views:viewstateops");

/**
 * shared shape for the persisted view-state map this module inspects. Mirrors
 * the runtime ViewState the host (usePersistedViewStates) uses without forcing
 * a cross-bundle import — the only fields read here are display_options.integration_mode
 * and display_options.integration_path.
 */
export interface ViewStateLike {
    type?: string;
    display_options?: {
        integration_mode?: string;
        integration_path?: string;
        [key: string]: unknown;
    };
}

/**
 * canonical viewState key for folder mode. All folder-mode reads and writes use this key so
 * settings (columnOrder, filters, view type, etc.) survive a flip to current_file mode and back.
 */
export const FOLDER_VIEW_STATE_ID = '__folder__';

/**
 * detect whether any of the supplied view states has switched to folder aggregation. Checks
 * the canonical FOLDER_VIEW_STATE_ID first, then falls back to a scan for any entry tagged
 * integration_mode='folder' so a stranded doc-path-keyed viewState still resolves to folder
 * mode (legacy rescue — necessary for pre-fix persisted state that never had a canonical
 * entry; the dispatcher's clearing-on-flip is what eventually cleans this up).
 */
export function anyViewInFolderMode(
    view_states: Record<string, ViewStateLike> | undefined,
): boolean {
    if (!view_states) { return false; }
    if (view_states[FOLDER_VIEW_STATE_ID]?.display_options?.integration_mode === INTEGRATION_MODE_FOLDER) { return true; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        if (view_states[id]?.display_options?.integration_mode === INTEGRATION_MODE_FOLDER) { return true; }
    }
    return false;
}

/**
 * resolve the view-state key a dispatch should target for `props`: FOLDER_VIEW_STATE_ID
 * when the view is in folder mode (so persisted folder settings survive a flip to current_file
 * and back), otherwise the view's own id. Centralises the FOLDER-vs-props.id routing decision
 * that used to be inlined in writeViewInteractionState / handle_integration_change /
 * handle_folder_click.
 */
export function resolveViewStateId(props: ViewProps): string {
    return props.display_options?.integration_mode === INTEGRATION_MODE_FOLDER
        ? FOLDER_VIEW_STATE_ID
        : props.id;
}

/**
 * write per-view focused/selected seqs to the view-managed state. The dispatch target is
 * the canonical FOLDER_VIEW_STATE_ID in folder mode (so the state survives a flip to
 * current_file and back) and the view's own id in current_file mode. The caller is
 * responsible for computing the focused chain (deepest note + ancestors); selected is
 * typically a single-seq list (the clicked note) or empty when transitioning out of
 * selection.
 */
export function writeViewInteractionState(
    props: ViewProps,
    handlers: ViewApi,
    focused_seqs: number[],
    selected_seqs: number[],
): void {
    handlers.setViewManagedState([{
        id: resolveViewStateId(props),
        type: props.type,
        display_options: {
            view_focused_seqs: focused_seqs,
            view_selected_seqs: selected_seqs,
        },
    }]);
}

/**
 * locate the folder viewState entry in a view-state map. Prefers the canonical
 * FOLDER_VIEW_STATE_ID key; falls back to the first entry whose display_options tag the
 * view as folder mode (legacy rescue for state stranded under a doc-path key by the
 * pre-fix dispatch bug). Returns undefined when no entry qualifies.
 */
export function findFolderViewState<T extends ViewStateLike>(
    view_states: Record<string, T> | undefined,
): T | undefined {
    if (!view_states) { return undefined; }
    const canonical = view_states[FOLDER_VIEW_STATE_ID];
    if (canonical?.display_options?.integration_mode === INTEGRATION_MODE_FOLDER) { return canonical; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        const entry = view_states[id];
        if (entry?.display_options?.integration_mode === INTEGRATION_MODE_FOLDER) { return entry; }
    }
    return undefined;
}

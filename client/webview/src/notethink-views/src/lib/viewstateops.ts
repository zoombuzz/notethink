import Debug from "debug";
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../types/IntegrationMode";
import type { ViewApi, ViewProps } from "../types/ViewProps";

const debug = Debug("nodejs:notethink-views:viewstateops");

/**
 * shared shape for the persisted view-state map this module inspects. Mirrors
 * the runtime ViewState the host (usePersistedViewStates) uses without forcing
 * a cross-bundle import - the only fields read here are display_options.integration_mode
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
 * resolve a (possibly auto) persisted integration_mode down to the concrete mode the renderer
 * and toolbar act on. Concrete folder / current_file pass through unchanged. `auto` (and an
 * undefined / absent value, which is treated as auto for back-compat - untouched views need no
 * migration) resolves to folder iff a folder `integration_path` was seeded, else current_file.
 *
 * The auto ⇄ concrete distinction is the visible "still automatic?" signal (no hidden marker):
 * the App-layer auto-resolution writes `integration_path` only when the opened file's
 * nt_integration_mode / nt_breadcrumb_last resolves to folder, and every flip-to-current_file
 * path clears it - so `auto` + a path unambiguously means "auto resolved to folder".
 */
export function resolveIntegrationMode(
    display_options: { integration_mode?: string; integration_path?: string } | undefined,
): ConcreteIntegrationMode {
    const mode = display_options?.integration_mode;
    if (mode === INTEGRATION_MODE_FOLDER) { return INTEGRATION_MODE_FOLDER; }
    if (mode === INTEGRATION_MODE_CURRENT_FILE) { return INTEGRATION_MODE_CURRENT_FILE; }
    return display_options?.integration_path ? INTEGRATION_MODE_FOLDER : INTEGRATION_MODE_CURRENT_FILE;
}

/**
 * congruence-seeking reconciliation for a navigation gesture: given the concrete mode the
 * navigation lands on and the mode the opened file declares, return the value to persist as
 * `integration_mode`. Returns `auto` when the destination matches the file's declared mode
 * (keep / return to auto - the view keeps following the file), and the concrete resulting mode
 * when navigation diverges from the file's intent (pin the user's choice). A file with no
 * declaration (undefined) only ever returns auto when the destination is current_file.
 */
export function reconcileAutoIntegrationMode(
    resulting_mode: ConcreteIntegrationMode,
    file_declared_mode: ConcreteIntegrationMode | undefined,
): IntegrationMode {
    const effective_declared = file_declared_mode ?? INTEGRATION_MODE_CURRENT_FILE;
    return resulting_mode === effective_declared ? INTEGRATION_MODE_AUTO : resulting_mode;
}

/**
 * detect whether any of the supplied view states resolves to folder aggregation. Checks the
 * canonical FOLDER_VIEW_STATE_ID first, then falls back to a scan for any entry that resolves
 * folder so a stranded doc-path-keyed viewState still counts (legacy rescue - necessary for
 * pre-fix persisted state that never had a canonical entry; the dispatcher's clearing-on-flip
 * is what eventually cleans this up). `auto` + a seeded integration_path resolves folder via
 * resolveIntegrationMode.
 */
export function anyViewInFolderMode(
    view_states: Record<string, ViewStateLike> | undefined,
): boolean {
    if (!view_states) { return false; }
    if (resolveIntegrationMode(view_states[FOLDER_VIEW_STATE_ID]?.display_options) === INTEGRATION_MODE_FOLDER) { return true; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        if (resolveIntegrationMode(view_states[id]?.display_options) === INTEGRATION_MODE_FOLDER) { return true; }
    }
    return false;
}

/**
 * resolve the view-state key a dispatch should target for `props`: FOLDER_VIEW_STATE_ID
 * when the view resolves to folder mode (so persisted folder settings survive a flip to
 * current_file and back), otherwise the view's own id. Centralises the FOLDER-vs-props.id
 * routing decision that used to be inlined in writeViewInteractionState /
 * handle_integration_change / handle_folder_click.
 */
export function resolveViewStateId(props: ViewProps): string {
    return resolveIntegrationMode(props.display_options) === INTEGRATION_MODE_FOLDER
        ? FOLDER_VIEW_STATE_ID
        : props.id;
}

/**
 * write per-view focused/selected stable_ids to the view-managed state. The dispatch target is
 * the canonical FOLDER_VIEW_STATE_ID in folder mode (so the state survives a flip to
 * current_file and back) and the view's own id in current_file mode. The caller is
 * responsible for computing the focused chain (deepest note + ancestors); selected is
 * typically a single-id list (the clicked note) or empty when transitioning out of
 * selection. Stored as stable_ids (invariant across re-parse) so a drag-reorder does not
 * make the highlight jump to whichever note now holds the reassigned seq.
 */
export function writeViewInteractionState(
    props: ViewProps,
    handlers: ViewApi,
    focused_ids: string[],
    selected_ids: string[],
): void {
    handlers.setViewManagedState([{
        id: resolveViewStateId(props),
        type: props.type,
        display_options: {
            view_focused_ids: focused_ids,
            view_selected_ids: selected_ids,
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
    if (canonical && resolveIntegrationMode(canonical.display_options) === INTEGRATION_MODE_FOLDER) { return canonical; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        const entry = view_states[id];
        if (entry && resolveIntegrationMode(entry.display_options) === INTEGRATION_MODE_FOLDER) { return entry; }
    }
    return undefined;
}

import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../types/IntegrationMode";
import type { NoteDisplayOptions } from "../types/NoteProps";
import type { ViewApi, ViewProps } from "../types/ViewProps";

/**
 * The slice of the host's persisted ViewState this module reads, declared here to avoid a
 * cross-bundle import.
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
 * Canonical viewState key for folder mode. All folder-mode reads and writes use this key so
 * settings (groupDisplay, filters, view type, etc.) survive a flip to current_file mode and back.
 */
export const FOLDER_VIEW_STATE_ID = '__folder__';

/**
 * Cap on the persisted manual-expansion list. The list rides in the vscode.setState shape, so it
 * cannot grow with every card the user has ever opened; past this many ids the oldest evict first.
 */
export const MAX_EXPANDED_IDS = 50;

/**
 * Resolves a persisted integration_mode to a concrete mode. `auto`, or no value, means folder iff an
 * `integration_path` is seeded: only auto-resolution to folder writes one, and every flip to
 * current_file clears it.
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
 * The setIntegration payload posted to the extension when an integration change resolves to a
 * concrete mode. `path` is the folder scope (folder mode) or the file to open (a current_file
 * resolve triggered by a Files-drawer click); undefined when neither applies.
 */
export interface SetIntegrationMessage {
    type: 'setIntegration';
    mode: ConcreteIntegrationMode;
    path?: string;
}

/**
 * Inputs for buildIntegrationDispatch. The caller has already resolved the concrete mode + folder
 * scope (an auto reset resolves them from the file declaration; a concrete pin from the user's pick).
 * - is_auto: persist `auto` (the view keeps following the file) vs the concrete mode (a user pin)
 * - resolved_mode: the concrete mode this change lands on
 * - folder_path: the folder scope when resolved_mode is folder, else undefined
 * - seed_parent_context_id: re-seed the note-hierarchy scope on the view's own id (auto reset to a
 *   current_file file that declares an epic/story scope), as the authored nt_breadcrumb_last label
 *   the view re-resolves each render; undefined to skip
 * - view_id: the view's own id (the seed target; skipped in the clear loop)
 * - view_state_ids: every persisted view-state id, so focused/selected are cleared everywhere and
 *   stranded folder tags on non-canonical (doc-path) keys are cleared on a resolve to current_file
 * - target_file_path: a Files-drawer click's file to open on a current_file resolve; undefined otherwise
 */
export interface IntegrationDispatchRequest {
    is_auto: boolean;
    resolved_mode: ConcreteIntegrationMode;
    folder_path: string | undefined;
    seed_parent_context_id?: string;
    view_id: string;
    view_state_ids: readonly string[];
    target_file_path?: string;
}

/**
 * The view-state updates + optional setIntegration payload an integration change produces.
 */
export interface IntegrationDispatch {
    updates: Array<Record<string, unknown>>;
    message: SetIntegrationMessage | undefined;
}

/**
 * The one builder of an integration-mode change, so the toolbar and editor-follow paths cannot drift.
 * Focused/selected/expanded ids are cleared on every change, since folder and current_file use
 * different id spaces; a resolve to current_file also clears folder tags stranded on doc-path keys.
 */
export function buildIntegrationDispatch(req: IntegrationDispatchRequest): IntegrationDispatch {
    const { is_auto, resolved_mode, folder_path, seed_parent_context_id, view_id, view_state_ids, target_file_path } = req;
    const clear_stranded_folder_tag = resolved_mode === INTEGRATION_MODE_CURRENT_FILE;
    const canonical_display_options: Record<string, unknown> = {
        // persist 'auto' on a reset (the view keeps following the file) and the concrete mode on a pin
        integration_mode: is_auto ? INTEGRATION_MODE_AUTO : resolved_mode,
        integration_path: resolved_mode === INTEGRATION_MODE_FOLDER ? folder_path : undefined,
        view_focused_ids: undefined,
        view_selected_ids: undefined,
        view_expanded_ids: undefined,
        view_caret: undefined,
    };
    const updates: Array<Record<string, unknown>> = [{ id: FOLDER_VIEW_STATE_ID, display_options: canonical_display_options }];
    for (const id of view_state_ids) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        const non_canonical_display_options: Record<string, unknown> = {
            view_focused_ids: undefined,
            view_selected_ids: undefined,
            view_expanded_ids: undefined,
            view_caret: undefined,
        };
        if (clear_stranded_folder_tag) {
            non_canonical_display_options.integration_mode = undefined;
            non_canonical_display_options.integration_path = undefined;
        }
        updates.push({ id, display_options: non_canonical_display_options });
    }
    if (resolved_mode === INTEGRATION_MODE_CURRENT_FILE && seed_parent_context_id !== undefined && view_id !== FOLDER_VIEW_STATE_ID) {
        updates.push({ id: view_id, display_options: { parent_context_id: seed_parent_context_id } });
    }
    let message: SetIntegrationMessage | undefined;
    if (resolved_mode === INTEGRATION_MODE_FOLDER && folder_path) {
        message = { type: 'setIntegration', mode: INTEGRATION_MODE_FOLDER, path: folder_path };
    } else if (resolved_mode === INTEGRATION_MODE_CURRENT_FILE) {
        message = { type: 'setIntegration', mode: INTEGRATION_MODE_CURRENT_FILE, path: target_file_path };
    }
    return { updates, message };
}

/**
 * The integration_mode to persist after navigation: `auto` when the destination matches the file's
 * declared mode, else the destination as a pin. An undeclared file counts as declaring current_file.
 */
export function reconcileAutoIntegrationMode(
    resulting_mode: ConcreteIntegrationMode,
    file_declared_mode: ConcreteIntegrationMode | undefined,
): IntegrationMode {
    const effective_declared = file_declared_mode ?? INTEGRATION_MODE_CURRENT_FILE;
    return resulting_mode === effective_declared ? INTEGRATION_MODE_AUTO : resulting_mode;
}

/**
 * Whether any view state resolves to folder: the canonical key first, then any entry, so persisted
 * state stranded under a doc-path key still counts.
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
 * The view-state key to dispatch to: FOLDER_VIEW_STATE_ID in folder mode, so folder settings survive
 * a flip to current_file and back, else the view's own id.
 */
export function resolveViewStateId(props: ViewProps): string {
    return resolveIntegrationMode(props.display_options) === INTEGRATION_MODE_FOLDER
        ? FOLDER_VIEW_STATE_ID
        : props.id;
}

/**
 * Writes focused/selected ids as stable_ids, so a drag-reorder that reassigns seqs doesn't move the
 * highlight. The caller computes the focused chain.
 */
export function writeViewInteractionState(
    props: ViewProps,
    handlers: ViewApi,
    focused_ids: string[],
    selected_ids: string[],
    view_caret?: number,
): void {
    const display_options: NoteDisplayOptions = {
        view_focused_ids: focused_ids,
        view_selected_ids: selected_ids,
    };
    // only stamp the virtual caret when the caller supplies one, so callers that only move focus do not clobber it
    if (view_caret !== undefined) {
        display_options.view_caret = view_caret;
    }
    handlers.setViewManagedState([{
        id: resolveViewStateId(props),
        type: props.type,
        display_options,
    }]);
}

/**
 * Applies one expand/collapse to the manual-expansion id list, newest last. Expanding an id already
 * in the list moves it to the newest slot, so a card the user keeps reopening is the last to be
 * evicted; past MAX_EXPANDED_IDS the oldest ids drop off the front. Collapsing removes the id and
 * never evicts anything else. Pure, so the transition can be tested without a view.
 */
export function nextExpandedIds(current_ids: string[] | undefined, stable_id: string, expanded: boolean): string[] {
    const without_id = (current_ids ?? []).filter((id) => id !== stable_id);
    if (!expanded) { return without_id; }
    const next_ids = [...without_id, stable_id];
    return next_ids.length > MAX_EXPANDED_IDS ? next_ids.slice(next_ids.length - MAX_EXPANDED_IDS) : next_ids;
}

/**
 * Writes the manual-expansion ids to the same key as the focused/selected ids. The payload carries
 * view_expanded_ids alone; the one-level display_options merge leaves the other ids intact.
 */
export function writeViewExpandedIds(
    props: ViewProps,
    handlers: ViewApi,
    expanded_ids: string[],
): void {
    const display_options: NoteDisplayOptions = {
        view_expanded_ids: expanded_ids,
    };
    handlers.setViewManagedState([{
        id: resolveViewStateId(props),
        type: props.type,
        display_options,
    }]);
}

/**
 * The folder viewState entry: the canonical key, else the first entry tagged folder, since state can
 * be stranded under a doc-path key.
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

import Debug from "debug";
import { FOLDER_VIEW_STATE_ID } from "../notethink-views/src/lib/viewstateops";
import { INTEGRATION_MODE_AUTO, type IntegrationMode } from "../notethink-views/src/types/IntegrationMode";
import type { ViewState } from "../hooks/usePersistedViewStates";
import type { NoteDisplayOptions } from "../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../components/NoteRenderer";

const debug = Debug("nodejs:notethink:composerops");

/**
 * BuildViewDisplayOptionsResult is the bundle the composers consume.
 * - viewType: per-session viewState override → cascade → 'auto' default
 * - view_display_options: ready-to-spread NoteDisplayOptions for the rendered view; carries the integration_mode tag, the integration_path (folder mode only), and the merged settings block
 */
export interface BuildViewDisplayOptionsResult {
    viewType: string;
    view_display_options: NoteDisplayOptions;
}

/**
 * Build the per-view display options + resolved viewType shared by both tree-composers.
 *
 * Precedence for every cascading setting: per-session viewState override > cascade
 * resolved by the extension > webview built-in default. View-type members
 * (columnOrder, showLinetagsInHeadlines, scrollNoteIntoView, autoExpandFocusedNote,
 * showContextBars, viewType) apply universally - a setting changed in folder mode
 * shows up in current_file mode and vice versa.
 *
 * The integration_mode + integration_path stamp makes the composer the single source
 * of truth for the toolbar selector + breadcrumb; without it a stale stranded tag on
 * the viewState's display_options could still register as folder. In current_file mode
 * integration_path is explicitly stamped undefined for the same reason.
 *
 * `mode` is the concrete mode the renderer already resolved (folder/current_file) and is
 * stamped as integration_mode for the view internals; the persisted selection (which may be
 * 'auto') is captured separately as integration_mode_selection so the toolbar selector can
 * render "Auto (Folder)" / "Auto (Current file)" vs the concrete labels. The selection is read
 * from the canonical FOLDER_VIEW_STATE_ID - where handle_integration_change always writes the
 * pin - not from the per-doc view_state the current_file composer renders against, which never
 * carries the pin (and is explicitly cleared on a flip to current_file).
 */
export function buildViewDisplayOptions(
    props: NoteRendererProps,
    view_state: ViewState | undefined,
    mode: IntegrationMode,
    integration_path?: string,
): BuildViewDisplayOptionsResult {
    const cascade = props.settingsCascade;
    const viewType = view_state?.type || cascade?.viewType || 'auto';
    const cascade_column_order = cascade?.columnOrder && cascade.columnOrder.length > 0
        ? cascade.columnOrder
        : undefined;
    const cascade_settings: Record<string, unknown> = {
        showLineNumbers: props.globalSettings?.showLineNumbers ?? false,
        watchUnopenedFilesInViewer: props.globalSettings?.watchUnopenedFilesInViewer ?? true,
        kanbanAnimateTransitions: props.globalSettings?.kanbanAnimateTransitions ?? true,
        openNewEditorIfNoneOpen: props.globalSettings?.openNewEditorIfNoneOpen ?? false,
        showContextBars: cascade?.showContextBars ?? true,
    };
    if (cascade_column_order) { cascade_settings.columnOrder = cascade_column_order; }
    const persisted_selection = props.viewStates?.[FOLDER_VIEW_STATE_ID]?.display_options?.integration_mode;
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        integration_mode: mode,
        integration_mode_selection: persisted_selection ?? INTEGRATION_MODE_AUTO,
        integration_path,
        settings: {
            ...cascade_settings,
            ...view_state?.display_options?.settings,
        },
    };
    return { viewType, view_display_options };
}

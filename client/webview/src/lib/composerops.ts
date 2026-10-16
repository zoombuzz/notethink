import { resolvedSettingsFromCascade } from "../notethink-views/src/lib/viewregistryops";
import { FOLDER_VIEW_STATE_ID } from "../notethink-views/src/lib/viewstateops";
import { INTEGRATION_MODE_AUTO, type IntegrationMode } from "../notethink-views/src/types/IntegrationMode";
import { DEFAULT_SETTINGS_CASCADE } from "../constants";
import type { ViewState } from "../hooks/usePersistedViewStates";
import type { NoteDisplayOptions } from "../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../components/NoteRenderer";

// the three aggregate fields describe the cascade, so they never enter the merged settings
const CASCADE_AGGREGATE_FIELDS: string[] = ['diverged', 'hasWorkspaceOverrides', 'hasAnyOverrides'];

/**
 * BuildViewDisplayOptionsResult is the bundle the composers consume.
 * - viewType: the rendered view's own type when the view state carries one, else the cascade's viewType
 * - view_display_options: ready-to-spread NoteDisplayOptions for the rendered view; carries the integration_mode tag, the integration_path (folder mode only), and the settings block
 */
export interface BuildViewDisplayOptionsResult {
    viewType: string;
    view_display_options: NoteDisplayOptions;
}

/**
 * Build the per-view display options + resolved viewType shared by both tree-composers.
 *
 * There is ONE read tier for settings: the cascade the extension resolved (built-in default → User →
 * Workspace) and pushed over the settingsCascade channel. Every value in the settings block comes
 * from it, so a setting changed anywhere shows up everywhere - across integration modes, across
 * panels, and across a reload. A per-session viewState settings block is no longer merged over the
 * top; any stale one persisted by an earlier build is ignored rather than migrated.
 *
 * The settings block here is deliberately the RAW flat cascade - a saved type's own bag entry and a
 * built-in view's own entry in the `views` bag are no longer folded in here at all.
 * `GenericView.tsx` calls `resolvedSettingsForView` once, for the rendered view, to get the resolved
 * values the board actually needs; the settings drawer calls the SAME resolver per row, for whichever
 * node is selected there. Folding either kind of override in here would give the drawer no way to tell
 * a flat home value from a value a saved type or a built-in descendant holds of its own, which is
 * exactly the bug ("selecting an ancestor shows the wrong value") this split exists to avoid.
 *
 * viewType is the one member the view state still speaks for, because the rendered view's `type` is
 * also its identity: a type picked in the toolbar is dispatched to this view AND cascade-written, so
 * the view state holds the same value the cascade does and simply gets there first.
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
    const cascade = resolvedSettingsFromCascade(props.settingsCascade ?? DEFAULT_SETTINGS_CASCADE);
    const viewType = view_state?.type || cascade.viewType || 'auto';
    const cascade_settings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cascade)) {
        if (CASCADE_AGGREGATE_FIELDS.includes(key)) { continue; }
        cascade_settings[key] = value;
    }
    // the cascade spells natural order (every group shown) as an empty array, read as no groupDisplay at all
    if (Array.isArray(cascade_settings.groupDisplay) && cascade_settings.groupDisplay.length === 0) {
        delete cascade_settings.groupDisplay;
    }
    const persisted_selection = props.viewStates?.[FOLDER_VIEW_STATE_ID]?.display_options?.integration_mode;
    const view_display_options: NoteDisplayOptions = {
        ...view_state?.display_options,
        integration_mode: mode,
        integration_mode_selection: persisted_selection ?? INTEGRATION_MODE_AUTO,
        integration_path,
        settings: cascade_settings,
    };
    return { viewType, view_display_options };
}

import { FOLDER_VIEW_STATE_ID } from "../notethink-views/src/lib/viewstateops";
import { chainOf, registryWithUserTypes } from "../notethink-views/src/lib/viewregistryops";
import { INTEGRATION_MODE_AUTO, type IntegrationMode } from "../notethink-views/src/types/IntegrationMode";
import { DEFAULT_SETTINGS_CASCADE } from "../constants";
import type { ViewState } from "../hooks/usePersistedViewStates";
import type { UserViewType } from "../notethink-views/src/types/Messages";
import type { NoteDisplayOptions } from "../notethink-views/src/types/NoteProps";
import type { NoteRendererProps } from "../components/NoteRenderer";

// the cascade payload's three aggregate fields describe the cascade rather than name a setting, so they never enter the merged settings block
const CASCADE_AGGREGATE_FIELDS: string[] = ['diverged', 'hasWorkspaceOverrides', 'hasAnyOverrides'];

/**
 * Fold the overrides of every minted view type on the resolved type's chain over the cascade block.
 *
 * A minted type IS its overrides - "Kanban by Assignee" means a kanban whose axis is assignee - so its
 * declared values layer OVER the saved configuration rather than under it. Selecting the type is what
 * asks for them, and a cascade value winning instead would make choosing the type do nothing. They are
 * keyed by cascade key, exactly as the drawer wrote them, so they apply with no structural translation.
 *
 * The chain is walked root-first so a type inheriting from another lets the nearer one win. The saved
 * types come from settings.json and are untrusted: registryWithUserTypes drops a malformed entry, an
 * orphaned parent simply yields a shorter chain, and an entry whose overrides are not an object is
 * skipped rather than spread.
 */
function applyUserTypeOverrides(settings: Record<string, unknown>, view_type: string, user_types: UserViewType[]): void {
    if (!Array.isArray(user_types) || user_types.length === 0) { return; }
    const chain = chainOf(view_type, registryWithUserTypes(user_types));
    for (const node_id of [...chain].reverse()) {
        const minted = user_types.find(candidate => candidate?.id === node_id);
        if (!minted || typeof minted.overrides !== 'object' || minted.overrides === null) { continue; }
        Object.assign(settings, minted.overrides);
    }
}

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
    const cascade = props.settingsCascade ?? DEFAULT_SETTINGS_CASCADE;
    const viewType = view_state?.type || cascade.viewType || 'auto';
    const cascade_settings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cascade)) {
        if (CASCADE_AGGREGATE_FIELDS.includes(key)) { continue; }
        cascade_settings[key] = value;
    }
    applyUserTypeOverrides(cascade_settings, viewType, cascade.viewUserTypes);
    // the cascade spells "natural column order" as an empty array; the kanban view spells it as no columnOrder at all, so a stale saved order never outlives a reset
    if (Array.isArray(cascade_settings.columnOrder) && cascade_settings.columnOrder.length === 0) {
        delete cascade_settings.columnOrder;
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

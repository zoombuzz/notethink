import React from "react";
import * as l10n from "@vscode/l10n";
import type { ReactElement } from "react";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import type { SettingsCascadeKey, UserViewType } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../../../types/IntegrationMode";
import type { StableIdCollision } from "../../../lib/noteops";
import { enumerateGroupByCandidates, resolveGroupByAxisKey, resolveKanbanAxisKey } from "../../../lib/groupbyops";
import { chainOf, registryWithUserTypes } from "../../../lib/viewregistryops";
import type { ActiveDrawer } from "./useToolbarDrawers";
import CollisionsDrawer from "../drawers/CollisionsDrawer";
import FilesDrawer from "../drawers/FilesDrawer";
import JumpDrawer from "../drawers/JumpDrawer";
import SettingsCardDrawer from "../drawers/SettingsCardDrawer";
import SettingsViewDrawer from "../drawers/SettingsViewDrawer";
import ToolbarDrawer from "../drawers/ToolbarDrawer";
import ToolbarTab from "../drawers/ToolbarTab";
import { viewTypeLabel } from "../viewTypeLabel";
import master_view_styles from "../../ViewRenderer.module.scss";

// the + trigger is hidden while it waits to return as a menu item; typed as boolean so the wiring below stays live code rather than a branch TS narrows away
const SHOW_INSERT_BUTTON: boolean = false;

// one frozen empty list, so a cascade with no saved types hands the drawer one stable identity
const EMPTY_USER_TYPES: UserViewType[] = [];

interface GenericViewToolbarProps {
    props: ViewProps;
    handlers: ViewApi;
    displayOptions: NoteDisplayOptions;
    breadcrumbTrail: ReactElement;
    /*
     * integration-mode dropdown, hosted by the Jump to drawer: selection (may be auto), resolved
     * concrete mode, change handler. The change handler also serves the Files drawer's file click,
     * which pins current_file on a chosen file
     */
    integrationSelection: IntegrationMode;
    integrationMode: ConcreteIntegrationMode;
    onIntegrationChange: (mode: IntegrationMode, target_file_path?: string) => void;
    // view type: persisted selection, the type auto resolved to, and the settings tree's handler
    viewTypeSelection: string;
    autoResolvedType: string | undefined;
    onViewTypeChange: (view_type: string) => void;
    // card type: the same three, on the axis deciding how a note is drawn rather than laid out
    cardTypeSelection: string;
    resolvedCardType: string;
    onCardTypeChange: (card_type: string) => void;
    naturalColumnOrder: string[];
    collisions: StableIdCollision[];
    activeDrawer: ActiveDrawer;
    requestedJumpPath: string | undefined;
    onFolderJump: (folder_path: string) => void;
    onFileJump: (file_path: string) => void;
    gearButtonRef: React.RefObject<HTMLButtonElement | null>;
    onCloseDrawer: () => void;
    onSettingsToggle: () => void;
    onCardsToggle: (anchor: HTMLElement) => void;
    onInsertOpen: () => void;
    onSettingChange: (key: SettingsCascadeKey, value: unknown) => void;
    onColumnOrderChange: (next_order: string[]) => void;
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    onRestoreBuiltinDefault: () => void;
    onApplyFilters: (next_include: string, next_exclude: string, next_max_notes_per_file: number) => void;
}

/**
 * Leaf-level view toolbar: the breadcrumb, then the view settings tab and the card settings tab,
 * followed by the drawers themselves. Only those two tabs render here - the other three live inside the
 * breadcrumb, on the state each of them is titled with. No selector is on this row: each axis is chosen
 * from the tree in its own drawer and the integration mode from the Jump to drawer, each reached through
 * its tab, so the row holds no dropdown at all. Each tab is titled by what its axis currently resolves
 * to, so the row states both answers and the drawers hold the controls that change them.
 * Rendered only when the view is a concrete type (the 'auto' view delegates before reaching this).
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export default function GenericViewToolbar(component_props: GenericViewToolbarProps): React.ReactElement {
    const {
        props,
        handlers,
        displayOptions,
        breadcrumbTrail,
        integrationSelection,
        integrationMode,
        viewTypeSelection,
        autoResolvedType,
        cardTypeSelection,
        resolvedCardType,
        onCardTypeChange,
        naturalColumnOrder,
        collisions,
        activeDrawer,
        requestedJumpPath,
        onFolderJump,
        onFileJump,
        gearButtonRef,
        onCloseDrawer,
        onSettingsToggle,
        onCardsToggle,
        onInsertOpen,
        onIntegrationChange,
        onSettingChange,
        onColumnOrderChange,
        onMakeDefault,
        onResetToDefault,
        onRestoreBuiltinDefault,
        onApplyFilters,
        onViewTypeChange,
    } = component_props;
    /*
     * the group-by control's candidates, enumerated once for whichever row the settings pane renders it
     * on. The drawer decides which key that row writes from the node the user has selected in its tree,
     * so nothing here needs to know whether the board is a kanban. Cheap - the enumeration is memoised
     * on the notes identity.
     */
    const user_view_types = displayOptions.settings?.viewUserTypes ?? EMPTY_USER_TYPES;
    // the hierarchy the user's saved types are part of, which both the kanban-chain test and the tab's wording read
    const registry = registryWithUserTypes(user_view_types);
    // a kanban board, or a type minted from one, overrides the axis at the kanban node
    const on_kanban_chain = chainOf(props.type, registry).includes('kanban');
    const group_by_selection = (on_kanban_chain
        ? props.display_options?.settings?.kanbanGroupBy
        : props.display_options?.settings?.groupBy) ?? 'auto';
    const group_by_candidate_keys = enumerateGroupByCandidates(props.notes).filter(c => c.kind === 'categorical').map(c => c.key);
    // the "Auto (...)" label names the axis the board lanes by, and kanban's auto is status
    const group_by_resolved_key = on_kanban_chain
        ? resolveKanbanAxisKey(group_by_selection)
        : resolveGroupByAxisKey(props.notes, props.display_options?.focused_notes, group_by_selection);
    return (
        <>
            <div className={master_view_styles.viewToolbar} data-testid="view-toolbar">
                <div className={master_view_styles.viewToolbarBreadcrumb}>
                    {breadcrumbTrail}
                </div>
                {SHOW_INSERT_BUTTON && (
                    <button
                        type="button"
                        className={master_view_styles.toolbarIconButton}
                        data-testid="view-insert-button"
                        onClick={(e) => { e.stopPropagation(); onInsertOpen(); }}
                        title={l10n.t('Insert')}
                        aria-label={l10n.t('Insert')}
                    >
                        &#43;
                    </button>
                )}
                <ToolbarTab
                    label={viewTypeLabel(viewTypeSelection, autoResolvedType, registry)}
                    testId="view-settings-button"
                    controls={`v${props.id}-settings-drawer`}
                    open={activeDrawer === 'settings'}
                    title={l10n.t('View settings')}
                    buttonRef={gearButtonRef}
                    onToggle={() => onSettingsToggle()}
                />
                <ToolbarTab
                    label={viewTypeLabel(cardTypeSelection, resolvedCardType)}
                    testId="card-settings-button"
                    controls={`v${props.id}-cards-drawer`}
                    open={activeDrawer === 'cards'}
                    title={l10n.t('Card settings')}
                    onToggle={(anchor) => onCardsToggle(anchor)}
                />
            </div>
            <ToolbarDrawer
                open={activeDrawer === 'settings'}
                id={`v${props.id}-settings-drawer`}
                testId="settings-drawer-grid"
                ariaLabel={l10n.t('Settings')}
                onClose={onCloseDrawer}
            >
                <SettingsViewDrawer
                    viewId={props.id}
                    settings={displayOptions.settings ?? {}}
                    diverged={props.settingsCascadeDiverged ?? []}
                    userTypes={user_view_types}
                    currentType={props.type}
                    viewTypeSelection={viewTypeSelection}
                    autoResolvedType={autoResolvedType}
                    onViewTypeChange={onViewTypeChange}
                    onSettingChange={onSettingChange}
                    naturalColumnOrder={naturalColumnOrder}
                    onColumnOrderChange={onColumnOrderChange}
                    groupByResolvedKey={group_by_resolved_key}
                    groupByCandidateKeys={group_by_candidate_keys}
                    onMakeDefault={onMakeDefault}
                    onResetToDefault={onResetToDefault}
                    canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                />
            </ToolbarDrawer>
            <ToolbarDrawer
                open={activeDrawer === 'cards'}
                id={`v${props.id}-cards-drawer`}
                testId="card-settings-drawer-grid"
                ariaLabel={l10n.t('Card settings')}
                onClose={onCloseDrawer}
            >
                <SettingsCardDrawer
                    viewId={props.id}
                    settings={displayOptions.settings ?? {}}
                    diverged={props.settingsCascadeDiverged ?? []}
                    resolvedCardType={resolvedCardType}
                    cardTypeSelection={cardTypeSelection}
                    onCardTypeChange={onCardTypeChange}
                    onSettingChange={onSettingChange}
                />
            </ToolbarDrawer>
            {integrationMode === INTEGRATION_MODE_FOLDER && (
                <ToolbarDrawer
                    open={activeDrawer === 'files'}
                    id={`v${props.id}-files-drawer`}
                    testId="files-drawer-grid"
                    ariaLabel={l10n.t('File settings')}
                    onClose={onCloseDrawer}
                >
                    <FilesDrawer
                        include={props.includeFilter ?? ''}
                        exclude={props.excludeFilter ?? ''}
                        maxNotesPerFile={props.display_options?.maxNotesPerFile ?? 10}
                        fileCount={props.file_count ?? 0}
                        noteCount={props.note_count ?? 0}
                        files={props.aggregate_loaded_files ?? []}
                        onApplyFilters={onApplyFilters}
                        onFileClick={(file_path) => {
                            // a Files-drawer file click switches the viewer into current_file mode showing that file, then dismisses the drawer
                            onIntegrationChange(INTEGRATION_MODE_CURRENT_FILE, file_path);
                            onCloseDrawer();
                        }}
                        workspaceRoot={props.workspace_root}
                        onMakeDefault={onMakeDefault}
                        onResetToDefault={onResetToDefault}
                        canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                        onRestoreBuiltinDefault={onRestoreBuiltinDefault}
                        canRestoreBuiltinDefault={props.settingsCascadeHasAnyOverrides ?? false}
                    />
                </ToolbarDrawer>
            )}
            <ToolbarDrawer
                open={activeDrawer === 'collisions'}
                id={`v${props.id}-collisions-drawer`}
                testId="collisions-drawer-grid"
                ariaLabel={l10n.t('Collisions')}
                onClose={onCloseDrawer}
            >
                <CollisionsDrawer collisions={collisions} onRevealNote={handlers.revealNote} />
            </ToolbarDrawer>
            <ToolbarDrawer
                open={activeDrawer === 'jump'}
                id={`v${props.id}-jump-drawer`}
                testId="jump-drawer-grid"
                ariaLabel={l10n.t('Jump to')}
                onClose={onCloseDrawer}
            >
                <JumpDrawer
                    requestedPath={requestedJumpPath}
                    integrationSelection={integrationSelection}
                    integrationMode={integrationMode}
                    onIntegrationChange={onIntegrationChange}
                    onFolderJump={onFolderJump}
                    onFileJump={onFileJump}
                    onReturn={onCloseDrawer}
                />
            </ToolbarDrawer>
        </>
    );
}

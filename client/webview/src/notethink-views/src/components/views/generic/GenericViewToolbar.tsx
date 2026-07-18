import Debug from "debug";
import React from "react";
import * as l10n from "@vscode/l10n";
import type { ReactElement } from "react";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import type { GlobalSettingKey } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import type { CommonSettingKey } from "../SettingsCommonControls";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../../../types/IntegrationMode";
import type { StableIdCollision } from "../../../lib/noteops";
import { getViewNode, isGroupedViewType, isSettingFixed, resolveSetting, unlockingViewFor } from "../../../lib/viewregistryops";
import { enumerateGroupByCandidates, resolveGroupByAxisKey } from "../../../lib/groupbyops";
import type { GroupBySelectorProps } from "../GroupBySelector";
import type { ActiveDrawer } from "./useToolbarDrawers";
import CollisionsDrawer from "../drawers/CollisionsDrawer";
import FilesDrawer from "../drawers/FilesDrawer";
import JumpDrawer from "../drawers/JumpDrawer";
import SettingsDocumentDrawer from "../drawers/SettingsDocumentDrawer";
import SettingsKanbanDrawer from "../drawers/SettingsKanbanDrawer";
import ToolbarDrawer from "../drawers/ToolbarDrawer";
import ToolbarTab from "../drawers/ToolbarTab";
import { viewTypeLabel } from "../viewTypeLabel";
import master_view_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:GenericViewToolbar");

// the + trigger is hidden while it waits to return as a menu item; typed as boolean so the wiring below stays live code rather than a branch TS narrows away
const SHOW_INSERT_BUTTON: boolean = false;

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
    // view-type dropdown: same shape - selection (may be auto), auto-resolved concrete type, change handler
    viewTypeSelection: string;
    autoResolvedType: string | undefined;
    onViewTypeChange: (view_type: string) => void;
    naturalColumnOrder: string[];
    collisions: StableIdCollision[];
    activeDrawer: ActiveDrawer;
    requestedJumpPath: string | undefined;
    onFolderJump: (folder_path: string) => void;
    onFileJump: (file_path: string) => void;
    gearButtonRef: React.RefObject<HTMLButtonElement | null>;
    onCloseDrawer: () => void;
    onSettingsToggle: () => void;
    onInsertOpen: () => void;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: GlobalSettingKey, value: boolean) => void;
    onColumnOrderChange: (next_order: string[]) => void;
    onGroupByChange: (group_by_key: string) => void;
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    onRestoreBuiltinDefault: () => void;
    onApplyFilters: (next_include: string, next_exclude: string, next_max_notes_per_file: number) => void;
}

/**
 * Leaf-level view toolbar: the breadcrumb, then the View settings tab, followed by the drawers
 * themselves. Only one tab renders here - the other three live inside the breadcrumb, on the state
 * each of them is titled with. Neither selector is on this row: the view-type selector is in the
 * View settings drawer's body and the integration selector in the Jump to drawer's, each reached
 * through its tab, so the row holds no dropdown at all. Rendered only when the view is a concrete
 * type (the 'auto' view delegates before reaching this).
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
        naturalColumnOrder,
        collisions,
        activeDrawer,
        requestedJumpPath,
        onFolderJump,
        onFileJump,
        gearButtonRef,
        onCloseDrawer,
        onSettingsToggle,
        onInsertOpen,
        onIntegrationChange,
        onSettingChange,
        onGlobalSettingChange,
        onColumnOrderChange,
        onMakeDefault,
        onResetToDefault,
        onRestoreBuiltinDefault,
        onApplyFilters,
        onViewTypeChange,
        onGroupByChange,
    } = component_props;
    // registry-driven drawer choice, not a hardcoded type list: grouped views take the lane drawer, other concrete views the document drawer
    const grouped_view = isGroupedViewType(props.type);
    const document_view = getViewNode(props.type)?.kind === 'concrete' && !grouped_view;
    /*
     * the group-by control for the lane drawer: the persisted selection resolves against the enumerated
     * categorical candidates, with the registry lock disabling it for kanban (axes[0] fixed to status,
     * unlocked by selecting Line). Cheap - the enumeration is memoised on the notes identity.
     */
    const group_by_axes = resolveSetting(props.type, 'axes').value as string[] | undefined;
    const group_by_fixed = isSettingFixed(props.type, 'axes');
    const group_by_control: GroupBySelectorProps = {
        selection: props.display_options?.settings?.groupBy ?? 'auto',
        resolvedKey: resolveGroupByAxisKey(props.notes, props.display_options?.focused_notes, props.display_options?.settings?.groupBy),
        candidateKeys: enumerateGroupByCandidates(props.notes).filter(c => c.kind === 'categorical').map(c => c.key),
        fixed: group_by_fixed,
        fixedValue: group_by_fixed ? group_by_axes?.[0] : undefined,
        unlockView: unlockingViewFor(props.type, 'axes'),
        onChange: onGroupByChange,
    };
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
                    label={viewTypeLabel(viewTypeSelection, autoResolvedType)}
                    testId="view-settings-button"
                    controls={`v${props.id}-settings-drawer`}
                    open={activeDrawer === 'settings'}
                    title={l10n.t('View settings')}
                    buttonRef={gearButtonRef}
                    onToggle={() => onSettingsToggle()}
                />
            </div>
            <ToolbarDrawer
                open={activeDrawer === 'settings'}
                id={`v${props.id}-settings-drawer`}
                testId="settings-drawer-grid"
                ariaLabel={l10n.t('Settings')}
                onClose={onCloseDrawer}
            >
                {document_view && (
                    <SettingsDocumentDrawer
                        settings={{
                            showLinetagsInHeadlines: displayOptions.settings?.showLinetagsInHeadlines,
                            scrollNoteIntoView: displayOptions.settings?.scrollNoteIntoView,
                            autoExpandFocusedNote: displayOptions.settings?.autoExpandFocusedNote,
                        }}
                        viewTypeSelection={viewTypeSelection}
                        autoResolvedType={autoResolvedType}
                        onViewTypeChange={onViewTypeChange}
                        showLineNumbers={displayOptions.settings?.showLineNumbers}
                        watchUnopenedFilesInViewer={displayOptions.settings?.watchUnopenedFilesInViewer}
                        openNewEditorIfNoneOpen={displayOptions.settings?.openNewEditorIfNoneOpen}
                        onSettingChange={onSettingChange}
                        onGlobalSettingChange={onGlobalSettingChange}
                        onMakeDefault={onMakeDefault}
                        onResetToDefault={onResetToDefault}
                        canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                        onRestoreBuiltinDefault={onRestoreBuiltinDefault}
                        canRestoreBuiltinDefault={props.settingsCascadeHasAnyOverrides ?? false}
                    />
                )}
                {grouped_view && (
                    <SettingsKanbanDrawer
                        settings={{
                            showLinetagsInHeadlines: displayOptions.settings?.showLinetagsInHeadlines,
                            scrollNoteIntoView: displayOptions.settings?.scrollNoteIntoView,
                            autoExpandFocusedNote: displayOptions.settings?.autoExpandFocusedNote,
                            columnOrder: displayOptions.settings?.columnOrder,
                        }}
                        viewTypeSelection={viewTypeSelection}
                        autoResolvedType={autoResolvedType}
                        onViewTypeChange={onViewTypeChange}
                        groupBy={group_by_control}
                        naturalColumnOrder={naturalColumnOrder}
                        showLineNumbers={displayOptions.settings?.showLineNumbers}
                        watchUnopenedFilesInViewer={displayOptions.settings?.watchUnopenedFilesInViewer}
                        openNewEditorIfNoneOpen={displayOptions.settings?.openNewEditorIfNoneOpen}
                        kanbanAnimateTransitions={displayOptions.settings?.kanbanAnimateTransitions}
                        onSettingChange={onSettingChange}
                        onGlobalSettingChange={onGlobalSettingChange}
                        onColumnOrderChange={onColumnOrderChange}
                        onMakeDefault={onMakeDefault}
                        onResetToDefault={onResetToDefault}
                        canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                        onRestoreBuiltinDefault={onRestoreBuiltinDefault}
                        canRestoreBuiltinDefault={props.settingsCascadeHasAnyOverrides ?? false}
                    />
                )}
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

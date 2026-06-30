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
import CollisionsDrawer from "../drawers/CollisionsDrawer";
import FilesDrawer from "../drawers/FilesDrawer";
import JumpDrawer from "../drawers/JumpDrawer";
import SettingsDocumentDrawer from "../drawers/SettingsDocumentDrawer";
import SettingsKanbanDrawer from "../drawers/SettingsKanbanDrawer";
import ToolbarDrawer from "../drawers/ToolbarDrawer";
import ViewIntegrationSelector from "../ViewIntegrationSelector";
import ViewTypeSelector from "../ViewTypeSelector";
import master_view_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:GenericViewToolbar");

interface GenericViewToolbarProps {
    props: ViewProps;
    handlers: ViewApi;
    displayOptions: NoteDisplayOptions;
    breadcrumbTrail: ReactElement;
    // integration-mode dropdown: selection (may be auto), resolved concrete mode, change handler
    integrationSelection: IntegrationMode;
    integrationMode: ConcreteIntegrationMode;
    onIntegrationChange: (mode: IntegrationMode, target_file_path?: string) => void;
    // view-type dropdown: same shape - selection (may be auto), auto-resolved concrete type, change handler
    viewTypeSelection: string;
    autoResolvedType: string | undefined;
    onViewTypeChange: (view_type: string) => void;
    naturalColumnOrder: string[];
    collisions: StableIdCollision[];
    activeDrawer: 'none' | 'settings' | 'files' | 'collisions' | 'jump';
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
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    onRestoreBuiltinDefault: () => void;
    onApplyFilters: (next_include: string, next_exclude: string, next_max_notes_per_file: number) => void;
}

// shared inline style for the toolbar's icon buttons (insert, settings gear)
const ICON_BUTTON_STYLE: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1.1em',
    padding: '0 0.3em',
    color: 'var(--vscode-foreground, inherit)',
    opacity: 0.6,
    marginLeft: '0.3em',
};

/**
 * Leaf-level view toolbar: integration + view-type selectors, breadcrumb, insert
 * and settings buttons, plus the settings and files drawers. Rendered only when
 * the view is a concrete type (the 'auto' view delegates before reaching this).
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
    } = component_props;
    return (
        <>
            <div className={master_view_styles.viewToolbar} data-testid="view-toolbar">
                <ViewIntegrationSelector
                    currentSelection={integrationSelection}
                    resolvedMode={integrationMode}
                    onChange={onIntegrationChange}
                />
                <div className={master_view_styles.viewToolbarBreadcrumb}>
                    {breadcrumbTrail}
                </div>
                <ViewTypeSelector
                    currentSelection={viewTypeSelection}
                    resolvedType={autoResolvedType}
                    onChange={onViewTypeChange}
                />
                <button
                    data-testid="view-insert-button"
                    onClick={(e) => { e.stopPropagation(); onInsertOpen(); }}
                    style={ICON_BUTTON_STYLE}
                    title={l10n.t('Insert')}
                    aria-label={l10n.t('Insert')}
                >
                    &#43;
                </button>
                <button
                    ref={gearButtonRef}
                    data-testid="view-settings-button"
                    onClick={(e) => { e.stopPropagation(); onSettingsToggle(); }}
                    style={ICON_BUTTON_STYLE}
                    title={l10n.t('Settings')}
                    aria-label={l10n.t('Settings')}
                    aria-expanded={activeDrawer === 'settings'}
                    aria-controls={`v${props.id}-settings-drawer`}
                >
                    &#9881;
                </button>
            </div>
            <ToolbarDrawer
                open={activeDrawer === 'settings'}
                id={`v${props.id}-settings-drawer`}
                testId="settings-drawer-grid"
                ariaLabel={l10n.t('Settings')}
                onClose={onCloseDrawer}
            >
                {props.type === 'document' && (
                    <SettingsDocumentDrawer
                        settings={{
                            showLinetagsInHeadlines: displayOptions.settings?.showLinetagsInHeadlines,
                            scrollNoteIntoView: displayOptions.settings?.scrollNoteIntoView,
                            autoExpandFocusedNote: displayOptions.settings?.autoExpandFocusedNote,
                        }}
                        showLineNumbers={displayOptions.settings?.showLineNumbers}
                        watchUnopenedFilesInViewer={displayOptions.settings?.watchUnopenedFilesInViewer}
                        onSettingChange={onSettingChange}
                        onGlobalSettingChange={onGlobalSettingChange}
                        onMakeDefault={onMakeDefault}
                        onResetToDefault={onResetToDefault}
                        canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                        onRestoreBuiltinDefault={onRestoreBuiltinDefault}
                        canRestoreBuiltinDefault={props.settingsCascadeHasAnyOverrides ?? false}
                    />
                )}
                {props.type === 'kanban' && (
                    <SettingsKanbanDrawer
                        settings={{
                            showLinetagsInHeadlines: displayOptions.settings?.showLinetagsInHeadlines,
                            scrollNoteIntoView: displayOptions.settings?.scrollNoteIntoView,
                            autoExpandFocusedNote: displayOptions.settings?.autoExpandFocusedNote,
                            columnOrder: displayOptions.settings?.columnOrder,
                        }}
                        naturalColumnOrder={naturalColumnOrder}
                        showLineNumbers={displayOptions.settings?.showLineNumbers}
                        watchUnopenedFilesInViewer={displayOptions.settings?.watchUnopenedFilesInViewer}
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
                <JumpDrawer requestedPath={requestedJumpPath} onFolderJump={onFolderJump} onFileJump={onFileJump} onReturn={onCloseDrawer} />
            </ToolbarDrawer>
        </>
    );
}

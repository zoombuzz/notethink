import Debug from "debug";
import React from "react";
import * as l10n from "@vscode/l10n";
import type { ReactElement } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import type { GlobalSettingKey } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import type { CommonSettingKey } from "../SettingsCommonControls";
import { INTEGRATION_MODE_FOLDER, type IntegrationMode } from "../../../types/IntegrationMode";
import FilesDrawer from "../FilesDrawer";
import SettingsDocumentDrawer from "../SettingsDocumentDrawer";
import SettingsKanbanDrawer from "../SettingsKanbanDrawer";
import Spinner from "../../Spinner";
import ToolbarDrawer from "../ToolbarDrawer";
import ViewIntegrationSelector from "../ViewIntegrationSelector";
import ViewTypeSelector from "../ViewTypeSelector";
import master_view_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:GenericViewToolbar");

interface GenericViewToolbarProps {
    props: ViewProps;
    handlers: ViewApi;
    displayOptions: NoteDisplayOptions;
    breadcrumbTrail: ReactElement;
    autoResolvedType: string | undefined;
    integrationMode: IntegrationMode;
    naturalColumnOrder: string[];
    activeDrawer: 'none' | 'settings' | 'files';
    gearButtonRef: React.RefObject<HTMLButtonElement | null>;
    onSettingsToggle: () => void;
    onInsertOpen: () => void;
    onIntegrationChange: (mode: IntegrationMode) => void;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: GlobalSettingKey, value: boolean) => void;
    onColumnOrderChange: (next_order: string[]) => void;
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    onApplyFilters: (next_include: string, next_exclude: string, next_max_notes_per_file: number) => void;
    onCascadeWrite: (setting: string, value: unknown) => void;
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
        autoResolvedType,
        integrationMode,
        naturalColumnOrder,
        activeDrawer,
        gearButtonRef,
        onSettingsToggle,
        onInsertOpen,
        onIntegrationChange,
        onSettingChange,
        onGlobalSettingChange,
        onColumnOrderChange,
        onMakeDefault,
        onResetToDefault,
        onApplyFilters,
        onCascadeWrite,
    } = component_props;
    const { pending } = usePendingWorkContext();
    return (
        <>
            <div className={master_view_styles.viewToolbar} data-testid="view-toolbar">
                <ViewIntegrationSelector
                    currentMode={integrationMode}
                    onChange={onIntegrationChange}
                />
                <div className={master_view_styles.viewToolbarBreadcrumb}>
                    {breadcrumbTrail}
                </div>
                {pending && <Spinner positionClass="InlineLoader" ariaLabel={l10n.t('Working')} />}
                <ViewTypeSelector
                    currentType={(props.nested?.replaced_attributes?.type as string) || props.type}
                    autoResolvedType={autoResolvedType}
                    handlers={handlers}
                    id={props.id}
                    // viewType is a view-type setting (not integration-specific): cascade-write in any integration mode so picking Kanban here also persists for folder mode and vice versa
                    onCascadeWrite={(viewType) => onCascadeWrite('viewType', viewType)}
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
                        onSettingChange={onSettingChange}
                        onGlobalSettingChange={onGlobalSettingChange}
                        onColumnOrderChange={onColumnOrderChange}
                        onMakeDefault={onMakeDefault}
                        onResetToDefault={onResetToDefault}
                        canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                    />
                )}
            </ToolbarDrawer>
            {integrationMode === INTEGRATION_MODE_FOLDER && (
                <ToolbarDrawer
                    open={activeDrawer === 'files'}
                    id={`v${props.id}-files-drawer`}
                    testId="files-drawer-grid"
                    ariaLabel={l10n.t('File settings')}
                >
                    <FilesDrawer
                        include={props.includeFilter ?? ''}
                        exclude={props.excludeFilter ?? ''}
                        maxNotesPerFile={props.display_options?.maxNotesPerFile ?? 10}
                        fileCount={props.file_count ?? 0}
                        noteCount={props.note_count ?? 0}
                        files={props.aggregate_loaded_files ?? []}
                        onApplyFilters={onApplyFilters}
                        onMakeDefault={onMakeDefault}
                        onResetToDefault={onResetToDefault}
                        canResetToDefault={props.settingsCascadeHasWorkspaceOverrides ?? false}
                    />
                </ToolbarDrawer>
            )}
        </>
    );
}

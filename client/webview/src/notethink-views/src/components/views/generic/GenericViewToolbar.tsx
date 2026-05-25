import Debug from "debug";
import React from "react";
import * as l10n from "@vscode/l10n";
import type { ReactElement } from "react";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import type { GlobalSettingKey } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import type { CommonSettingKey } from "../SettingsCommonControls";
import type { IntegrationMode } from "../ViewIntegrationSelector";
import FilesDrawer from "../FilesDrawer";
import SettingsDocumentDrawer from "../SettingsDocumentDrawer";
import SettingsKanbanDrawer from "../SettingsKanbanDrawer";
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
    onFolderCascadeWrite: (setting: string, value: unknown) => void;
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
        onFolderCascadeWrite,
    } = component_props;
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
                <ViewTypeSelector
                    currentType={(props.nested?.replaced_attributes?.type as string) || props.type}
                    autoResolvedType={autoResolvedType}
                    handlers={handlers}
                    id={props.id}
                    onFolderCascadeWrite={integrationMode === 'folder'
                        ? (view_type) => onFolderCascadeWrite('view_type', view_type)
                        : undefined}
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
                            show_linetags_in_headlines: displayOptions.settings?.show_linetags_in_headlines,
                            scroll_note_into_view: displayOptions.settings?.scroll_note_into_view,
                            auto_expand_focused_note: displayOptions.settings?.auto_expand_focused_note,
                        }}
                        showLineNumbers={displayOptions.settings?.show_line_numbers}
                        watchUnopenedFilesInViewer={displayOptions.settings?.watch_unopened_files_in_viewer}
                        onSettingChange={onSettingChange}
                        onGlobalSettingChange={onGlobalSettingChange}
                        onMakeDefault={integrationMode === 'folder' ? onMakeDefault : undefined}
                        onResetToDefault={integrationMode === 'folder' ? onResetToDefault : undefined}
                        canResetToDefault={props.folder_view_cascade_has_workspace_overrides ?? false}
                    />
                )}
                {props.type === 'kanban' && (
                    <SettingsKanbanDrawer
                        settings={{
                            show_linetags_in_headlines: displayOptions.settings?.show_linetags_in_headlines,
                            scroll_note_into_view: displayOptions.settings?.scroll_note_into_view,
                            auto_expand_focused_note: displayOptions.settings?.auto_expand_focused_note,
                            column_order: displayOptions.settings?.column_order,
                        }}
                        naturalColumnOrder={naturalColumnOrder}
                        showLineNumbers={displayOptions.settings?.show_line_numbers}
                        watchUnopenedFilesInViewer={displayOptions.settings?.watch_unopened_files_in_viewer}
                        onSettingChange={onSettingChange}
                        onGlobalSettingChange={onGlobalSettingChange}
                        onColumnOrderChange={onColumnOrderChange}
                        onMakeDefault={integrationMode === 'folder' ? onMakeDefault : undefined}
                        onResetToDefault={integrationMode === 'folder' ? onResetToDefault : undefined}
                        canResetToDefault={props.folder_view_cascade_has_workspace_overrides ?? false}
                    />
                )}
            </ToolbarDrawer>
            {integrationMode === 'folder' && (
                <ToolbarDrawer
                    open={activeDrawer === 'files'}
                    id={`v${props.id}-files-drawer`}
                    testId="files-drawer-grid"
                    ariaLabel={l10n.t('Files')}
                >
                    <FilesDrawer
                        include={props.include_filter ?? ''}
                        exclude={props.exclude_filter ?? ''}
                        maxNotesPerFile={props.display_options?.max_notes_per_file ?? 10}
                        fileCount={props.file_count ?? 0}
                        noteCount={props.note_count ?? 0}
                        files={props.aggregate_loaded_files ?? []}
                        onApplyFilters={onApplyFilters}
                    />
                </ToolbarDrawer>
            )}
        </>
    );
}

import Debug from "debug";
import { useCallback, useMemo } from "react";
import { FOLDER_VIEW_STATE_ID } from "../../../lib/mergeAggregateRoot";
import { arraysEqual, deriveNaturalColumnOrder } from "../../../lib/columnorder";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { GlobalSettingKey } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import type { CommonSettingKey } from "../SettingsCommonControls";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type IntegrationMode } from "../../../types/IntegrationMode";

const debug = Debug("nodejs:notethink-views:useViewToolbar");

export interface ViewToolbar {
    integration_mode: IntegrationMode;
    natural_column_order: string[];
    handle_integration_change: (mode: IntegrationMode) => void;
    handle_setting_change: (key: CommonSettingKey, value: boolean) => void;
    handle_global_setting_change: (key: GlobalSettingKey, value: boolean) => void;
    handle_column_order_change: (next_order: string[]) => void;
    handle_make_default: () => void;
    handle_reset_to_default: () => void;
    cascade_write_setting: (setting: string, value: unknown) => void;
}

/**
 * Owns the toolbar's integration mode, the Kanban natural column order, and the
 * settings/column-order/cascade dispatchers. Per-view setting changes dispatch
 * setViewManagedState immediately; global keys are stripped from per-view state
 * (the extension owns them via VS Code config) and cascading folder-mode writes
 * round-trip to config via updateSetting.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useViewToolbar(
    props: ViewProps,
    handlers: ViewApi,
    display_options: NoteDisplayOptions,
    notes_within_parent_context: Array<NoteProps>,
): ViewToolbar {
    // integration mode (current_file vs folder)
    const integration_mode: IntegrationMode = (props.display_options?.integration_mode as IntegrationMode) || INTEGRATION_MODE_CURRENT_FILE;

    const handle_integration_change = useCallback((mode: IntegrationMode): void => {
        const folder_path = mode === INTEGRATION_MODE_FOLDER && props.doc_path
            ? props.doc_path.replace(/\/[^/]+$/, '')
            : undefined;
        // dispatch the integration_mode tag to the canonical folder key (not props.id) so the folder viewState's other settings (columnOrder, filters, etc.) survive a flip to current_file and back
        const updates: Array<Record<string, unknown>> = [{
            id: FOLDER_VIEW_STATE_ID,
            display_options: {
                integration_mode: mode,
                integration_path: folder_path,
            },
        }];
        // on flip to current_file also clear any stranded `integration_mode='folder'` tags on non-canonical keys (legacy pre-fix dispatch wrote the tag onto doc-path keys); without this the fallback scans in anyViewInFolderMode/firstIntegrationPath still resolve to folder mode and the composer + toolbar selector stay stuck on folder
        if (mode === INTEGRATION_MODE_CURRENT_FILE) {
            for (const id of (props.view_state_ids ?? [])) {
                if (id === FOLDER_VIEW_STATE_ID) { continue; }
                updates.push({
                    id,
                    display_options: {
                        integration_mode: undefined,
                        integration_path: undefined,
                    },
                });
            }
        }
        handlers.setViewManagedState(updates);
        if (mode === INTEGRATION_MODE_FOLDER && folder_path) {
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: INTEGRATION_MODE_FOLDER,
                path: folder_path,
            });
        } else if (mode === INTEGRATION_MODE_CURRENT_FILE) {
            // notify the extension so it disposes the folder watcher and re-sends just the active doc; without this the stale folder docs keep rendering as stacked single-file views
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: INTEGRATION_MODE_CURRENT_FILE,
            });
        }
    }, [handlers, props.doc_path, props.view_state_ids]);

    // natural column order for the Kanban drawer (alphabetical + 'untagged' last)
    const natural_column_order = useMemo<string[]>(() => {
        if (props.type !== 'kanban') { return []; }
        return deriveNaturalColumnOrder(notes_within_parent_context);
    }, [props.type, notes_within_parent_context]);

    // cascade write to VS Code config (Workspace scope on the extension side) under notethink.settings.*. View-type members (columnOrder, viewType, showLinetagsInHeadlines, scrollNoteIntoView, autoExpandFocusedNote, showContextBars) cascade-write in any integration mode so a setting changed in current_file mode is visible in folder mode and vice versa
    const cascade_write_setting = useCallback((setting: string, value: unknown): void => {
        handlers.postMessage?.({
            type: 'updateSetting',
            setting,
            value,
        });
    }, [handlers]);

    const handle_make_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'promoteSettingsToUser' });
    }, [handlers]);

    const handle_reset_to_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'resetSettingsToDefault' });
    }, [handlers]);

    // real-time apply: per-view setting change dispatches setViewManagedState immediately. Global keys are stripped so they don't get baked into per-view state — the extension owns them via vscode workspace config
    const handle_setting_change = useCallback((key: CommonSettingKey, value: boolean): void => {
        const { showLineNumbers: _sln, watchUnopenedFilesInViewer: _wu, ...per_view_settings } = display_options.settings || {};
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                settings: {
                    ...per_view_settings,
                    [key]: value,
                },
            },
        }]);
    }, [handlers, props.id, display_options.settings]);

    // real-time apply: global setting goes via postMessage; the extension writes it to vscode workspace/user config and echoes back via globalSettings
    const handle_global_setting_change = useCallback((key: GlobalSettingKey, value: boolean): void => {
        handlers.postMessage?.({ type: 'updateGlobalSetting', setting: key, value });
    }, [handlers]);

    // real-time apply: Kanban column order change. Normalise: if next_order matches the natural order, persist undefined locally; cascade always carries an explicit array (empty == natural)
    const handle_column_order_change = useCallback((next_order: string[]): void => {
        const { showLineNumbers: _sln, watchUnopenedFilesInViewer: _wu, ...per_view_settings } = display_options.settings || {};
        const matches_natural = arraysEqual(next_order, natural_column_order);
        const persisted_order = matches_natural ? undefined : next_order;
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                settings: {
                    ...per_view_settings,
                    columnOrder: persisted_order,
                },
            },
        }]);
        // cascade payload uses [] (not undefined) for "natural order" to match the package.json default's shape
        cascade_write_setting('columnOrder', matches_natural ? [] : next_order);
    }, [handlers, props.id, display_options.settings, natural_column_order, cascade_write_setting]);

    return {
        integration_mode,
        natural_column_order,
        handle_integration_change,
        handle_setting_change,
        handle_global_setting_change,
        handle_column_order_change,
        handle_make_default,
        handle_reset_to_default,
        cascade_write_setting,
    };
}

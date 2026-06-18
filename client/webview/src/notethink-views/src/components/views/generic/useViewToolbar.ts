import Debug from "debug";
import { useCallback, useMemo } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import { FOLDER_VIEW_STATE_ID, resolveIntegrationMode } from "../../../lib/viewstateops";
import { arraysEqual, deriveNaturalColumnOrder } from "../../../lib/noteops";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { GlobalSettingKey } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import type { CommonSettingKey } from "../SettingsCommonControls";
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../../../types/IntegrationMode";

const debug = Debug("nodejs:notethink-views:useViewToolbar");

export interface ViewToolbar {
    // integration-mode dropdown: persisted selection (may be auto), resolved concrete mode, change handler
    integration_selection: IntegrationMode;
    integration_mode: ConcreteIntegrationMode;
    handle_integration_change: (mode: IntegrationMode, target_file_path?: string) => void;
    // view-type dropdown: same shape — persisted selection (may be auto), auto-resolved concrete type, change handler
    view_type_selection: string;
    auto_resolved_type: string | undefined;
    handle_view_type_change: (view_type: string) => void;
    natural_column_order: string[];
    handle_setting_change: (key: CommonSettingKey, value: boolean) => void;
    handle_global_setting_change: (key: GlobalSettingKey, value: boolean) => void;
    handle_column_order_change: (next_order: string[]) => void;
    handle_make_default: () => void;
    handle_reset_to_default: () => void;
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
    const { markPending } = usePendingWorkContext();
    // integration-mode dropdown state — selection (persisted, may be auto) + resolved concrete mode, mirroring the view-type dropdown below
    const integration_selection: IntegrationMode = (props.display_options?.integration_mode_selection as IntegrationMode) || INTEGRATION_MODE_AUTO;
    const integration_mode: ConcreteIntegrationMode = resolveIntegrationMode(props.display_options);
    // view-type dropdown state — selection (persisted, may be auto) + the type AutoView resolved auto to; same selection/resolved split as integration mode
    const view_type_selection: string = (props.nested?.replaced_attributes?.type as string) || props.type;
    const auto_resolved_type: string | undefined = props.nested?.auto_resolved_type;

    /*
     * handle_integration_change — change the view's integration selection.
     *  - 'auto' (explicit re-select) is a full reset: re-resolve mode + scope from the opened file's
     *    declaration so the view follows the file again, exactly like picking "Auto" for view type.
     *  - 'folder' / 'current_file' pin the user's explicit choice, overriding the file declaration.
     * The integration tag is always dispatched to the canonical FOLDER_VIEW_STATE_ID (not props.id) so
     * the folder viewState's other settings (columnOrder, filters, etc.) survive a flip and a flip-back.
     * Per-view click-driven focused/selected state is transient and cleared on every change. On a
     * resolve-to-current_file the per-state-id loop additionally clears stranded folder tags on
     * doc-path keys (legacy pre-fix dispatch wrote them there) so the fallback scans no longer pin folder.
     */
    const handle_integration_change = useCallback((mode: IntegrationMode, target_file_path?: string): void => {
        // the auto reset re-resolves from the file; a concrete pin uses the file's own folder (folder pin) or none
        const decl = props.file_declared_integration;
        const is_auto_reset = mode === INTEGRATION_MODE_AUTO;
        const resolved_mode: ConcreteIntegrationMode = is_auto_reset
            ? (decl?.mode ?? INTEGRATION_MODE_CURRENT_FILE)
            : (mode as ConcreteIntegrationMode);
        const folder_path = resolved_mode === INTEGRATION_MODE_FOLDER
            ? (is_auto_reset ? decl?.integration_path : (props.doc_path ? props.doc_path.replace(/\/[^/]+$/, '') : undefined))
            : undefined;
        const clear_stranded_folder_tag = resolved_mode === INTEGRATION_MODE_CURRENT_FILE;
        const canonical_display_options: Record<string, unknown> = {
            // persist 'auto' on reset (the view keeps following the file) and the concrete mode on a pin
            integration_mode: is_auto_reset ? INTEGRATION_MODE_AUTO : resolved_mode,
            integration_path: folder_path,
            view_focused_ids: undefined,
            view_selected_ids: undefined,
        };
        const updates: Array<Record<string, unknown>> = [{ id: FOLDER_VIEW_STATE_ID, display_options: canonical_display_options }];
        for (const id of (props.view_state_ids ?? [])) {
            if (id === FOLDER_VIEW_STATE_ID) { continue; }
            const non_canonical_display_options: Record<string, unknown> = {
                view_focused_ids: undefined,
                view_selected_ids: undefined,
            };
            if (clear_stranded_folder_tag) {
                non_canonical_display_options.integration_mode = undefined;
                non_canonical_display_options.integration_path = undefined;
            }
            updates.push({ id, display_options: non_canonical_display_options });
        }
        // auto reset to a current_file file that declares an epic/story scope: re-seed parent_context_seq on the doc view
        if (is_auto_reset && resolved_mode === INTEGRATION_MODE_CURRENT_FILE && decl?.parent_context_seq !== undefined && props.id !== FOLDER_VIEW_STATE_ID) {
            updates.push({ id: props.id, display_options: { parent_context_seq: decl.parent_context_seq } });
        }
        handlers.setViewManagedState(updates);
        if (resolved_mode === INTEGRATION_MODE_FOLDER && folder_path) {
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: INTEGRATION_MODE_FOLDER,
                path: folder_path,
            });
        } else if (resolved_mode === INTEGRATION_MODE_CURRENT_FILE) {
            // notify the extension so it disposes the folder watcher and re-sends just the active doc; without this the stale folder docs keep rendering as stacked single-file views. target_file_path (a Files-drawer click) makes the extension open + show that file instead of whatever was active
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: INTEGRATION_MODE_CURRENT_FILE,
                path: target_file_path,
            });
        }
    }, [handlers, props.doc_path, props.view_state_ids, props.id, props.file_declared_integration]);

    // natural column order for the Kanban drawer (alphabetical + 'untagged' last)
    const natural_column_order = useMemo<string[]>(() => {
        if (props.type !== 'kanban') { return []; }
        return deriveNaturalColumnOrder(notes_within_parent_context);
    }, [props.type, notes_within_parent_context]);

    /*
     * cascade_write_setting — write a view-type setting to VS Code config (Workspace
     * scope on the extension side) under notethink.settings.*. View-type members
     * (columnOrder, viewType, showLinetagsInHeadlines, scrollNoteIntoView,
     * autoExpandFocusedNote, showContextBars) cascade-write in any integration mode so a
     * setting changed in current_file mode is visible in folder mode and vice versa. Marks
     * the per-setting key + the 'settingsCascade' sentinel so the spinner appears if the
     * round-trip is non-instantaneous; the echo reducer clears both keys on arrival.
     */
    const cascade_write_setting = useCallback((setting: string, value: unknown): void => {
        markPending(setting);
        markPending('settingsCascade');
        handlers.postMessage?.({
            type: 'updateSetting',
            setting,
            value,
        });
    }, [handlers, markPending]);

    /*
     * handle_view_type_change — change the view type (auto / document / kanban). Mirrors
     * handle_integration_change: dispatch the selection to this view's id, then cascade-write
     * 'viewType' so the choice persists across integration modes (viewType is a view-type setting,
     * not integration-specific — a type picked in current_file mode also applies in folder mode).
     */
    const handle_view_type_change = useCallback((view_type: string): void => {
        handlers.setViewManagedState([{ id: props.id, type: view_type }]);
        cascade_write_setting('viewType', view_type);
    }, [handlers, props.id, cascade_write_setting]);

    const handle_make_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'promoteSettingsToUser' });
    }, [handlers]);

    const handle_reset_to_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'resetSettingsToDefault' });
    }, [handlers]);

    /*
     * handle_setting_change — real-time apply for a per-view (display_options-owned)
     * setting. Dispatches setViewManagedState immediately. Global keys are stripped from
     * the persisted shape so they don't get baked into per-view state — the extension
     * owns them via vscode workspace config.
     */
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

    /*
     * handle_global_setting_change — real-time apply for a global (vscode-owned) setting.
     * The extension writes it to vscode workspace/user config and echoes back via
     * globalSettings. Marks the setting key as pending; the echo reducer clears it when
     * globalSettings arrives.
     */
    const handle_global_setting_change = useCallback((key: GlobalSettingKey, value: boolean): void => {
        markPending(key);
        handlers.postMessage?.({ type: 'updateGlobalSetting', setting: key, value });
    }, [handlers, markPending]);

    /*
     * handle_column_order_change — real-time apply for the Kanban column order. Normalises
     * the persisted shape: if next_order matches the natural order, store undefined
     * locally (so future natural-order changes propagate); the cascade payload always
     * carries an explicit array, with empty == natural.
     */
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
        integration_selection,
        integration_mode,
        handle_integration_change,
        view_type_selection,
        auto_resolved_type,
        handle_view_type_change,
        natural_column_order,
        handle_setting_change,
        handle_global_setting_change,
        handle_column_order_change,
        handle_make_default,
        handle_reset_to_default,
    };
}

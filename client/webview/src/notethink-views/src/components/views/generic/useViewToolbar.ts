import { useCallback, useMemo } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import { buildIntegrationDispatch, resolveIntegrationMode } from "../../../lib/viewstateops";
import { arraysEqual, deriveNaturalColumnOrder, isAggregateRoot, majorityCardType } from "../../../lib/noteops";
import { isGroupedViewType, registryWithUserTypes } from "../../../lib/viewregistryops";
import { CARD_AUTO, cardRegistryWithViewSettings, resolveCardType } from "../../notes/cardregistryops";
import { parentFolderOf } from "../../../lib/pathops";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { GroupDisplayEntry, SettingsCascadeKey, UserViewType } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../../../types/IntegrationMode";

// one frozen empty list, so a cascade with no saved types keeps its identity and the memo holds
const EMPTY_USER_TYPES: UserViewType[] = [];

/**
 * What the toolbar and its drawers are driven by.
 * - handle_setting_change: the one write path every drawer control dispatches down, whatever node owns
 *   the setting it changed
 * - the integration/view-type/card-type groups each pair a persisted selection with its resolved value
 */
export interface ViewToolbar {
    // --- integration mode ---
    integration_selection: IntegrationMode;
    integration_mode: ConcreteIntegrationMode;
    handle_integration_change: (mode: IntegrationMode, target_file_path?: string) => void;
    // --- view type ---
    view_type_selection: string;
    auto_resolved_type: string | undefined;
    handle_view_type_change: (view_type: string) => void;
    // --- card type ---
    card_type_selection: string;
    resolved_card_type: string;
    handle_card_type_change: (card_type: string) => void;
    natural_column_order: string[];
    handle_setting_change: (key: SettingsCascadeKey, value: unknown) => void;
    handle_group_display_change: (next_display: GroupDisplayEntry[]) => void;
    handle_make_default: () => void;
    handle_reset_to_default: () => void;
    handle_restore_builtin_default: () => void;
}

type DefaultActions = Pick<ViewToolbar, 'handle_make_default' | 'handle_reset_to_default' | 'handle_restore_builtin_default'>;

/**
 * The three default actions, each a bare message the extension acts on with no payload to build here.
 * Grouped because they move together - all three are whole-cascade operations rather than per-setting
 * ones, and none of them needs anything from the view.
 */
function useDefaultActions(handlers: ViewApi): DefaultActions {
    const handle_make_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'promoteSettingsToUser' });
    }, [handlers]);
    const handle_reset_to_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'resetSettingsToDefault' });
    }, [handlers]);
    const handle_restore_builtin_default = useCallback((): void => {
        handlers.postMessage?.({ type: 'restoreSettingsToBuiltinDefault' });
    }, [handlers]);
    return { handle_make_default, handle_reset_to_default, handle_restore_builtin_default };
}

/**
 * The card tab's persisted selection and the concrete card it resolves to, the same selection / resolved
 * split the view type uses. AutoView publishes the user's own choice on replaced_attributes because it
 * has already stamped the RESOLVED card onto settings.cardType for the whole subtree; with no AutoView
 * in the chain that stamp never happens and the cascade value is the raw selection, so the fallback
 * reads it straight.
 *
 * The vote is repeated here rather than only in AutoView because AutoView is not always mounted: it
 * renders for `auto` alone, so pinning any view type unmounted the only thing that ran it, and every
 * sticky on a folder that had voted for one expanded into the view's default card. The two axes are
 * meant to be independent, so the card answer cannot be a side effect of the view answer being `auto`.
 */
function readCardTypeState(props: ViewProps, display_options: NoteDisplayOptions, user_types: UserViewType[]): { selection: string; resolved: string } {
    const selection = (props.nested?.replaced_attributes?.card_type as string) || display_options.settings?.cardType || CARD_AUTO;
    if (props.nested?.auto_resolved_card_type !== undefined) {
        return { selection, resolved: props.nested.auto_resolved_card_type };
    }
    const voted = selection === CARD_AUTO && isAggregateRoot(props.nested?.parent_context)
        ? majorityCardType(props.notes)
        : undefined;
    return { selection, resolved: resolveCardType(voted ?? selection, props.type, user_types, cardRegistryWithViewSettings(display_options.settings)) };
}

/**
 * Owns the toolbar's integration mode, the Kanban natural column order, and the settings dispatchers.
 *
 * Every control the drawer renders writes the same way: one updateSetting message per change, which
 * the extension applies to VS Code configuration and echoes back as a fresh settingsCascade. There is
 * no second channel for a subset of keys and no per-view settings copy, so what the user sees after a
 * change is what configuration actually resolved.
 */
export function useViewToolbar(
    props: ViewProps,
    handlers: ViewApi,
    display_options: NoteDisplayOptions,
    notes_within_parent_context: Array<NoteProps>,
): ViewToolbar {
    const { markPending } = usePendingWorkContext();
    // integration-mode state - persisted selection plus resolved mode, mirroring the view-type tree
    const integration_selection: IntegrationMode = (props.display_options?.integration_mode_selection as IntegrationMode) || INTEGRATION_MODE_AUTO;
    const integration_mode: ConcreteIntegrationMode = resolveIntegrationMode(props.display_options);
    // view-type tree state - persisted selection plus the type AutoView resolved auto to
    const view_type_selection: string = (props.nested?.replaced_attributes?.type as string) || props.type;
    const auto_resolved_type: string | undefined = props.nested?.auto_resolved_type;
    // the user's minted view types, read from the cascade so a saved kanban type is still a lane view
    const user_view_types = display_options.settings?.viewUserTypes ?? EMPTY_USER_TYPES;
    const { selection: card_type_selection, resolved: resolved_card_type } = readCardTypeState(props, display_options, user_view_types);
    // dispatches to the canonical FOLDER_VIEW_STATE_ID so folder settings survive an integration flip and flip-back
    const handle_integration_change = useCallback((mode: IntegrationMode, target_file_path?: string): void => {
        // the auto reset re-resolves from the file; a concrete pin uses the file's own folder (folder pin) or none
        const decl = props.file_declared_integration;
        const is_auto_reset = mode === INTEGRATION_MODE_AUTO;
        const resolved_mode: ConcreteIntegrationMode = is_auto_reset
            ? (decl?.mode ?? INTEGRATION_MODE_CURRENT_FILE)
            : (mode as ConcreteIntegrationMode);
        const folder_path = resolved_mode === INTEGRATION_MODE_FOLDER
            ? (is_auto_reset ? decl?.integration_path : parentFolderOf(props.doc_path))
            : undefined;
        // shared builder so the reactive editor-follow reconcile (useAutoIntegration) and this toolbar path can't drift
        const { updates, message } = buildIntegrationDispatch({
            is_auto: is_auto_reset,
            resolved_mode,
            folder_path,
            seed_parent_context_id: is_auto_reset && resolved_mode === INTEGRATION_MODE_CURRENT_FILE ? decl?.parent_context_label : undefined,
            view_id: props.id,
            view_state_ids: props.view_state_ids ?? [],
            target_file_path,
        });
        handlers.setViewManagedState(updates);
        // folder scope or a resolve-to-current_file posts setIntegration; target_file_path (a Files click) opens that file
        if (message) { handlers.postMessage?.(message); }
    }, [handlers, props.doc_path, props.view_state_ids, props.id, props.file_declared_integration]);
    // derived for any lane view, not kanban alone: the drawer renders from the tree node the user selected
    const natural_column_order = useMemo<string[]>(() => {
        if (!isGroupedViewType(props.type, registryWithUserTypes(user_view_types))) { return []; }
        return deriveNaturalColumnOrder(notes_within_parent_context);
    }, [props.type, notes_within_parent_context, user_view_types]);
    // writes one setting in every integration mode; marks it plus the settingsCascade sentinel for the spinner
    const cascade_write_setting = useCallback((setting: SettingsCascadeKey, value: unknown): void => {
        markPending(setting);
        markPending('settingsCascade');
        handlers.postMessage?.({
            type: 'updateSetting',
            setting,
            value,
        });
    }, [handlers, markPending]);
    // viewType is not integration-specific, so a type picked in current_file mode also applies in folder mode
    const handle_view_type_change = useCallback((view_type: string): void => {
        handlers.setViewManagedState([{ id: props.id, type: view_type }]);
        cascade_write_setting('viewType', view_type);
    }, [handlers, props.id, cascade_write_setting]);
    // one cascade write; the card reaches every note via display_options rebuilt from the cascade
    const handle_card_type_change = useCallback((card_type: string): void => {
        cascade_write_setting('cardType', card_type);
    }, [cascade_write_setting]);
    const default_actions = useDefaultActions(handlers);
    // natural order with every lane shown writes the empty-array unpin sentinel, so returning to it stops pinning anything
    const handle_group_display_change = useCallback((next_display: GroupDisplayEntry[]): void => {
        const matches_natural = arraysEqual(next_display.map(entry => entry.value), natural_column_order) && next_display.every(entry => entry.shown !== false);
        cascade_write_setting('groupDisplay', matches_natural ? [] : next_display);
    }, [natural_column_order, cascade_write_setting]);
    return {
        integration_selection,
        integration_mode,
        handle_integration_change,
        view_type_selection,
        auto_resolved_type,
        handle_view_type_change,
        card_type_selection,
        resolved_card_type,
        handle_card_type_change,
        natural_column_order,
        handle_setting_change: cascade_write_setting,
        handle_group_display_change,
        ...default_actions,
    };
}

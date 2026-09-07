import { useCallback, useMemo } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import { buildIntegrationDispatch, resolveIntegrationMode } from "../../../lib/viewstateops";
import { arraysEqual, deriveNaturalColumnOrder, isAggregateRoot, majorityCardType } from "../../../lib/noteops";
import { isGroupedViewType, registryWithUserTypes } from "../../../lib/viewregistryops";
import { CARD_AUTO, resolveCardType } from "../../notes/cardregistryops";
import { parentFolderOf } from "../../../lib/pathops";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { SettingsCascadeKey, UserViewType } from "../../../types/Messages";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../../../types/IntegrationMode";

// one frozen empty list, so a cascade with no saved types keeps its identity and the memo holds
const EMPTY_USER_TYPES: UserViewType[] = [];

/**
 * What the toolbar and its drawers are driven by.
 * - handle_setting_change: the one write path every drawer control dispatches down, whatever node owns
 *   the setting it changed
 */
export interface ViewToolbar {
    // integration-mode dropdown: persisted selection (may be auto), resolved concrete mode, change handler
    integration_selection: IntegrationMode;
    integration_mode: ConcreteIntegrationMode;
    handle_integration_change: (mode: IntegrationMode, target_file_path?: string) => void;
    // view-type tree: same shape - persisted selection, auto-resolved concrete type, change handler
    view_type_selection: string;
    auto_resolved_type: string | undefined;
    handle_view_type_change: (view_type: string) => void;
    // card-type tab: the same selection / resolved split, on the axis deciding how a note is drawn
    card_type_selection: string;
    resolved_card_type: string;
    handle_card_type_change: (card_type: string) => void;
    natural_column_order: string[];
    handle_setting_change: (key: SettingsCascadeKey, value: unknown) => void;
    handle_column_order_change: (next_order: string[]) => void;
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
    return { selection, resolved: resolveCardType(voted ?? selection, props.type, user_types) };
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

    /*
     * handle_integration_change - change the view's integration selection.
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
        // a folder scope or any resolve-to-current_file posts setIntegration so the extension swaps folder discovery / re-sends just the active doc; target_file_path (a Files-drawer click) makes it open that file
        if (message) { handlers.postMessage?.(message); }
    }, [handlers, props.doc_path, props.view_state_ids, props.id, props.file_declared_integration]);

    /*
     * Natural lane order for the drawer's lane-order row: alphabetical, with 'untagged' last. Derived for
     * ANY lane view rather than for kanban alone, because the drawer renders that row from the node the
     * user selected in its tree rather than from the view the board happens to be showing.
     */
    const natural_column_order = useMemo<string[]>(() => {
        if (!isGroupedViewType(props.type, registryWithUserTypes(user_view_types))) { return []; }
        return deriveNaturalColumnOrder(notes_within_parent_context);
    }, [props.type, notes_within_parent_context, user_view_types]);

    /*
     * cascade_write_setting - write one setting to VS Code config under notethink.settings.*, at the
     * scope the extension picks (Workspace, falling back to User in a folderless window). This is the
     * only way any setting is written, in any integration mode, so a change made in current_file mode
     * is visible in folder mode and vice versa. Marks the per-setting key plus the 'settingsCascade'
     * sentinel so the spinner appears if the round-trip is non-instantaneous; the echo reducer clears
     * both keys when the new cascade arrives.
     */
    const cascade_write_setting = useCallback((setting: SettingsCascadeKey, value: unknown): void => {
        markPending(setting);
        markPending('settingsCascade');
        handlers.postMessage?.({
            type: 'updateSetting',
            setting,
            value,
        });
    }, [handlers, markPending]);

    /*
     * handle_view_type_change - change the view type (auto / document / kanban). Mirrors
     * handle_integration_change: dispatch the selection to this view's id, then cascade-write
     * 'viewType' so the choice persists across integration modes (viewType is a view-type setting,
     * not integration-specific - a type picked in current_file mode also applies in folder mode).
     */
    const handle_view_type_change = useCallback((view_type: string): void => {
        handlers.setViewManagedState([{ id: props.id, type: view_type }]);
        cascade_write_setting('viewType', view_type);
    }, [handlers, props.id, cascade_write_setting]);

    /*
     * handle_card_type_change - pin the card type, or return it to auto. One cascade write and nothing
     * else: the card reaches every note through the view's display_options, rebuilt from the cascade.
     */
    const handle_card_type_change = useCallback((card_type: string): void => {
        cascade_write_setting('cardType', card_type);
    }, [cascade_write_setting]);

    const default_actions = useDefaultActions(handlers);

    /*
     * handle_column_order_change - apply the Kanban column order. The cascade spells "natural order"
     * as an empty array rather than an absent value, matching the package.json default's shape, so a
     * board reordered back to natural stops pinning an order and picks up future natural-order changes.
     */
    const handle_column_order_change = useCallback((next_order: string[]): void => {
        const matches_natural = arraysEqual(next_order, natural_column_order);
        cascade_write_setting('columnOrder', matches_natural ? [] : next_order);
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
        handle_column_order_change,
        ...default_actions,
    };
}

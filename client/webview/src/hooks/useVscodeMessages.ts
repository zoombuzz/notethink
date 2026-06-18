import Debug from 'debug';
import { useCallback, useEffect, useState } from 'react';
import { anyViewInFolderMode, resolveIntegrationMode } from '../notethink-views/src/lib/viewstateops';
import { INTEGRATION_MODE_FOLDER } from '../notethink-views/src/types/IntegrationMode';
import type { HashMapOf, Doc } from '../types/general';
import type { TextSelection } from '../notethink-views/src/types/NoteProps';
import type { GlobalSettingsPayload, SettingsCascadePayload, JumpTargetsMessage } from '../notethink-views/src/types/Messages';
import type { ViewState } from './usePersistedViewStates';

const debug = Debug("nodejs:notethink:useVscodeMessages");

interface SelectionState {
    [docPath: string]: TextSelection;
}

interface VscodeMessagesDeps {
    initial_docs: HashMapOf<Doc> | undefined;
    saved_view_states: Record<string, ViewState> | undefined;
    postMessage: (message: unknown) => void;
    markConnected: () => void;
    setGlobalSettings: (settings: GlobalSettingsPayload) => void;
    setSettingsCascade: (settings: SettingsCascadePayload) => void;
    updateAllViewStates: (updater: (view_state: ViewState) => ViewState) => void;
    view_states_ref: React.MutableRefObject<Record<string, ViewState>>;
    navigation_callback_ref: React.MutableRefObject<((direction: string) => void) | undefined>;
    markPending: (key: string) => void;
    clearPending: (key: string) => void;
    setJumpTargets: (response: JumpTargetsMessage) => void;
}

/**
 * State exposed by useVscodeMessages: aggregated doc/selection/workspace state distilled from the wire-format messages the extension posts to the webview.
 * - active_editor_doc_path: path of the doc whose editor most recently emitted a selectionChanged — the closest proxy for "what the user is currently editing" available to the webview, since the extension only sends per-doc selection updates and never an explicit `activeEditor` signal
 */
interface VscodeMessagesState {
    docs: HashMapOf<Doc> | undefined;
    selections: SelectionState;
    active_editor_doc_path: string | undefined;
    workspace_root: string;
    workspace_projects: string[];
    aggregate_total_discovered: number | undefined;
    includeFilter: string | undefined;
    excludeFilter: string | undefined;
}

// validate the message envelope and per-type payload; returns false (and warns) when the message must be discarded
function isMessageValid(message: { type?: unknown; [key: string]: unknown }): boolean {
    if (message === null || message === undefined || typeof message !== 'object' || typeof message.type !== 'string') {
        debug('discarding message with missing or invalid type %O', message);
        return false;
    }
    if (message.type === 'update') {
        const partial = message.partial as { docs?: unknown } | null | undefined;
        if (partial === null || partial === undefined || typeof partial !== 'object' || partial.docs === null || partial.docs === undefined || typeof partial.docs !== 'object') {
            debug('discarding update message with invalid partial.docs %O', message);
            return false;
        }
    }
    if (message.type === 'selectionChanged') {
        const selection = message.selection as { head?: unknown; anchor?: unknown } | null | undefined;
        if (selection === null || selection === undefined || typeof selection !== 'object' || typeof selection.head !== 'number' || typeof selection.anchor !== 'number') {
            debug('discarding selectionChanged message with invalid selection %O', message);
            return false;
        }
    }
    if (message.type === 'command') {
        if (typeof message.command !== 'string') {
            debug('discarding command message with invalid command %O', message);
            return false;
        }
    }
    if (message.type === 'globalSettings') {
        if (message.settings === null || message.settings === undefined || typeof message.settings !== 'object') {
            debug('discarding globalSettings message with invalid settings %O', message);
            return false;
        }
    }
    if (message.type === 'settingsCascade') {
        if (message.settings === null || message.settings === undefined || typeof message.settings !== 'object') {
            debug('discarding settingsCascade message with invalid settings %O', message);
            return false;
        }
    }
    if (message.type === 'pendingChange') {
        if (typeof message.key !== 'string' || typeof message.on !== 'boolean') {
            debug('discarding pendingChange message with invalid key/on %O', message);
            return false;
        }
    }
    if (message.type === 'jumpTargets') {
        if (typeof message.mode !== 'string' || typeof message.path !== 'string' || !Array.isArray(message.entries)) {
            debug('discarding jumpTargets message with invalid mode/path/entries %O', message);
            return false;
        }
    }
    return true;
}

/*
 * merge an incoming update payload into the current doc map; returns the previous map unchanged when no hashes differ
 * merge_strategy 'merge' upserts incoming docs (folder-mode incremental updates); anything else replaces the map entirely (single-file view, or folder-mode initial bulk load)
 */
function mergeUpdatedDocs(current: { docs?: HashMapOf<Doc> }, message: { partial: { docs?: HashMapOf<Doc> }; merge_strategy?: string }): { docs?: HashMapOf<Doc> } {
    const incoming_docs = message.partial.docs || {};
    const current_docs = current.docs || {};
    const merge_strategy = message.merge_strategy;
    if (merge_strategy === 'merge') {
        let has_changes = false;
        for (const [id, doc] of Object.entries(incoming_docs) as [string, Doc][]) {
            const existing = current_docs[id];
            if (!existing || !doc.hash_sha256 || existing.hash_sha256 !== doc.hash_sha256) {
                has_changes = true;
                break;
            }
        }
        if (!has_changes) {
            debug('skipping setState (merge), no doc hashes changed');
            return current;
        }
        return { ...current, docs: { ...current_docs, ...incoming_docs } };
    }
    let has_changes = Object.keys(incoming_docs).length !== Object.keys(current_docs).length;
    if (!has_changes) {
        for (const [id, doc] of Object.entries(incoming_docs) as [string, Doc][]) {
            const existing = current_docs[id];
            if (!existing || !doc.hash_sha256 || existing.hash_sha256 !== doc.hash_sha256) {
                has_changes = true;
                break;
            }
        }
    }
    if (!has_changes) {
        debug('skipping setState, no doc hashes changed');
        return current;
    }
    return { ...current, docs: incoming_docs };
}

/*
 * own the core doc/selection/workspace state, the host message listener, and the dispatch
 * the message-type string literals ('update', 'selectionChanged', 'command', 'globalSettings', 'settingsCascade', 'jumpTargets') are the on-the-wire contract and must stay exactly as-is
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useVscodeMessages(deps: VscodeMessagesDeps): VscodeMessagesState {
    const { postMessage, markConnected, setGlobalSettings, setSettingsCascade, updateAllViewStates, view_states_ref, navigation_callback_ref, saved_view_states, markPending, clearPending, setJumpTargets } = deps;
    const [docs_state, setDocsState] = useState<{ docs?: HashMapOf<Doc> }>({ docs: deps.initial_docs || {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [active_editor_doc_path, setActiveEditorDocPath] = useState<string | undefined>(undefined);
    const [workspace_root, setWorkspaceRoot] = useState<string>('');
    const [workspace_projects, setWorkspaceProjects] = useState<string[]>([]);
    // folder mode: total .md files discovered before the extension's MAX_AGGREGATE_FILES cap truncated the loaded set (drives the "(N of M)" breadcrumb)
    const [aggregate_total_discovered, setAggregateTotalDiscovered] = useState<number | undefined>(undefined);
    // folder mode: the effective include/exclude globs the extension is using, echoed back so the Files drawer can show them
    const [includeFilter, setIncludeFilter] = useState<string | undefined>(undefined);
    const [excludeFilter, setExcludeFilter] = useState<string | undefined>(undefined);

    // dispatch a validated command message to the appropriate viewState mutation / navigation
    const handleCommand = useCallback((message: { command: string; viewType?: string; setting?: string; direction?: string }) => {
        debug('received command %s', message.command);
        switch (message.command) {
            case 'setViewType':
                updateAllViewStates(view_state => ({ ...view_state, type: message.viewType }));
                // cascade: if folder mode is currently active, persist the new view type
                if (anyViewInFolderMode(view_states_ref.current)) {
                    postMessage({ type: 'updateSetting', setting: 'viewType', value: message.viewType });
                }
                return;
            case 'toggleSetting': {
                const setting_map: Record<string, string> = {
                    contextBars: 'showContextBars',
                };
                const setting_key = setting_map[message.setting as string];
                if (!setting_key) {return;}
                let next_value: boolean | undefined;
                updateAllViewStates(view_state => {
                    const current_settings = view_state?.display_options?.settings || {};
                    const flipped = !current_settings[setting_key as keyof typeof current_settings];
                    next_value = flipped;
                    return {
                        ...view_state,
                        display_options: {
                            ...view_state?.display_options,
                            settings: {
                                ...current_settings,
                                [setting_key]: flipped,
                            },
                        },
                    };
                });
                // cascade: only showContextBars is in the settings cascade today
                if (setting_key === 'showContextBars' && anyViewInFolderMode(view_states_ref.current) && next_value !== undefined) {
                    postMessage({ type: 'updateSetting', setting: 'showContextBars', value: next_value });
                }
                return;
            }
            case 'navigate':
                if (navigation_callback_ref.current && message.direction) {
                    navigation_callback_ref.current(message.direction);
                }
                return;
        }
    }, [postMessage, updateAllViewStates, view_states_ref, navigation_callback_ref]);

    // eslint-disable-next-line max-lines-per-function -- onMessage dispatches on every wire-format message type; further decomposition would split the switch across two functions without making the contract clearer (tracked: function-decomposition-wave2)
    const onMessage = useCallback((event: MessageEvent) => {
        const message = event.data;
        // any message from the extension host proves it's alive
        markConnected();
        if (!isMessageValid(message)) { return; }

        debug('onMessage %s', message.type);
        switch (message.type) {
            case 'update':
                debug('received update, docs: %O', Object.keys(message.partial.docs || {}));
                if (message.workspace_root) {
                    setWorkspaceRoot(message.workspace_root);
                }
                if (Array.isArray(message.workspace_projects)) {
                    setWorkspaceProjects((message.workspace_projects as unknown[]).filter((p): p is string => typeof p === 'string'));
                }
                if (message.extension_version) {
                    (window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ = message.extension_version;
                }
                if (typeof message.aggregate_total_discovered === 'number') {
                    setAggregateTotalDiscovered(message.aggregate_total_discovered);
                }
                if (typeof message.includeFilter === 'string') {
                    setIncludeFilter(message.includeFilter);
                }
                if (typeof message.excludeFilter === 'string') {
                    setExcludeFilter(message.excludeFilter);
                }
                setDocsState(current => mergeUpdatedDocs(current, message));
                // a bulk replace update (no merge_strategy) carrying aggregate totals is the apply-filters round-trip echo; clear the filter-edit sentinel so the spinner drops once the new file set has landed
                if (!message.merge_strategy && typeof message.aggregate_total_discovered === 'number') {
                    clearPending('integrationFilters');
                }
                return;
            case 'docDeleted':
                // folder mode: drop a single doc by id when the watcher sees a delete
                debug('received docDeleted for %s', message.docId);
                if (typeof message.docId !== 'string') {
                    debug('docDeleted with invalid docId %O', message);
                    return;
                }
                setDocsState(current => {
                    if (!current.docs || !current.docs[message.docId]) { return current; }
                    const next = { ...current.docs };
                    delete next[message.docId];
                    return { ...current, docs: next };
                });
                return;
            case 'selectionChanged':
                debug('received selectionChanged for %s', message.docPath);
                setSelections(prev => ({
                    ...prev,
                    [message.docPath]: {
                        main: {
                            head: message.selection.head,
                            anchor: message.selection.anchor,
                        },
                    },
                }));
                // the doc whose selection just changed is the active editor — folder mode's per-doc matcher reads this to scope the caret-to-note resolution
                setActiveEditorDocPath(message.docPath);
                return;
            case 'globalSettings':
                debug('received globalSettings %O', message.settings);
                setGlobalSettings(message.settings as GlobalSettingsPayload);
                // echo confirms the global-setting round-trip completed; clear any marks for those keys
                for (const key of Object.keys((message.settings as GlobalSettingsPayload) ?? {})) {
                    clearPending(key);
                }
                return;
            case 'settingsCascade':
                debug('received settingsCascade %O', message.settings);
                setSettingsCascade(message.settings as SettingsCascadePayload);
                // echo confirms the cascade round-trip completed; clear any marks for each cascade key and the aggregate 'settingsCascade' sentinel
                clearPending('settingsCascade');
                for (const key of Object.keys((message.settings as SettingsCascadePayload) ?? {})) {
                    clearPending(key);
                }
                return;
            case 'pendingChange':
                debug('received pendingChange key=%s on=%s', message.key, message.on);
                if (message.on) {
                    markPending(message.key as string);
                } else {
                    clearPending(message.key as string);
                }
                return;
            case 'jumpTargets':
                debug('received jumpTargets mode=%s path=%s', message.mode, message.path);
                setJumpTargets(message as JumpTargetsMessage);
                return;
            case 'command':
                handleCommand(message);
                return;
        }
    }, [markConnected, setGlobalSettings, setSettingsCascade, handleCommand, markPending, clearPending, setJumpTargets]);

    // listen for messages sent from the extension to the webview
    useEffect(() => {
        window.addEventListener('message', onMessage);
        debug('added message event listener');
        /*
         * if saved state shows we were in folder mode, re-establish the integration first
         * sending setIntegration before requestInitialState lets the extension synchronously set integration_path before the async findFiles - so when the requestInitialState handler runs sendDoc it uses merge_strategy='merge' and upserts into the saved folder docs map instead of replacing it
         */
        if (saved_view_states) {
            for (const id of Object.keys(saved_view_states)) {
                const vs = saved_view_states[id];
                // restore folder for a concrete folder pin AND for an `auto` view whose path was seeded by auto-resolution (resolveIntegrationMode treats auto + a path as folder), so an auto-folder file re-aggregates on reload without a flash through current_file
                if (resolveIntegrationMode(vs?.display_options) === INTEGRATION_MODE_FOLDER && vs?.display_options?.integration_path) {
                    debug('restoring folder integration on reload: %s', vs.display_options.integration_path);
                    /*
                     * host re-validates this path against the workspace before acting — persisted webview state is untrusted (defense-in-depth)
                     * do NOT replay the persisted includeFilter / excludeFilter here: the workspace cascade (notethink.settings.files.*) is the source of truth, and replaying a snapshot from an earlier session masks any later edit the user made in settings.json. handle_apply_filters writes user-applied filters through to the cascade, so the cascade is always up to date with the user's intent after a fresh Apply
                     */
                    postMessage({
                        type: 'setIntegration',
                        mode: INTEGRATION_MODE_FOLDER,
                        path: vs.display_options.integration_path,
                    });
                    break;
                }
            }
        }
        /*
         * request initial state - this is what triggers the extension to send the active doc (and selection + global settings)
         * sent after setIntegration so the extension has integration_path set by the time it runs sendDoc here
         */
        postMessage({
            type: 'requestInitialState',
        });
        return () => {
            debug('removed message event listener');
            window.removeEventListener('message', onMessage);
        };
        // mount-once listener: onMessage's deps (setters + stable handleCommand) never go stale, so empty deps is correct
    }, []);

    return {
        docs: docs_state.docs,
        selections,
        active_editor_doc_path,
        workspace_root,
        workspace_projects,
        aggregate_total_discovered,
        includeFilter,
        excludeFilter,
    };
}

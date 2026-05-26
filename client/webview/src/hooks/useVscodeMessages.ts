import Debug from 'debug';
import { useCallback, useEffect, useState } from 'react';
import { anyViewStateTaggedFolder } from './usePersistedViewStates';
import { INTEGRATION_MODE_FOLDER } from '../notethink-views/src/types/IntegrationMode';
import type { HashMapOf, Doc } from '../types/general';
import type { TextSelection } from '../notethink-views/src/types/NoteProps';
import type { GlobalSettingsPayload, SettingsCascadePayload } from '../notethink-views/src/types/Messages';
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
}

interface VscodeMessagesState {
    docs: HashMapOf<Doc> | undefined;
    selections: SelectionState;
    workspace_root: string;
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
    return true;
}

// merge an incoming update payload into the current doc map; returns the previous map unchanged when no hashes differ
// merge_strategy 'merge' upserts incoming docs (folder-mode incremental updates); anything else replaces the map entirely (single-file view, or folder-mode initial bulk load)
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

// own the core doc/selection/workspace state, the host message listener, and the dispatch
// the message-type string literals ('update', 'selectionChanged', 'command', 'globalSettings', 'settingsCascade') are the on-the-wire contract and must stay exactly as-is
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useVscodeMessages(deps: VscodeMessagesDeps): VscodeMessagesState {
    const { postMessage, markConnected, setGlobalSettings, setSettingsCascade, updateAllViewStates, view_states_ref, navigation_callback_ref, saved_view_states } = deps;
    const [docs_state, setDocsState] = useState<{ docs?: HashMapOf<Doc> }>({ docs: deps.initial_docs || {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [workspace_root, setWorkspaceRoot] = useState<string>('');
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
                if (anyViewStateTaggedFolder(view_states_ref.current)) {
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
                if (setting_key === 'showContextBars' && anyViewStateTaggedFolder(view_states_ref.current) && next_value !== undefined) {
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
                return;
            case 'globalSettings':
                debug('received globalSettings %O', message.settings);
                setGlobalSettings(message.settings as GlobalSettingsPayload);
                return;
            case 'settingsCascade':
                debug('received settingsCascade %O', message.settings);
                setSettingsCascade(message.settings as SettingsCascadePayload);
                return;
            case 'command':
                handleCommand(message);
                return;
        }
    }, [markConnected, setGlobalSettings, setSettingsCascade, handleCommand]);

    // listen for messages sent from the extension to the webview
    useEffect(() => {
        window.addEventListener('message', onMessage);
        debug('added message event listener');
        // if saved state shows we were in folder mode, re-establish the integration first
        // sending setIntegration before requestInitialState lets the extension synchronously set integration_path before the async findFiles - so when the requestInitialState handler runs sendDoc it uses merge_strategy='merge' and upserts into the saved folder docs map instead of replacing it
        if (saved_view_states) {
            for (const id of Object.keys(saved_view_states)) {
                const vs = saved_view_states[id];
                if (vs?.display_options?.integration_mode === INTEGRATION_MODE_FOLDER && vs?.display_options?.integration_path) {
                    debug('restoring folder integration on reload: %s', vs.display_options.integration_path);
                    // host re-validates this path against the workspace before acting — persisted webview state is untrusted (defense-in-depth)
                    // replay any persisted custom filters so a reload restores them rather than snapping back to the defaults
                    postMessage({
                        type: 'setIntegration',
                        mode: INTEGRATION_MODE_FOLDER,
                        path: vs.display_options.integration_path,
                        include: vs.display_options.includeFilter,
                        exclude: vs.display_options.excludeFilter,
                    });
                    break;
                }
            }
        }
        // request initial state - this is what triggers the extension to send the active doc (and selection + global settings)
        // sent after setIntegration so the extension has integration_path set by the time it runs sendDoc here
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
        workspace_root,
        aggregate_total_discovered,
        includeFilter,
        excludeFilter,
    };
}

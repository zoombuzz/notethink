import Debug from 'debug';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as l10n from '@vscode/l10n';
import type { HashMapOf, Doc } from '../types/general';
import NoteRenderer from './NoteRenderer';
import type { TextSelection, NoteDisplayOptions } from '../notethink-views/src/types/NoteProps';
import type { GlobalSettingsPayload, FolderViewSettingsPayload } from '../notethink-views/src/types/Messages';
import { DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, DEFAULT_MAX_NOTES_PER_FILE, DEFAULT_FOLDER_VIEW_COLUMN_ORDER } from '../constants';
import { FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/mergeAggregateRoot';

const debug = Debug("nodejs:notethink:ExtensionReceiver");

function anyViewStateTaggedFolder(view_states: Record<string, ViewState>): boolean {
    if (view_states[FOLDER_VIEW_STATE_ID]?.display_options?.integration_mode === 'folder') { return true; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        if (view_states[id]?.display_options?.integration_mode === 'folder') { return true; }
    }
    return false;
}

const DEFAULT_FOLDER_VIEW_SETTINGS: FolderViewSettingsPayload = {
    view_type: 'auto',
    column_order: DEFAULT_FOLDER_VIEW_COLUMN_ORDER,
    include_filter: DEFAULT_INCLUDE_FILTER,
    exclude_filter: DEFAULT_EXCLUDE_FILTER,
    max_notes_per_file: DEFAULT_MAX_NOTES_PER_FILE,
    show_context_bars: true,
    has_workspace_overrides: false,
};

type VSCodeState = {
    docs?: HashMapOf<Doc>;
    viewStates?: Record<string, ViewState>;
}

interface SelectionState {
    [docPath: string]: TextSelection;
}

export interface ViewState {
    type?: string;
    display_options?: NoteDisplayOptions;
}

// reuse the API instance acquired in the inline boot script (notethinkEditor.ts);
// fall back to acquireVsCodeApi() for test environments where the inline script doesn't run
function getVscodeApi(): ReturnType<typeof acquireVsCodeApi<VSCodeState>> {
    const win = window as Window & { __notethinkVscodeApi?: ReturnType<typeof acquireVsCodeApi<VSCodeState>> };
    if (win.__notethinkVscodeApi) {
        return win.__notethinkVscodeApi;
    }
    const api = acquireVsCodeApi<VSCodeState>();
    win.__notethinkVscodeApi = api;
    return api;
}
const vscode = getVscodeApi();

export function postMessageToExtension(message: unknown) {
    vscode.postMessage(message);
}

// normalise persisted viewState across past renames so downstream reads only see the current shape:
// integration_mode 'directory' → 'folder', legacy aggregate_* display_options fields → include_filter / exclude_filter / max_notes_per_file, and the folder-mode viewState key '__aggregate__' → '__folder__'
function migrateSavedState(s: VSCodeState | undefined): VSCodeState | undefined {
    if (!s?.viewStates) { return s; }
    // rename the legacy folder-mode viewState key on the map
    if ('__aggregate__' in s.viewStates && !('__folder__' in s.viewStates)) {
        s.viewStates['__folder__'] = s.viewStates['__aggregate__'];
        delete s.viewStates['__aggregate__'];
    }
    for (const id of Object.keys(s.viewStates)) {
        const dopts = s.viewStates[id]?.display_options as (Record<string, unknown> | undefined);
        if (!dopts) { continue; }
        if (dopts.integration_mode === 'directory') {
            dopts.integration_mode = 'folder';
        }
        if ('aggregate_include' in dopts) {
            dopts.include_filter = dopts.aggregate_include;
            delete dopts.aggregate_include;
        }
        if ('aggregate_exclude' in dopts) {
            dopts.exclude_filter = dopts.aggregate_exclude;
            delete dopts.aggregate_exclude;
        }
        if ('aggregate_max_notes_per_file' in dopts) {
            dopts.max_notes_per_file = dopts.aggregate_max_notes_per_file;
            delete dopts.aggregate_max_notes_per_file;
        }
    }
    return s;
}

const saved_state = migrateSavedState(vscode.getState());

const CONNECTION_TIMEOUT_MS = 5000;

export default function ExtensionReceiver() {
    // state originates from `vscode.getState` when a webview is reloaded
	const [state, setState] = useState<VSCodeState>(saved_state || { docs: {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [workspace_root, setWorkspaceRoot] = useState<string>('');
    // folder mode: total .md files discovered before the extension's MAX_AGGREGATE_FILES cap truncated the loaded set (drives the "(N of M)" breadcrumb)
    const [aggregate_total_discovered, setAggregateTotalDiscovered] = useState<number | undefined>(undefined);
    // folder mode: the effective include/exclude globs the extension is using, echoed back so the Files drawer can show them
    const [include_filter, setIncludeFilter] = useState<string | undefined>(undefined);
    const [exclude_filter, setExcludeFilter] = useState<string | undefined>(undefined);
    const [view_states, setViewStates] = useState<Record<string, ViewState>>(saved_state?.viewStates || {});
    // ref mirror so the empty-deps onMessage callback can read the current view_states without re-binding
    const view_states_ref = useRef<Record<string, ViewState>>(view_states);
    useEffect(() => { view_states_ref.current = view_states; }, [view_states]);
    const navigation_callback_ref = useRef<((direction: string) => void) | undefined>(undefined);
    const [global_settings, setGlobalSettings] = useState<GlobalSettingsPayload>({ show_line_numbers: false, watch_unopened_files_in_viewer: true });
    const [folder_view_settings, setFolderViewSettings] = useState<FolderViewSettingsPayload>(DEFAULT_FOLDER_VIEW_SETTINGS);
    const [connected, setConnected] = useState(!!saved_state?.docs && Object.keys(saved_state.docs).length > 0);
    const [timed_out, setTimedOut] = useState(false);

    // intercept link clicks and open via the extension host (works in desktop and web VS Code)
    useEffect(() => {
        const handleLinkClick = (event: MouseEvent) => {
            try {
                const target = event.target as HTMLElement | null;
                if (!target?.closest) { return; }
                const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
                if (!anchor) { return; }
                const url = anchor.getAttribute('href');
                if (!url) { return; }
                // only intercept external URLs (http/https/mailto)
                if (/^https?:\/\/|^mailto:/i.test(url)) {
                    event.preventDefault();
                    event.stopPropagation();
                    vscode.postMessage({ type: 'openExternal', url });
                }
            } catch (err) {
                debug('handleLinkClick failed: %O', err);
            }
        };
        document.addEventListener('click', handleLinkClick, true);
        return () => document.removeEventListener('click', handleLinkClick, true);
    }, []);

    const updateAllViewStates = useCallback((updater: (view_state: ViewState) => ViewState) => {
        setViewStates(prev => {
            const next = { ...prev };
            for (const id of Object.keys(next)) {
                next[id] = updater(next[id]);
            }
            if (Object.keys(next).length === 0) {
                next['__default'] = updater({});
            }
            return next;
        });
    }, []);

    const handleSetViewManagedState = useCallback((updates: Array<Record<string, unknown>>) => {
        setViewStates(prev => {
            const next = { ...prev };
            for (const update of updates) {
                const id = update.id as string;
                if (!id) {continue;}
                next[id] = {
                    ...next[id],
                    ...update,
                    display_options: {
                        ...next[id]?.display_options,
                        ...(update.display_options as NoteDisplayOptions | undefined),
                    },
                };
            }
            return next;
        });
    }, []);

    const onMessage = useCallback((event: MessageEvent) => {
        const message = event.data;

        // any message from the extension host proves it's alive
        setConnected(true);

        // Validate message envelope: must be a non-null object with a string type
        if (message === null || message === undefined || typeof message !== 'object' || typeof message.type !== 'string') {
            console.warn('ExtensionReceiver: discarding message with missing or invalid type', message);
            return;
        }

        // Per-type payload validation
        if (message.type === 'update') {
            if (
                message.partial === null || message.partial === undefined ||
                typeof message.partial !== 'object' ||
                message.partial.docs === null || message.partial.docs === undefined ||
                typeof message.partial.docs !== 'object'
            ) {
                console.warn('ExtensionReceiver: discarding update message with invalid partial.docs', message);
                return;
            }
        }
        if (message.type === 'selectionChanged') {
            if (
                message.selection === null || message.selection === undefined ||
                typeof message.selection !== 'object' ||
                typeof message.selection.head !== 'number' ||
                typeof message.selection.anchor !== 'number'
            ) {
                console.warn('ExtensionReceiver: discarding selectionChanged message with invalid selection', message);
                return;
            }
        }
        if (message.type === 'command') {
            if (typeof message.command !== 'string') {
                console.warn('ExtensionReceiver: discarding command message with invalid command', message);
                return;
            }
        }
        if (message.type === 'globalSettings') {
            if (
                message.settings === null || message.settings === undefined ||
                typeof message.settings !== 'object'
            ) {
                console.warn('ExtensionReceiver: discarding globalSettings message with invalid settings', message);
                return;
            }
        }
        if (message.type === 'folderViewSettings') {
            if (
                message.settings === null || message.settings === undefined ||
                typeof message.settings !== 'object'
            ) {
                console.warn('ExtensionReceiver: discarding folderViewSettings message with invalid settings', message);
                return;
            }
        }

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
                if (typeof message.include_filter === 'string') {
                    setIncludeFilter(message.include_filter);
                }
                if (typeof message.exclude_filter === 'string') {
                    setExcludeFilter(message.exclude_filter);
                }
                setState(state => {
                    const incoming_docs = message.partial.docs || {};
                    const current_docs = state.docs || {};
                    // merge_strategy: 'merge' upserts incoming docs into the current map (folder-mode incremental updates); anything else replaces the map entirely (single-file view, or folder-mode initial bulk load)
                    const merge_strategy = (message as { merge_strategy?: string }).merge_strategy;
                    if (merge_strategy === 'merge') {
                        // upsert: keep existing docs not in incoming
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
                            return state;
                        }
                        return { ...state, docs: { ...current_docs, ...incoming_docs } };
                    }
                    // default: replace entirely
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
                        return state;
                    }
                    return { ...state, docs: incoming_docs };
                });
                return;
            case 'docDeleted':
                // folder mode: drop a single doc by id when the watcher sees a delete
                debug('received docDeleted for %s', message.docId);
                if (typeof message.docId !== 'string') {
                    console.warn('ExtensionReceiver: docDeleted with invalid docId', message);
                    return;
                }
                setState(state => {
                    if (!state.docs || !state.docs[message.docId]) { return state; }
                    const next = { ...state.docs };
                    delete next[message.docId];
                    return { ...state, docs: next };
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
            case 'folderViewSettings':
                debug('received folderViewSettings %O', message.settings);
                setFolderViewSettings(message.settings as FolderViewSettingsPayload);
                return;
            case 'command':
                debug('received command %s', message.command);
                switch (message.command) {
                    case 'setViewType':
                        updateAllViewStates(view_state => ({ ...view_state, type: message.viewType }));
                        // cascade: if folder mode is currently active, persist the new view type
                        if (anyViewStateTaggedFolder(view_states_ref.current)) {
                            vscode.postMessage({ type: 'updateFolderViewSetting', setting: 'view_type', value: message.viewType });
                        }
                        return;
                    case 'toggleSetting': {
                        const setting_map: Record<string, string> = {
                            contextBars: 'show_context_bars',
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
                        // cascade: only show_context_bars is in the folder-view cascade today
                        if (setting_key === 'show_context_bars' && anyViewStateTaggedFolder(view_states_ref.current) && next_value !== undefined) {
                            vscode.postMessage({ type: 'updateFolderViewSetting', setting: 'show_context_bars', value: next_value });
                        }
                        return;
                    }
                    case 'navigate':
                        if (navigation_callback_ref.current) {
                            navigation_callback_ref.current(message.direction);
                        }
                        return;
                }
                return;
        }
    }, []);

    // persist state so the webview can restore instantly if VS Code recreates it;
    // skip empty docs to prevent blank-panel-on-restore when VS Code restarts
    // before the extension sends the first document
    useEffect(() => {
        if (!state.docs || Object.keys(state.docs).length === 0) { return; }
        vscode.setState({ docs: state.docs, viewStates: view_states });
    }, [state.docs, view_states]);

    // listen for messages sent from the extension to the webview
    useEffect(() => {
        window.addEventListener('message', onMessage);
        debug('added message event listener');
        // if saved state shows we were in folder mode, re-establish the integration first
        // sending setIntegration before requestInitialState lets the extension synchronously set integration_path before the async findFiles - so when the requestInitialState handler runs sendDoc it uses merge_strategy='merge' and upserts into the saved folder docs map instead of replacing it
        if (saved_state?.viewStates) {
            for (const id of Object.keys(saved_state.viewStates)) {
                const vs = saved_state.viewStates[id];
                if (vs?.display_options?.integration_mode === 'folder' && vs?.display_options?.integration_path) {
                    debug('restoring folder integration on reload: %s', vs.display_options.integration_path);
                    // host re-validates this path against the workspace before acting — persisted webview state is untrusted (defense-in-depth)
                    // replay any persisted custom filters so a reload restores them rather than snapping back to the defaults
                    vscode.postMessage({
                        type: 'setIntegration',
                        mode: 'folder',
                        path: vs.display_options.integration_path,
                        include: vs.display_options.include_filter,
                        exclude: vs.display_options.exclude_filter,
                    });
                    break;
                }
            }
        }
        // request initial state - this is what triggers the extension to send the active doc (and selection + global settings)
        // sent after setIntegration so the extension has integration_path set by the time it runs sendDoc here
        vscode.postMessage({
			type: 'requestInitialState',
		});
        return () => {
            debug('removed message event listener');
            window.removeEventListener('message', onMessage);
        };
    }, []);

    // show a helpful message if the extension host never responds
    useEffect(() => {
        if (connected) { return; }
        const timer = setTimeout(() => {
            debug('extension host did not respond within %dms', CONNECTION_TIMEOUT_MS);
            setTimedOut(true);
        }, CONNECTION_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [connected]);

    const has_docs = state.docs && Object.keys(state.docs).length > 0;
    if (!has_docs && !connected && timed_out) {
        return <div style={{ padding: '24px', color: 'var(--vscode-foreground)', fontFamily: 'var(--vscode-font-family)' }}>
            <p>{l10n.t('Waiting for extension host...')}</p>
            <p style={{ fontSize: '12px', opacity: 0.7 }}>
                {l10n.t('If this persists, reload the window: Ctrl+Shift+P → "Developer: Reload Window"')}
            </p>
        </div>;
    }

    return <NoteRenderer
        notes={state.docs || {}}
        selections={selections}
        postMessage={postMessageToExtension}
        viewStates={view_states}
        setViewManagedState={handleSetViewManagedState}
        onNavigationCommand={navigation_callback_ref}
        workspace_root={workspace_root}
        aggregate_total_discovered={aggregate_total_discovered}
        include_filter={include_filter}
        exclude_filter={exclude_filter}
        globalSettings={global_settings}
        folderViewSettings={folder_view_settings}
    />;
}

import Debug from 'debug';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as l10n from '@vscode/l10n';
import type { HashMapOf, Doc } from '../types/general';
import NoteRenderer from './NoteRenderer';
import type { TextSelection, NoteDisplayOptions } from '../notethink-views/src/types/NoteProps';
import type { GlobalSettingsPayload } from '../notethink-views/src/types/Messages';

const debug = Debug("nodejs:notethink:ExtensionReceiver");

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
    if ((window as any).__notethinkVscodeApi) {
        return (window as any).__notethinkVscodeApi;
    }
    const api = acquireVsCodeApi<VSCodeState>();
    (window as any).__notethinkVscodeApi = api;
    return api;
}
const vscode = getVscodeApi();

export function postMessageToExtension(message: unknown) {
    vscode.postMessage(message);
}

const saved_state = vscode.getState();

const CONNECTION_TIMEOUT_MS = 5000;

export default function ExtensionReceiver() {
    // state originates from `vscode.getState` when a webview is reloaded
	const [state, setState] = useState<VSCodeState>(saved_state || { docs: {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [workspace_root, setWorkspaceRoot] = useState<string>('');
    const [viewStates, setViewStates] = useState<Record<string, ViewState>>(saved_state?.viewStates || {});
    const navigationCallbackRef = useRef<((direction: string) => void) | undefined>(undefined);
    const [globalSettings, setGlobalSettings] = useState<GlobalSettingsPayload>({ show_line_numbers: false });
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
                console.error('handleLinkClick failed:', err);
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
                setState(state => {
                    const incoming_docs = message.partial.docs || {};
                    const current_docs = state.docs || {};
                    // single-file view: check if the incoming doc is unchanged
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
                    // replace docs entirely — single-file view shows one doc at a time
                    return { ...state, docs: incoming_docs };
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
            case 'command':
                debug('received command %s', message.command);
                switch (message.command) {
                    case 'setViewType':
                        updateAllViewStates(view_state => ({ ...view_state, type: message.viewType }));
                        return;
                    case 'toggleSetting': {
                        const setting_map: Record<string, string> = {
                            contextBars: 'show_context_bars',
                        };
                        const setting_key = setting_map[message.setting as string];
                        if (!setting_key) {return;}
                        updateAllViewStates(view_state => {
                            const current_settings = view_state?.display_options?.settings || {};
                            return {
                                ...view_state,
                                display_options: {
                                    ...view_state?.display_options,
                                    settings: {
                                        ...current_settings,
                                        [setting_key]: !current_settings[setting_key as keyof typeof current_settings],
                                    },
                                },
                            };
                        });
                        return;
                    }
                    case 'navigate':
                        if (navigationCallbackRef.current) {
                            navigationCallbackRef.current(message.direction);
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
        vscode.setState({ docs: state.docs, viewStates });
    }, [state.docs, viewStates]);

    // listen for messages sent from the extension to the webview
    useEffect(() => {
        window.addEventListener('message', onMessage);
        debug('added message event listener');
        // after adding the event listener, we can send a message to the extension to get the current state
        // this is a workaround for the fact that the webview is not fully loaded when the extension sends the initial message
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
        viewStates={viewStates}
        setViewManagedState={handleSetViewManagedState}
        onNavigationCommand={navigationCallbackRef}
        workspace_root={workspace_root}
        globalSettings={globalSettings}
    />;
}

import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState, useCallback, useRef } from 'react';
import Debug from 'debug';
import NoteRenderer from './NoteRenderer';
const debug = Debug("nodejs:notethink:ExtensionReceiver");
const vscode = acquireVsCodeApi();
export function postMessageToExtension(message) {
    vscode.postMessage(message);
}
export default function ExtensionReceiver() {
    // state originates from `vscode.getState` when a webview is reloaded, cached in setState
    const [state, setState] = useState(vscode.getState() || { docs: {} });
    const [selections, setSelections] = useState({});
    const [viewStates, setViewStates] = useState({});
    const navigationCallbackRef = useRef(undefined);
    const updateAllViewStates = useCallback((updater) => {
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
    const handleSetViewManagedState = useCallback((updates) => {
        setViewStates(prev => {
            const next = { ...prev };
            for (const update of updates) {
                const id = update.id;
                if (!id) {
                    continue;
                }
                next[id] = {
                    ...next[id],
                    ...update,
                    display_options: {
                        ...next[id]?.display_options,
                        ...update.display_options,
                    },
                };
            }
            return next;
        });
    }, []);
    const onMessage = useCallback((event) => {
        const message = event.data;
        debug('onMessage %s', message.type);
        switch (message.type) {
            case 'update':
                debug('received update, docs: %O', Object.keys(message.partial.docs || {}));
                setState(state => {
                    const incoming_docs = message.partial.docs || {};
                    const current_docs = state.docs || {};
                    let has_changes = false;
                    const merged = { ...current_docs };
                    for (const [id, doc] of Object.entries(incoming_docs)) {
                        const existing = current_docs[id];
                        if (!existing || !doc.hash_sha256 || existing.hash_sha256 !== doc.hash_sha256) {
                            merged[id] = doc;
                            has_changes = true;
                        }
                    }
                    if (!has_changes) {
                        debug('skipping setState, no doc hashes changed');
                        return state;
                    }
                    return { ...state, docs: merged };
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
            case 'command':
                debug('received command %s', message.command);
                switch (message.command) {
                    case 'setViewType':
                        updateAllViewStates(view_state => ({ ...view_state, type: message.viewType }));
                        return;
                    case 'toggleSetting': {
                        const setting_map = {
                            lineNumbers: 'show_line_numbers',
                            contextBars: 'show_context_bars',
                        };
                        const setting_key = setting_map[message.setting];
                        if (!setting_key) {
                            return;
                        }
                        updateAllViewStates(view_state => {
                            const current_settings = view_state?.display_options?.settings || {};
                            return {
                                ...view_state,
                                display_options: {
                                    ...view_state?.display_options,
                                    settings: {
                                        ...current_settings,
                                        [setting_key]: !current_settings[setting_key],
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
    return _jsx(NoteRenderer, { notes: state.docs || {}, selections: selections, postMessage: postMessageToExtension, viewStates: viewStates, setViewManagedState: handleSetViewManagedState, onNavigationCommand: navigationCallbackRef });
}

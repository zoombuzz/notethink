import React, { useEffect, useState, useCallback, useRef } from 'react';
import Debug from 'debug';
import type { HashMapOf, Doc } from '../types/general';
import NoteRenderer from './NoteRenderer';
import type { TextSelection, NoteDisplayOptions } from '../notethink-views/src/types/NoteProps';

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

const vscode = acquireVsCodeApi<VSCodeState>();

export function postMessageToExtension(message: unknown) {
    vscode.postMessage(message);
}

const saved_state = vscode.getState();

export default function ExtensionReceiver() {
    // state originates from `vscode.getState` when a webview is reloaded
	const [state, setState] = useState<VSCodeState>(saved_state || { docs: {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [viewStates, setViewStates] = useState<Record<string, ViewState>>(saved_state?.viewStates || {});
    const navigationCallbackRef = useRef<((direction: string) => void) | undefined>(undefined);

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

        debug('onMessage %s', message.type);
        switch (message.type) {
            case 'update':
                debug('received update, docs: %O', Object.keys(message.partial.docs || {}));
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
            case 'command':
                debug('received command %s', message.command);
                switch (message.command) {
                    case 'setViewType':
                        updateAllViewStates(view_state => ({ ...view_state, type: message.viewType }));
                        return;
                    case 'toggleSetting': {
                        const setting_map: Record<string, string> = {
                            lineNumbers: 'show_line_numbers',
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

    // persist state so the webview can restore instantly if VS Code recreates it
    useEffect(() => {
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

    return <NoteRenderer
        notes={state.docs || {}}
        selections={selections}
        postMessage={postMessageToExtension}
        viewStates={viewStates}
        setViewManagedState={handleSetViewManagedState}
        onNavigationCommand={navigationCallbackRef}
    />;
}

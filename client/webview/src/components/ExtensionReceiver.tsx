import React, { useEffect, useState, useCallback } from 'react';
import Debug from 'debug';
import { HashMapOf, Doc } from '../types/general';
import NoteRenderer from './NoteRenderer';

const debug = Debug('notethink:ExtensionReceiver');

type VSCodeState = {
    docs?: HashMapOf<Doc>;
}

const vscode = acquireVsCodeApi<VSCodeState>();

export default function ExtensionReceiver() {
    // state originates from `vscode.getState` when a webview is reloaded, cached in setState
	const [state, setState] = useState<VSCodeState>(vscode.getState() || { docs: {} });

    const onMessage = useCallback((event: MessageEvent) => {
        const message = event.data;
        debug('onMessage %s', message.type);
        switch (message.type) {
            case 'update':
                debug('received update, docs: %O', Object.keys(message.partial.docs || {}));
                setState(state => ({ ...state, docs: {
                    ...state.docs,
                    ...message.partial.docs,
                }}));
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

    return <NoteRenderer notes={state.docs || {}} />;
}

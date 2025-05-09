import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HashMapOf } from '../types/general';

const vscode = acquireVsCodeApi();

type VSCodeState = {
    docs?: HashMapOf<any>;
}

export default function ExtensionReceiver() {
    const ref = useRef<HTMLDivElement>(null);
    // state originates from `vscode.getState` when a webview is reloaded, cached in setState
	const [state, setState] = useState<VSCodeState>(vscode.getState() || { docs: {} });

    const onMessage = useCallback((event: MessageEvent) => {
        const message = event.data;
        console.warn('ExtensionReceiver: onMessage', message);
        switch (message.type) {
            case 'update':
                console.warn('received update', message.partial.docs);
                console.warn('pre-update state', state);
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
        console.warn('ExtensionReceiver: added event listener');
        // after adding the event listener, we can send a message to the extension to get the current state
        // this is a workaround for the fact that the webview is not fully loaded when the extension sends the initial message
        vscode.postMessage({
			type: 'requestInitialState',
		});
        return () => {
            console.warn('ExtensionReceiver: removed event listener');
            window.removeEventListener('message', onMessage);
        }
    }, []);

    return <div ref={ref} data-testid="ExtensionReceiver">
        {JSON.stringify(state)}
    </div>;
}

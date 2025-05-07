import React, { useEffect, useRef, useState } from 'react';

export default function VSCodeReceiver() {
    // @ts-ignore acquireVsCodeApi is a global function provided by VSCode webview
	const vscode = acquireVsCodeApi();
    const ref = useRef<HTMLDivElement>(null);
    // state originates from `vscode.getState` when a webview is reloaded, cached in setState
	const [state, setState] = useState(vscode.getState() || { docs: {} });

    // listen for messages sent from the extension to the webview
    useEffect(() => {
        const onMessage = ((event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    console.error('pre-update state', state);
                    // merge partial update into state first
                    Object.assign(state.docs, message.partial.docs);
                    // then persist in both react state and vscode state
                    setState(state);
                    vscode.setState(state);
                    console.error('received update', message.partial.docs, state);
                    return;
            }
        });
        window.addEventListener('message', onMessage);
        return () => {
            window.removeEventListener('message', onMessage);
        }
    }, [vscode, state]);

    return <div ref={ref} data-testId="VSCodeReceiver">
        {JSON.stringify(state)}
    </div>;
}

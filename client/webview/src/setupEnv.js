// polyfill globals required by react-dom and VS Code webview context
const { MessageChannel } = require('worker_threads');
const { TextEncoder, TextDecoder } = require('util');

if (typeof globalThis.MessageChannel === 'undefined') {
    Object.defineProperty(globalThis, 'MessageChannel', { value: MessageChannel });
}
if (typeof globalThis.TextEncoder === 'undefined') {
    Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder });
}
if (typeof globalThis.TextDecoder === 'undefined') {
    Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder });
}

// mock acquireVsCodeApi global (available in VS Code webview context)
// singleton so tests spying on .postMessage observe the same instance the SUT uses
const __vscode_api_singleton = {
    getState: () => ({ docs: {} }),
    setState: () => {},
    postMessage: () => {},
};
globalThis.acquireVsCodeApi = () => __vscode_api_singleton;

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
globalThis.acquireVsCodeApi = () => ({
    getState: () => ({ docs: {} }),
    setState: () => {},
    postMessage: () => {},
});

// polyfill globals required by react-dom/server in jsdom environment (React 19+)
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

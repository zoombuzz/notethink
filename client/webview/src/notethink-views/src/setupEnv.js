// polyfill globals required by react-dom/server in jsdom environment (React 19+)
const { MessageChannel } = require('worker_threads');
const { TextEncoder, TextDecoder } = require('util');

/*
 * jsdom has no MessageChannel, and React's scheduler opens one as it loads. A Node port holds the event
 * loop open, so an open one keeps the jest worker alive after the file's tests finish. Every channel is
 * recorded here, and setupTests closes them in afterAll.
 */
const open_message_channels = [];
class ClosableMessageChannel extends MessageChannel {
    constructor() {
        super();
        open_message_channels.push(this);
    }
}

if (typeof globalThis.MessageChannel === 'undefined') {
    Object.defineProperty(globalThis, 'MessageChannel', { value: ClosableMessageChannel });
    Object.defineProperty(globalThis, '__nt_open_message_channels', { value: open_message_channels });
}
if (typeof globalThis.TextEncoder === 'undefined') {
    Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder });
}
if (typeof globalThis.TextDecoder === 'undefined') {
    Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder });
}

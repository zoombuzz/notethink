import { parse } from '../lib/parseops';
import type { Root as MdastRoot } from 'mdast';

/**
 * The nested parse worker: mdast parsing runs here, off the extension host's own thread, so a
 * debounced keystroke in a large file never stalls the host (parsing costs about 0.6ms/KB).
 * `handleParseWorkerRequest` is exported directly so jest, which has no `Worker` global, can call it
 * without a round trip; `self.onmessage` below only wires it when running in an actual worker.
 */

export interface ParseWorkerRequest {
    request_id: string;
    text: string;
}

export type ParseWorkerResponse =
    | { request_id: string; mdast: MdastRoot }
    | { request_id: string; error: string };

export function handleParseWorkerRequest(request: ParseWorkerRequest): ParseWorkerResponse {
    try {
        return { request_id: request.request_id, mdast: parse(request.text) };
    } catch (err) {
        return { request_id: request.request_id, error: err instanceof Error ? err.message : String(err) };
    }
}

// wired only inside an actual worker context, so jest (which has no `self`/`onmessage`) never touches this
declare const self: { onmessage?: (event: { data: ParseWorkerRequest }) => void; postMessage?: (message: unknown) => void } | undefined;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = (event) => {
        self!.postMessage!(handleParseWorkerRequest(event.data));
    };
}

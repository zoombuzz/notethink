import { parse } from "./lib/parseops";

/*
 * Web Worker entry point for parsing folder-mode docs (arrive with `text`, no `content`). Only
 * the parse itself runs here; convertMdastToNoteHierarchy runs on the main thread instead, since
 * structured-cloning its larger NoteProps output back across the worker boundary would give back
 * most of what moving off-thread bought.
 *
 * `handleParseWorkerRequest` is exported for direct-import testing (jest has no Worker global);
 * self.onmessage wires it only inside an actual worker context. A worker has no `window`, so this
 * file must not import anything that reaches for it.
 */
export type ParseWorkerRequest = { id: string; hash: string; text: string };
export type ParseWorkerResponse =
    | { id: string; hash: string; content: ReturnType<typeof parse> }
    | { id: string; hash: string; error: string };

export function handleParseWorkerRequest(request: ParseWorkerRequest): ParseWorkerResponse {
    try {
        return { id: request.id, hash: request.hash, content: parse(request.text) };
    } catch (err) {
        return { id: request.id, hash: request.hash, error: err instanceof Error ? err.message : String(err) };
    }
}

// wired only inside an actual worker context, so jest (which has no `self`/`onmessage`) never touches this
declare const self: { onmessage?: (event: { data: ParseWorkerRequest }) => void; postMessage?: (message: unknown) => void } | undefined;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = (event) => {
        self!.postMessage!(handleParseWorkerRequest(event.data));
    };
}

/*
 * Sets webpack's runtime chunk base URL and CSP nonce before any React.lazy() import can fire, so
 * the split-out view/note chunks (GenericView's views, GenericNote's MermaidNote) resolve through
 * the webview's asWebviewUri origin and pass the nonce-gated CSP notethinkEditor.ts sets. Must be
 * the first import in the entry module: webpack recognises assignment to these two special names
 * anywhere in the entry chunk, but the assignment has to run before the first dynamic import()
 * actually executes, and import statements execute before any of an importing module's own code.
 */

declare let __webpack_public_path__: string;
declare let __webpack_nonce__: string;
declare let __webpack_get_script_filename__: undefined | ((chunkId: string | number) => string);
declare const NOTETHINK_DEV: boolean | undefined;

interface ChunkLoadingConfig {
    publicPath: string;
    nonce: string;
}

const config = (window as unknown as { __notethinkChunkConfig?: ChunkLoadingConfig }).__notethinkChunkConfig;
if (config) {
    __webpack_public_path__ = config.publicPath;
    __webpack_nonce__ = config.nonce;
}

// dev cache-buster for split chunks, matching the per-load ?v= getHtmlForWebview puts on the entry bundle
if (typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV) {
    __webpack_get_script_filename__ = (chunkId) => `${chunkId}.js?v=${Date.now()}`;
}

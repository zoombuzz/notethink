// ambient declaration for VS Code webview global — injected by the webview runtime
declare function acquireVsCodeApi<T = unknown>(): {
    postMessage(message: unknown): void;
    getState(): T | undefined;
    setState<S extends T>(state: S): S;
};

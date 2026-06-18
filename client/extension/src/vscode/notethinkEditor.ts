import * as vscode from 'vscode';
import { getNonce } from '../lib/cryptoops';
import { PanelSession } from './PanelSession';

export class NotethinkEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'notethink.viewer';
	private activePanel: vscode.WebviewPanel | undefined;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new NotethinkEditorProvider(context);
		const provider_registration = vscode.window.registerCustomEditorProvider(
			NotethinkEditorProvider.viewType,
			provider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		);
		return provider_registration;
	}

	constructor(private readonly context: vscode.ExtensionContext) {
		// no action
	}

	public sendCommandToActiveWebview(command: string, payload?: Record<string, unknown>): void {
		if (!this.activePanel) { return; }
		this.activePanel.webview.postMessage({
			type: 'command',
			command,
			...payload,
		});
	}

	public async myWebviewPanel(
		webviewPanel: vscode.WebviewPanel,
		initialDocument: vscode.TextDocument,
	): Promise<void> {
		// PanelSession owns all per-panel mutable state and behaviour; the provider only relays the active-panel reference for command posting
		const session = new PanelSession(
			webviewPanel,
			initialDocument,
			this.context,
			(webview) => this.getHtmlForWebview(webview),
			(panel) => { this.activePanel = panel; },
			(panel) => { if (this.activePanel === panel) { this.activePanel = undefined; } },
		);
		await session.start();
	}

	/**
	 * resolveCustomTextEditor
	 * called when file is right clicked, then "Open With..." NoteThink
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		return this.myWebviewPanel(webviewPanel, document);
	}

	/**
	 * getHtmlForWebview
	 * get the static HTML used for the editor webviews
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		const client_dist_directory = 'client/webview/dist';
		const script_uri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, client_dist_directory, 'index.js'));
		/*
		 * dev cache-buster: webview resources are cached by URL, so a rebuilt bundle can be served stale across reloads (the source of "my webview fix didn't take effect")
		 * in dev a per-load query param forces a fresh fetch; production keeps the cacheable URL
		 */
		const cache_bust = (typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV) ? `?v=${Date.now()}` : '';

		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>NoteThink</title>
			</head>
			<body>
				<div id="root"></div>
				<script nonce="${nonce}">
					(function() {
						// Disable React 19's component Performance Track by removing performance.measure
						// BEFORE the webview bundle loads. React's supportsUserTiming flag is evaluated
						// once at module-load time via "typeof performance.measure === 'function'"; when
						// that is false, React skips the entire per-fiber instrumentation path - no
						// addObjectDiffToProperties props-diff build, no reusable-options allocation, no
						// measure() call. Without this, a large document (e.g. a 5000+ list-item kanban
						// → 50000+ fibers per commit) fills the browser's performance entry buffer within
						// a single commit, and either throws DataCloneError mid-commit or drives the
						// renderer into OOM. A previous attempt wrapped measure() with catch+retry, but
						// React's diff-build ran anyway and the renderer still crashed with the same
						// heap-saturated content from oma's done.md. The only effective fix is to turn
						// the feature off at source. reportWebVitals() in this webview is a no-op (no
						// callback is passed from index.tsx) and no other bundle code depends on
						// performance.measure for correctness.
						try {
							if (typeof performance !== 'undefined') {
								performance.measure = undefined;
							}
						} catch (e) {
							// performance.measure non-writable - leave it alone
						}
						// early-acquire API and expose on window so ExtensionReceiver.tsx can reuse it;
						// guard with try/catch in case the webview is restored from cache (acquireVsCodeApi throws on second call)
						try {
							if (!window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi = acquireVsCodeApi();
							}
						} catch(e) {
							// already acquired - reuse existing instance
						}
						// capture uncaught errors that escape React ErrorBoundary
						window.onerror = function(msg, source, line, col, error) {
							if (window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi.postMessage({ type: 'renderError', message: String(msg), stack: error ? error.stack : source + ':' + line });
							}
							console.error('[NoteThink] uncaught error:', msg, source, line);
						};
						window.onunhandledrejection = function(event) {
							var reason = event.reason;
							if (window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi.postMessage({ type: 'renderError', message: String(reason), stack: reason && reason.stack ? reason.stack : '' });
							}
							console.error('[NoteThink] unhandled rejection:', reason);
						};
					})();
					var exports = {};
				</script>
				<script nonce="${nonce}" src="${script_uri}${cache_bust}"></script>
			</body>
			</html>`;
	}
}

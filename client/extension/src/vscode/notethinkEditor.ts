import * as vscode from 'vscode';
import { generateIdentifier } from '../lib/crypto';
import type { HashMapOf, Doc } from '../types/general';
import { abbrevDoc, getNonce } from '../lib/utils';
import { debug, writeToLog, writeToErrorLog } from "../lib/errorops";
import { parse } from '../lib/parseops';

const CHANGE_DEBOUNCE_MS = 250;
const SELECTION_DEBOUNCE_MS = 120;
const BACKGROUND_BATCH_SIZE = 20;

export class NotethinkEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'zoombuzz.notethink';
	private activePanel: vscode.WebviewPanel | undefined;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new NotethinkEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(
			NotethinkEditorProvider.viewType,
			provider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		);
		return providerRegistration;
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
		// track active panel for command relay
		this.activePanel = webviewPanel;
		webviewPanel.onDidChangeViewState(() => {
			if (webviewPanel.active) {
				this.activePanel = webviewPanel;
			}
		});

		// setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		// --- helpers ---

		async function buildDoc(document: vscode.TextDocument): Promise<Doc> {
			const text = document.getText();
			const mdast = parse(text);
			// asRelativePath handles symlinks — returns path relative to workspace root
			const relative = vscode.workspace.asRelativePath(document.uri, false);
			return {
				path: document.uri.path,
				relative_path: !relative.startsWith('/') ? relative : undefined,
				id: await generateIdentifier(document.uri.path),
				content: mdast,
				text,
				hash_sha256: await generateIdentifier(text),
				updatedAt: new Date().toISOString(),
				createdBy: "activeEditor",
			};
		}

		function sendDoc(doc: Doc) {
			const timestamped = { ...doc, updateSentAt: new Date().toISOString() };
			debug('sendDoc %s', doc.path);
			webviewPanel.webview.postMessage({
				type: 'update',
				partial: { docs: { [doc.id]: timestamped } },
				workspace_root,
				extension_version,
			});
		}

		function sendSelection(doc_path: string, head: number, anchor: number) {
			webviewPanel.webview.postMessage({
				type: 'selectionChanged',
				docPath: doc_path,
				selection: { head, anchor },
			});
		}

		// --- single-file view: show only the active document ---

		let active_doc: Doc | undefined;
		let active_path: string | undefined;

		function sendCurrentSelection() {
			if (!active_path) { return; }
			const editor = vscode.window.visibleTextEditors.find(
				ed => ed.document.uri.path === active_path
			);
			if (editor) {
				const head = editor.document.offsetAt(editor.selection.active);
				const anchor = editor.document.offsetAt(editor.selection.anchor);
				sendSelection(active_path, head, anchor);
			} else {
				sendSelection(active_path, 0, 0);
			}
		}

		// resolve workspace root for breadcrumb display
		// Use asRelativePath to handle symlinks correctly — it returns a path relative
		// to the workspace folder regardless of how the folder was opened (symlink or real path).
		// getWorkspaceFolder may also return undefined in web extension hosts.
		const workspace_folder = vscode.workspace.getWorkspaceFolder(initialDocument.uri)
			|| vscode.workspace.workspaceFolders?.[0];
		const workspace_root = workspace_folder?.uri.path || '';
		const extension_version = this.context.extension.packageJSON.version as string || '';

		// load initial document and send selection for styled first render
		active_doc = await buildDoc(initialDocument);
		active_path = initialDocument.uri.path;
		sendDoc(active_doc);
		sendCurrentSelection();

		const filter_criterion = '**/*.md';
		const docs: HashMapOf<Doc> = {};

		/**
		 * @todo multi-file view: load all workspace docs and watch for new ones.
		 * Call this when multi-file view context is mature enough.
		 */
		async function discoverAllWorkspaceDocs() {
			// phase 1: load docs from visible text editors for fast first paint
			const load_time = new Date().toISOString();
			const visible_md_editors = vscode.window.visibleTextEditors.filter(
				ed => ed.document.uri.path.endsWith('.md')
			);
			for (const editor of visible_md_editors) {
				try {
					const uri = editor.document.uri;
					const text = editor.document.getText();
					const mdast = parse(text);
					const doc: Doc = {
						path: uri.path,
						id: await generateIdentifier(uri.path),
						content: mdast,
						text,
						hash_sha256: await generateIdentifier(text),
						updatedAt: load_time,
						createdBy: "visibleTextEditor",
					};
					docs[doc.id] = doc;
					debug('loaded visible editor document', abbrevDoc(doc));
				} catch (err) {
					writeToErrorLog('failed to load visible editor document', editor.document.uri.path, err);
				}
			}
			debug('phase 1: loaded %d visible editor docs', Object.keys(docs).length);
			updateWebview();

			// listen for new documents being created that match the glob
			const watcher = vscode.workspace.createFileSystemWatcher(filter_criterion);
			watcher.onDidCreate(async (uri) => {
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					const text = document.getText();
					const mdast = parse(text);
					const doc: Doc = {
						path: uri.path,
						createdBy: "onDidCreate",
						id: await generateIdentifier(uri.path),
						content: mdast,
						text,
						hash_sha256: await generateIdentifier(text),
					};
					docs[doc.id] = doc;
					writeToLog('new matching document added in the background', abbrevDoc(doc));
					updateWebview({ [doc.id]: doc });
				} catch (err) {
					writeToErrorLog('failed to load new document', uri.path, err);
				}
			});

			// phase 2: discover remaining *.md files in the background
			const loaded_paths = new Set(Object.values(docs).map(d => d.path));
			const all_uris = await vscode.workspace.findFiles(filter_criterion);
			const remaining = all_uris.filter(uri => !loaded_paths.has(uri.path));
			debug('phase 2: discovering %d remaining docs (%d already loaded)', remaining.length, loaded_paths.size);
			let batch: HashMapOf<Doc> = {};
			let batch_count = 0;
			for (const uri of remaining) {
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					const text = document.getText();
					const mdast = parse(text);
					const doc: Doc = {
						path: uri.path,
						id: await generateIdentifier(uri.path),
						content: mdast,
						text,
						hash_sha256: await generateIdentifier(text),
						updatedAt: new Date().toISOString(),
						createdBy: "backgroundDiscovery",
					};
					docs[doc.id] = doc;
					batch[doc.id] = doc;
					batch_count++;
					if (batch_count >= BACKGROUND_BATCH_SIZE) {
						updateWebview(batch);
						batch = {};
						batch_count = 0;
					}
				} catch (err) {
					writeToErrorLog('failed to load background document', uri.path, err);
				}
			}
			if (batch_count > 0) {
				updateWebview(batch);
			}
			debug('phase 2: background discovery complete, %d total docs', Object.keys(docs).length);

			return watcher;
		}

		/**
		 * Update the webview content (used by multi-file discovery)
		 * @param partial_docs optional subset of docs to send; defaults to all docs
		 */
		function updateWebview(partial_docs?: HashMapOf<Doc>) {
			const send_docs = partial_docs ?? docs;
			const timestamped: HashMapOf<Doc> = {};
			const now = new Date().toISOString();
			for (const [id, doc] of Object.entries(send_docs)) {
				timestamped[id] = { ...doc, updateSentAt: now };
			}
			const message = {
				type: 'update',
				partial: { docs: timestamped },
				workspace_root,
				extension_version,
			};
			debug('updateWebview (%d docs)', Object.keys(send_docs).length);
			webviewPanel.webview.postMessage(message);
		}

		// debounce change handler — only re-parse the active document
		let change_timer: ReturnType<typeof setTimeout> | undefined;
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.path !== active_path) { return; }
			if (change_timer) { clearTimeout(change_timer); }
			change_timer = setTimeout(async () => {
				try {
					active_doc = await buildDoc(e.document);
					sendDoc(active_doc);
				} catch (err) {
					writeToErrorLog('failed to process document change', e.document.uri.path, err);
				}
			}, CHANGE_DEBOUNCE_MS);
		});

		// switch displayed document when the user switches to a different .md editor
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (!editor || !editor.document.uri.path.endsWith('.md')) { return; }
			if (editor.document.uri.path === active_path) { return; }
			try {
				active_doc = await buildDoc(editor.document);
				active_path = editor.document.uri.path;
				sendDoc(active_doc);
				const head = editor.document.offsetAt(editor.selection.active);
				const anchor = editor.document.offsetAt(editor.selection.anchor);
				sendSelection(active_path, head, anchor);
			} catch (err) {
				writeToErrorLog('failed to switch active document', editor?.document.uri.path, err);
			}
		});

		// receive message back from the webview.
		webviewPanel.webview.onDidReceiveMessage(async (e) => {
			debug('onDidReceiveMessage', e.type);
			switch (e.type) {
				case 'requestInitialState':
					if (active_doc) {
						sendDoc(active_doc);
						sendCurrentSelection();
					}
					return;
				case 'revealRange':
				case 'selectRange': {
					const doc_path = e.docPath as string;
					const from = e.from as number;
					const to = (e.to ?? e.from) as number;
					try {
						// Only act if a text editor for this document is already visible —
						// don't open a new editor just because the user clicked in the NoteThink view
						const existing = vscode.window.visibleTextEditors.find(
							ed => ed.document.uri.path === doc_path
						);
						if (!existing) { return; }
						const document = existing.document;
						const start_pos = document.positionAt(from);
						const end_pos = document.positionAt(to);
						// Selection(anchor, active): keep active at `from` so that
						// the head reported back via selectionChanged stays at the
						// note's start offset rather than overshooting past end_body
						existing.selection = (from === to)
							? new vscode.Selection(start_pos, end_pos)
							: new vscode.Selection(end_pos, start_pos);
						existing.revealRange(new vscode.Range(start_pos, end_pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
						// focus the text editor so the user can immediately type
						vscode.window.showTextDocument(existing.document, existing.viewColumn, false);
					} catch (err) {
						writeToErrorLog(`${e.type} failed`, doc_path, err);
					}
					return;
				}
				case 'setIntegration': {
					const mode = e.mode as string;
					const dir_path = e.path as string;
					if (mode === 'directory' && dir_path) {
						try {
							const pattern = new vscode.RelativePattern(vscode.Uri.file(dir_path), '**/*.md');
							const uris = await vscode.workspace.findFiles(pattern);
							const dir_docs: HashMapOf<Doc> = {};
							for (const uri of uris) {
								const document = await vscode.workspace.openTextDocument(uri);
								const doc = await buildDoc(document);
								dir_docs[doc.id] = { ...doc, updateSentAt: new Date().toISOString() };
							}
							debug('setIntegration directory: %d docs from %s', Object.keys(dir_docs).length, dir_path);
							webviewPanel.webview.postMessage({
								type: 'update',
								partial: { docs: dir_docs },
								workspace_root,
								extension_version,
							});
						} catch (err) {
							writeToErrorLog('setIntegration directory failed', dir_path, err);
						}
					}
					return;
				}
				case 'editText': {
					const doc_path = e.docPath as string;
					const changes = e.changes as Array<{from: number; to?: number; insert: string}>;
					try {
						const uri = vscode.Uri.file(doc_path);
						const document = await vscode.workspace.openTextDocument(uri);
						const doc_length = document.getText().length;

						// validate all change offsets before applying
						for (const change of changes) {
							const to = change.to ?? change.from;
							if (change.from < 0 || to < 0 || change.from > doc_length || to > doc_length || change.from > to) {
								writeToErrorLog('editText: invalid offsets, skipping',
									`from=${change.from} to=${to} len=${doc_length} insert="${change.insert}"`);
								return;
							}
						}

						writeToLog('editText', `${changes.length} changes on ${doc_path} (len=${doc_length})`);
						for (const change of changes) {
							const ctx = document.getText().slice(Math.max(0, change.from - 10), (change.to ?? change.from) + 10);
							writeToLog('editText', `from=${change.from} to=${change.to} insert="${change.insert}" ctx="${ctx}"`);
						}

						// apply changes end-to-start to preserve offsets
						const sorted_changes = [...changes].sort((a, b) => (b.from) - (a.from));

						// Prefer editing through an existing visible editor (never spawn a new one)
						const existing = vscode.window.visibleTextEditors.find(
							ed => ed.document.uri.path === doc_path
						);
						if (existing) {
							await existing.edit(editBuilder => {
								for (const change of sorted_changes) {
									const from = document.positionAt(change.from);
									const to = change.to !== undefined ? document.positionAt(change.to) : from;
									if (change.to !== undefined) {
										editBuilder.replace(new vscode.Range(from, to), change.insert);
									} else {
										editBuilder.insert(from, change.insert);
									}
								}
							});
						} else {
							// No visible editor — apply edits via WorkspaceEdit (never opens a new editor)
							const wsEdit = new vscode.WorkspaceEdit();
							for (const change of sorted_changes) {
								const from = document.positionAt(change.from);
								const to = change.to !== undefined ? document.positionAt(change.to) : from;
								if (change.to !== undefined) {
									wsEdit.replace(uri, new vscode.Range(from, to), change.insert);
								} else {
									wsEdit.insert(uri, from, change.insert);
								}
							}
							await vscode.workspace.applyEdit(wsEdit);
						}
						// bypass debounce: immediately re-parse and send the updated doc
						// (the edit above already fired onDidChangeTextDocument which set a
						// debounce timer — clear it to avoid a redundant delayed update)
						if (change_timer) { clearTimeout(change_timer); }
						active_doc = await buildDoc(existing?.document ?? document);
						sendDoc(active_doc);
					} catch (err) {
						writeToErrorLog('editText failed', doc_path, err);
					}
					return;
				}
				case 'renderError': {
					writeToErrorLog('webview render error', e.message as string, e.stack as string);
					return;
				}
			}
		});

		// track text editor selection changes — debounced to avoid flooding the webview
		let selection_timer: ReturnType<typeof setTimeout> | undefined;
		const selectionSubscription = vscode.window.onDidChangeTextEditorSelection(e => {
			if (e.textEditor.document.uri.path !== active_path) { return; }
			if (selection_timer) { clearTimeout(selection_timer); }
			selection_timer = setTimeout(() => {
				const selection = e.selections[0];
				const head = e.textEditor.document.offsetAt(selection.active);
				const anchor = e.textEditor.document.offsetAt(selection.anchor);
				sendSelection(e.textEditor.document.uri.path, head, anchor);
			}, SELECTION_DEBOUNCE_MS);
		});

		// clean up all listeners when the editor is closed
		webviewPanel.onDidDispose(() => {
			if (this.activePanel === webviewPanel) {
				this.activePanel = undefined;
			}
			if (change_timer) { clearTimeout(change_timer); }
			if (selection_timer) { clearTimeout(selection_timer); }
			changeDocumentSubscription.dispose();
			activeEditorSubscription.dispose();
			selectionSubscription.dispose();
		});
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
		const clientDistDirectory = 'client/webview/dist';
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, clientDistDirectory, 'index.js'));

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
						function syncColorScheme() {
							var isDark = document.body.classList.contains('vscode-dark')
								|| document.body.classList.contains('vscode-high-contrast');
							document.documentElement.setAttribute(
								'data-mantine-color-scheme',
								isDark ? 'dark' : 'light'
							);
						}
						syncColorScheme();
						new MutationObserver(syncColorScheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
						// early-acquire API and expose on window so ExtensionReceiver.tsx can reuse it;
						// guard with try/catch in case the webview is restored from cache (acquireVsCodeApi throws on second call)
						try {
							if (!window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi = acquireVsCodeApi();
							}
						} catch(e) {
							// already acquired — reuse existing instance
						}
						// capture uncaught errors that escape React ErrorBoundary
						if (window.__notethinkVscodeApi) {
							window.onerror = function(msg, source, line, col, error) {
								window.__notethinkVscodeApi.postMessage({ type: 'renderError', message: String(msg), stack: error ? error.stack : source + ':' + line });
							};
							window.onunhandledrejection = function(event) {
								var reason = event.reason;
								window.__notethinkVscodeApi.postMessage({ type: 'renderError', message: String(reason), stack: reason && reason.stack ? reason.stack : '' });
							};
						}
					})();
					var exports = {};
				</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

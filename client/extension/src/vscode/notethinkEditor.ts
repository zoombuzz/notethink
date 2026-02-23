import * as vscode from 'vscode';
import { generateIdentifier } from '../lib/crypto';
import type { HashMapOf, Doc } from '../types/general';
import { abbrevDoc, getNonce } from '../lib/utils';
import { debug, writeToLog, writeToErrorLog } from "../lib/errorops";
import { parse } from '../lib/parseops';

const CHANGE_DEBOUNCE_MS = 250;

export class NotethinkEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'zoombuzz.notethink';
	private activePanel: vscode.WebviewPanel | undefined;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new NotethinkEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
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
	): Promise<void> {
		// track active panel for command relay
		this.activePanel = webviewPanel;
		webviewPanel.onDidChangeViewState(() => {
			if (webviewPanel.active) {
				this.activePanel = webviewPanel;
			}
		});
		webviewPanel.onDidDispose(() => {
			if (this.activePanel === webviewPanel) {
				this.activePanel = undefined;
			}
		});

		// setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		// load all matching documents in repo
		const filter_criterion = '**/*.md';
		const all_documents_meta_raw = await vscode.workspace.findFiles(filter_criterion);
		const load_time = new Date().toISOString();
		const doc_results = await Promise.all(all_documents_meta_raw
			.map(async (uri): Promise<Doc | null> => {
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
						updatedAt: load_time,
						createdBy: "openTextDocument",
					};
					debug('loaded matching document', abbrevDoc(doc));
					return doc;
				} catch (err) {
					writeToErrorLog('failed to load document', uri.path, err);
					return null;
				}
			})
		);
		// convert to hashmap for rapid access, filtering out failed loads
		const docs: HashMapOf<Doc> = {};
		for (const doc of doc_results) {
			if (doc) { docs[doc.id] = doc; }
		}
		debug('initial load of docs', docs);

		/**
		 * Update the webview content
		 * @param doc optional doc to update just one document
		 */
		function updateWebview(doc?: Doc) {
			const message = {
				type: 'update',
				partial: { docs: (doc ? { [doc.id]: {
					...doc,
					updateSentAt: new Date().toISOString(),
				} } : docs)},
			};
			debug('updateWebview', message);
			webviewPanel.webview.postMessage(message);
		}

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
				// add to hashmap
				docs[doc.id] = doc;
				writeToLog('new matching document added in the background', abbrevDoc(doc));
				updateWebview(doc);
			} catch (err) {
				writeToErrorLog('failed to load new document', uri.path, err);
			}
		});

		// debounce change handler to avoid re-parsing on every keystroke
		let change_timer: ReturnType<typeof setTimeout> | undefined;
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (change_timer) { clearTimeout(change_timer); }
			change_timer = setTimeout(async () => {
				try {
					const doc_path = e.document.uri.path;
					const document = await vscode.workspace.openTextDocument(e.document.uri);
					const doc_id = await generateIdentifier(doc_path);
					let doc = docs[doc_id];
					if (doc === undefined) {
						doc = docs[doc_id] = {
							path: doc_path,
							id: doc_id,
						};
						writeToLog('onDidChangeTextDocument event for unknown document, adding', doc_path, doc_id);
					} else {
						writeToLog('Document changed in the background', abbrevDoc(doc));
					}
					const text = document.getText();
					doc.content = parse(text);
					doc.text = text;
					doc.hash_sha256 = await generateIdentifier(text);
					updateWebview(doc);
				} catch (err) {
					writeToErrorLog('failed to process document change', e.document.uri.path, err);
				}
			}, CHANGE_DEBOUNCE_MS);
		});

		// make sure we get rid of the listeners when our editor is closed.
		webviewPanel.onDidDispose(() => {
			if (change_timer) { clearTimeout(change_timer); }
			changeDocumentSubscription.dispose();
			watcher.dispose();
		});

		// receive message back from the webview.
		webviewPanel.webview.onDidReceiveMessage(async (e) => {
			debug('onDidReceiveMessage', e.type);
			switch (e.type) {
				case 'requestInitialState':
					// send the current state of the documents to the webview
					webviewPanel.webview.postMessage({
						type: 'update',
						partial: { docs },
					});
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
					} catch (err) {
						writeToErrorLog(`${e.type} failed`, doc_path, err);
					}
					return;
				}
				case 'editText': {
					const doc_path = e.docPath as string;
					const changes = e.changes as Array<{from: number; to?: number; insert: string}>;
					try {
						const uri = vscode.Uri.file(doc_path);
						const document = await vscode.workspace.openTextDocument(uri);
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
					} catch (err) {
						writeToErrorLog('editText failed', doc_path, err);
					}
					return;
				}
			}
		});

		// track text editor selection changes and forward to webview
		const selectionSubscription = vscode.window.onDidChangeTextEditorSelection(e => {
			const doc_path = e.textEditor.document.uri.path;
			// check if this document is one we're tracking
			const tracked_doc = Object.values(docs).find(d => d.path === doc_path);
			if (!tracked_doc) { return; }
			const selection = e.selections[0];
			const head = e.textEditor.document.offsetAt(selection.active);
			const anchor = e.textEditor.document.offsetAt(selection.anchor);
			webviewPanel.webview.postMessage({
				type: 'selectionChanged',
				docPath: doc_path,
				selection: { head, anchor },
			});
		});

		webviewPanel.onDidDispose(() => {
			selectionSubscription.dispose();
		});

		// first call to initialise content
		updateWebview();
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
		return this.myWebviewPanel(webviewPanel);
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
					})();
					var exports = {};
				</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

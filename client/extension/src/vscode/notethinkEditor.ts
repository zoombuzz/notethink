import * as vscode from 'vscode';
import { generateIdentifier } from '../lib/crypto';
import { HashMapOf, Doc } from '../types/general';
import { abbrevDoc, getNonce } from '../lib/utils';
import { debug, writeToLog, writeToErrorLog } from "../lib/errorops";
import { parse } from '../lib/parseops';

const CHANGE_DEBOUNCE_MS = 250;

export class NotethinkEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'zoombuzz.notethink';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new NotethinkEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
		return providerRegistration;
	}

	constructor(private readonly context: vscode.ExtensionContext) {
		// no action
	}

	public async myWebviewPanel(
		webviewPanel: vscode.WebviewPanel,
	): Promise<void> {
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
					const mdast = parse(document.getText());
					const doc: Doc = {
						path: uri.path,
						id: await generateIdentifier(uri.path),
						content: mdast,
						text: document.getText(),
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
				const mdast = parse(document.getText());
				const doc: Doc = {
					path: uri.path,
					createdBy: "onDidCreate",
					id: await generateIdentifier(uri.path),
					content: mdast,
					text: document.getText(),
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
					const mdast = parse(document.getText());
					doc.content = mdast;
					doc.text = document.getText();
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
		webviewPanel.webview.onDidReceiveMessage(e => {
			debug('onDidReceiveMessage', e.type, docs);
			switch (e.type) {
				case 'actionName':
					// do stuff
					return;
				case 'requestInitialState':
					// send the current state of the documents to the webview
					webviewPanel.webview.postMessage({
						type: 'update',
						partial: { docs },
					});
					return;
			}
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
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>NoteThink</title>
			</head>
			<body>
				<div id="root"></div>
				<script nonce="${nonce}">var exports = {};</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

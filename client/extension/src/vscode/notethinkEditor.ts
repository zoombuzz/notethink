import * as vscode from 'vscode';
import { generateIdentifier } from '../lib/crypto';
import { HashMapOf } from '../types/general';
import { abbrevDoc, getNonce } from '../lib/utils';
import { debug, writeToLog } from "../lib/errorops";
import { parse } from '../lib/parseops';

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
		const docs: HashMapOf<any> = (await Promise.all(all_documents_meta_raw
			.map(async (uri) => {
				const document = await vscode.workspace.openTextDocument(uri);
				const mdast = parse(document.getText());
				const doc = {
					path: uri.path,
					id: await generateIdentifier(uri.path),
					content: mdast,
					updatedAt: load_time,
					createdBy: "openTextDocument",
				};
				debug('loaded matching document', abbrevDoc(doc));
				return doc;
			})
		))
		// convert to hashmap for rapid access
		.reduce((acc: HashMapOf<any>, doc) => (acc[doc.id]=doc,acc),{});
		debug('initial load of docs', docs);

		/**
		 * Update the webview content
		 * @param doc optional doc to update just one document
		 */
		function updateWebview(doc?: any) {
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
			const document = await vscode.workspace.openTextDocument(uri);
		    const doc = {
				path: uri.path,
				createdBy: "onDidCreate",
				id: await generateIdentifier(uri.path),
				content: document.getText(),
			};
			// add to hashmap
			docs[doc.id] = doc;
			writeToLog('new matching document added in the background', abbrevDoc(doc));
			updateWebview(doc);
		});

		// listen for changes (live in this instance or background saved) to watched documents
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async e => {
			const uri = e.document.uri.toString();
			const document = await vscode.workspace.openTextDocument(e.document.uri);
			const name_without_protocol = decodeURI(uri.replace('file://', ''));
			const doc_id = await generateIdentifier(name_without_protocol);
			let doc = docs[doc_id];
			if (doc === undefined) {
				doc = docs[doc_id] = {
					path: name_without_protocol,
					id: doc_id,
				};
				writeToLog('onDidChangeTextDocument event for unknown document, adding', name_without_protocol, doc_id);
			} else {
				writeToLog('Document changed in the background', abbrevDoc(doc));
			}
			doc.content = document.getText();
			updateWebview(doc);
		});

		// make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
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

		// whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.  This policy is definitely being enforced,
				in spite of "created a webview without a content security policy" [warning].
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Replace this title</title>
			</head>
			<body>
				<div id="root"></div>
				<!-- Use a nonce to whitelist which scripts can be run; create global exports var to avoid JS error (https://stackoverflow.com/a/43702240/1444233) -->
				<script nonce="${nonce}">var exports = {};</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

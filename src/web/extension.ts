import * as vscode from 'vscode';
import { NotethinkEditorProvider } from './notethinkEditor';

export function activate(context: vscode.ExtensionContext) {

	// register our editor for opening specific files in wider context
	const provider = new NotethinkEditorProvider(context);
	const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
	context.subscriptions.push(providerRegistration);

	// register command defined in package.json
	const disposable = vscode.commands.registerCommand('notethink.openview', async () => {
		// open an editor webview (without a specific file) in a wider context
		provider.myWebviewPanel(vscode.window.createWebviewPanel('notethink', 'NoteThink', vscode.ViewColumn.One, {}));
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}

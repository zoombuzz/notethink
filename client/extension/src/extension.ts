import * as vscode from 'vscode';
import { NotethinkEditorProvider } from './vscode/notethinkEditor';

const PANEL_VIEWTYPE = 'notethink';

export function activate(context: vscode.ExtensionContext) {

	// register our custom editor for "Open With..." right-click
	const provider = new NotethinkEditorProvider(context);
	const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
	context.subscriptions.push(providerRegistration);

	// register serializer to restore panels after window reload
	context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(PANEL_VIEWTYPE, {
		async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
			// extract document path from persisted webview state
			const saved = state as { docs?: Record<string, { path?: string }> } | undefined;
			const first_doc = saved?.docs ? Object.values(saved.docs)[0] : undefined;
			let doc_path = first_doc?.path;
			// fall back to current active .md editor if saved state has no doc
			// (happens when VS Code restarts before the first doc was sent to the webview)
			if (!doc_path) {
				const active = vscode.window.activeTextEditor;
				if (active?.document.uri.path.endsWith('.md')) {
					doc_path = active.document.uri.path;
				}
			}
			if (!doc_path) { panel.dispose(); return; }
			try {
				const uri = vscode.Uri.file(doc_path);
				const document = await vscode.workspace.openTextDocument(uri);
				await provider.myWebviewPanel(panel, document);
			} catch {
				// document may have been deleted since last session
				panel.dispose();
			}
		}
	}));

	// register command defined in package.json
	const disposable = vscode.commands.registerCommand('notethink.openview', async () => {
		const active_editor = vscode.window.activeTextEditor;
		if (!active_editor || !active_editor.document.uri.path.endsWith('.md')) {
			vscode.window.showWarningMessage('NoteThink: open a .md file first');
			return;
		}
		// createWebviewPanel avoids the VS Code breadcrumb bar that custom editors show;
		// the WebviewPanelSerializer registered above handles restoring after window reload
		const panel = vscode.window.createWebviewPanel(
			PANEL_VIEWTYPE,
			'NoteThink',
			vscode.ViewColumn.Two,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		await provider.myWebviewPanel(panel, active_editor.document);
	});
	context.subscriptions.push(disposable);

	// view type switching commands
	for (const viewType of ['auto', 'document', 'kanban'] as const) {
		const commandName = `notethink.setView${viewType.charAt(0).toUpperCase() + viewType.slice(1)}`;
		context.subscriptions.push(vscode.commands.registerCommand(commandName, () => {
			provider.sendCommandToActiveWebview('setViewType', { viewType });
		}));
	}

	// line numbers: persisted to workspace config
	context.subscriptions.push(vscode.commands.registerCommand('notethink.toggleLineNumbers', async () => {
		const config = vscode.workspace.getConfiguration('notethink');
		const current = config.get<boolean>('showLineNumbers', false);
		await config.update('showLineNumbers', !current, vscode.ConfigurationTarget.Workspace);
	}));

	// context bars: ephemeral toggle via webview state
	context.subscriptions.push(vscode.commands.registerCommand('notethink.toggleContextBars', () => {
		provider.sendCommandToActiveWebview('toggleSetting', { setting: 'contextBars' });
	}));

	// navigation commands
	for (const direction of ['up', 'down', 'drillIn', 'drillOut', 'clearFocus'] as const) {
		const commandMap: Record<string, string> = {
			up: 'notethink.navigateUp',
			down: 'notethink.navigateDown',
			drillIn: 'notethink.drillIn',
			drillOut: 'notethink.drillOut',
			clearFocus: 'notethink.clearFocus',
		};
		context.subscriptions.push(vscode.commands.registerCommand(commandMap[direction], () => {
			provider.sendCommandToActiveWebview('navigate', { direction });
		}));
	}
}

export function deactivate() {}

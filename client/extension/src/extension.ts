import * as vscode from 'vscode';
import { NotethinkEditorProvider } from './vscode/notethinkEditor';

export function activate(context: vscode.ExtensionContext) {

	// register our editor for opening specific files in wider context
	const provider = new NotethinkEditorProvider(context);
	const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
	context.subscriptions.push(providerRegistration);

	// register command defined in package.json
	const disposable = vscode.commands.registerCommand('notethink.openview', async () => {
		const active_editor = vscode.window.activeTextEditor;
		if (!active_editor || !active_editor.document.uri.path.endsWith('.md')) {
			vscode.window.showWarningMessage('NoteThink: open a .md file first');
			return;
		}
		// use vscode.openWith to create a proper custom editor (auto-restored on window reload),
		// then move it to the next group so the text editor stays in Group 1
		await vscode.commands.executeCommand(
			'vscode.openWith',
			active_editor.document.uri,
			NotethinkEditorProvider.viewType,
		);
		await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
	});
	context.subscriptions.push(disposable);

	// view type switching commands
	for (const viewType of ['auto', 'document', 'kanban'] as const) {
		const commandName = `notethink.setView${viewType.charAt(0).toUpperCase() + viewType.slice(1)}`;
		context.subscriptions.push(vscode.commands.registerCommand(commandName, () => {
			provider.sendCommandToActiveWebview('setViewType', { viewType });
		}));
	}

	// settings toggle commands
	for (const setting of ['lineNumbers', 'contextBars'] as const) {
		const commandName = `notethink.toggle${setting.charAt(0).toUpperCase() + setting.slice(1)}`;
		context.subscriptions.push(vscode.commands.registerCommand(commandName, () => {
			provider.sendCommandToActiveWebview('toggleSetting', { setting });
		}));
	}

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

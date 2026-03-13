import * as vscode from 'vscode';
import { NotethinkEditorProvider } from './vscode/notethinkEditor';
import { GitHubFileSystemProvider } from './vscode/githubFileSystemProvider';
import { registerSaveToGitHub } from './vscode/dulcetSaveToGitHub';
import { registerOpenFromGitHub, handleUrlOpening } from './vscode/dulcetOpenFromGitHub';

const PANEL_VIEWTYPE = 'notethink';

function isDulcetContext(): boolean {
	// detect dulcet by checking the product name set in window.product
	const app_name = vscode.env.appName?.toLowerCase() ?? '';
	return app_name.includes('dulcet');
}

async function dulcetStartup(context: vscode.ExtensionContext, provider: NotethinkEditorProvider): Promise<void> {
	// only run on first activation with no open editors
	if (vscode.window.visibleTextEditors.length > 0) { return; }
	if (context.globalState.get('dulcet.started')) { return; }
	await context.globalState.update('dulcet.started', true);

	// load template from extension assets
	let template_content = '# Welcome to Dulcet\n\nStart typing to edit this document.\n';
	try {
		const template_uri = vscode.Uri.joinPath(context.extensionUri, 'templates', 'getting-started.md');
		const template_bytes = await vscode.workspace.fs.readFile(template_uri);
		template_content = new TextDecoder().decode(template_bytes);
	} catch {
		// template file not bundled — use inline fallback
	}

	// create untitled markdown document with template content
	const doc = await vscode.workspace.openTextDocument({
		content: template_content,
		language: 'markdown',
	});

	// show markdown editor in left group
	await vscode.window.showTextDocument(doc, {
		viewColumn: vscode.ViewColumn.One,
		preview: false,
	});

	// open NoteThink view in right group (reuse openview pattern)
	const panel = vscode.window.createWebviewPanel(
		PANEL_VIEWTYPE,
		'NoteThink',
		vscode.ViewColumn.Two,
		{ enableScripts: true, retainContextWhenHidden: true },
	);
	await provider.myWebviewPanel(panel, doc);

	// set 40/60 layout ratio
	await vscode.commands.executeCommand('workbench.action.setEditorLayout', {
		orientation: 0,
		groups: [{ size: 0.4 }, { size: 0.6 }],
	});
}

export function activate(context: vscode.ExtensionContext) {

	// register our custom editor for "Open With..." right-click
	const provider = new NotethinkEditorProvider(context);
	const providerRegistration = vscode.window.registerCustomEditorProvider(NotethinkEditorProvider.viewType, provider);
	context.subscriptions.push(providerRegistration);

	// dulcet-only features: GitHub filesystem, save command, and first-load experience
	if (isDulcetContext()) {
		vscode.commands.executeCommand('setContext', 'dulcet.active', true);
		const api_base = `${context.extensionUri.scheme}://${context.extensionUri.authority}`;
		const github_fs = new GitHubFileSystemProvider(api_base);
		context.subscriptions.push(
			vscode.workspace.registerFileSystemProvider('github', github_fs, { isCaseSensitive: true }),
		);
		registerSaveToGitHub(context, github_fs, api_base);
		registerOpenFromGitHub(context, github_fs, api_base);

		// URL-based opening takes precedence over default template experience
		const has_url_file = vscode.workspace.getConfiguration('dulcet').get<string>('openFile');
		if (has_url_file) {
			handleUrlOpening(context);
		} else {
			dulcetStartup(context, provider);
		}
	}

	// register serializer to restore panels after window reload
	context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(PANEL_VIEWTYPE, {
		async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
			// extract document path from persisted webview state
			const saved = state as { docs?: Record<string, { path?: string }> } | undefined;
			const first_doc = saved?.docs ? Object.values(saved.docs)[0] : undefined;
			const doc_path = first_doc?.path;
			if (!doc_path) { return; }
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

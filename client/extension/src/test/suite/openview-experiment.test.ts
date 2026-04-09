import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Experiment: which API approach actually opens a webview/editor in Group 2?
 *
 * Each test tries a different method, then checks vscode.window.tabGroups.all.length.
 * Run via the "Extension Tests" launch configuration.
 *
 * After each test we close all editors to reset state.
 */

const EXTENSION_ID = 'ZoomBuzz.notethink';
const VIEW_TYPE = 'zoombuzz.notethink';

async function closeAllEditors(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// give VS Code a moment to settle
	await new Promise(resolve => setTimeout(resolve, 300));
}

async function openMarkdownEditor(): Promise<{ uri: vscode.Uri; editor: vscode.TextEditor }> {
	// create a unique untitled file each time to avoid URI reuse issues
	const id = Math.random().toString(36).slice(2, 8);
	const uri = vscode.Uri.parse(`untitled:experiment-${id}.md`);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
	// insert some content so it's a valid markdown file
	const edit = new vscode.WorkspaceEdit();
	edit.insert(uri, new vscode.Position(0, 0), '# Test\n\nSome content.\n');
	await vscode.workspace.applyEdit(edit);
	await new Promise(resolve => setTimeout(resolve, 200));
	return { uri, editor };
}

function groupCount(): number {
	return vscode.window.tabGroups.all.length;
}

function report(label: string, groups: number): void {
	vscode.window.showInformationMessage(`[EXPERIMENT] ${label}: ${groups} group(s)`);
}

suite('Open View Experiment', () => {

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		if (extension && !extension.isActive) {
			await extension.activate();
		}
	});

	teardown(async () => {
		await closeAllEditors();
	});

	// ---------------------------------------------------------------
	// Approach 1: createWebviewPanel with ViewColumn.Beside
	// ---------------------------------------------------------------
	test('Approach 1: createWebviewPanel + ViewColumn.Beside', async () => {
		await openMarkdownEditor();
		const before = groupCount();

		vscode.window.createWebviewPanel(
			'experiment-1',
			'Experiment 1',
			vscode.ViewColumn.Beside,
			{ enableScripts: true },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('createWebviewPanel + Beside', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 2: createWebviewPanel with ViewColumn.Two
	// ---------------------------------------------------------------
	test('Approach 2: createWebviewPanel + ViewColumn.Two', async () => {
		await openMarkdownEditor();
		const before = groupCount();

		vscode.window.createWebviewPanel(
			'experiment-2',
			'Experiment 2',
			vscode.ViewColumn.Two,
			{ enableScripts: true },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('createWebviewPanel + Two', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 3: createWebviewPanel with object form { viewColumn, preserveFocus }
	// ---------------------------------------------------------------
	test('Approach 3: createWebviewPanel + object { viewColumn: Beside }', async () => {
		await openMarkdownEditor();

		vscode.window.createWebviewPanel(
			'experiment-3',
			'Experiment 3',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
			{ enableScripts: true },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('createWebviewPanel + {Beside}', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 4: createWebviewPanel with computed column (current + 1)
	// ---------------------------------------------------------------
	test('Approach 4: createWebviewPanel + computed column (One + 1)', async () => {
		const { editor } = await openMarkdownEditor();
		const target_column = (editor.viewColumn || vscode.ViewColumn.One) + 1;

		vscode.window.createWebviewPanel(
			'experiment-4',
			'Experiment 4',
			target_column,
			{ enableScripts: true },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('createWebviewPanel + computed column', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 5: vscode.openWith + ViewColumn.Beside
	// ---------------------------------------------------------------
	test('Approach 5: vscode.openWith + ViewColumn.Beside', async () => {
		const { uri } = await openMarkdownEditor();

		await vscode.commands.executeCommand(
			'vscode.openWith',
			uri,
			VIEW_TYPE,
			{ viewColumn: vscode.ViewColumn.Beside, preview: false },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('openWith + Beside', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 6: vscode.openWith + computed column
	// ---------------------------------------------------------------
	test('Approach 6: vscode.openWith + computed column (One + 1)', async () => {
		const { uri, editor } = await openMarkdownEditor();
		const target_column = (editor.viewColumn || vscode.ViewColumn.One) + 1;

		await vscode.commands.executeCommand(
			'vscode.openWith',
			uri,
			VIEW_TYPE,
			{ viewColumn: target_column, preview: false },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('openWith + computed column', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 7: openWith then moveEditorToNextGroup
	// ---------------------------------------------------------------
	test('Approach 7: vscode.openWith then moveEditorToNextGroup', async () => {
		const { uri } = await openMarkdownEditor();

		await vscode.commands.executeCommand(
			'vscode.openWith',
			uri,
			VIEW_TYPE,
		);
		await new Promise(resolve => setTimeout(resolve, 300));
		await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('openWith + moveToNextGroup', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 8: splitEditorRight then openWith (current approach)
	// ---------------------------------------------------------------
	test('Approach 8: splitEditorRight then vscode.openWith', async () => {
		const { uri } = await openMarkdownEditor();

		await vscode.commands.executeCommand('workbench.action.splitEditorRight');
		await new Promise(resolve => setTimeout(resolve, 300));
		await vscode.commands.executeCommand(
			'vscode.openWith',
			uri,
			VIEW_TYPE,
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('splitRight + openWith', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 9: splitEditorRight then createWebviewPanel in Active
	// ---------------------------------------------------------------
	test('Approach 9: splitEditorRight then createWebviewPanel in Active', async () => {
		await openMarkdownEditor();

		await vscode.commands.executeCommand('workbench.action.splitEditorRight');
		await new Promise(resolve => setTimeout(resolve, 300));

		vscode.window.createWebviewPanel(
			'experiment-9',
			'Experiment 9',
			vscode.ViewColumn.Active,
			{ enableScripts: true },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('splitRight + createWebviewPanel Active', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});

	// ---------------------------------------------------------------
	// Approach 10: like BetterFountain - createWebviewPanel in Two directly
	// (same as approach 2 but with retainContextWhenHidden)
	// ---------------------------------------------------------------
	test('Approach 10: createWebviewPanel Two + retainContextWhenHidden (BetterFountain style)', async () => {
		await openMarkdownEditor();

		vscode.window.createWebviewPanel(
			'experiment-10',
			'Experiment 10',
			vscode.ViewColumn.Two,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		await new Promise(resolve => setTimeout(resolve, 500));

		const after = groupCount();
		report('createWebviewPanel Two + retain (Fountain)', after);
		assert.ok(after >= 2, `Expected >=2 groups, got ${after}`);
	});
});

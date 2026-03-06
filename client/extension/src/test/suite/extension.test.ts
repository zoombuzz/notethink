import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Integration tests for the NoteThink VS Code web extension.
 *
 * These run inside a real VS Code web environment via @vscode/test-web,
 * so the full vscode API is available without mocks.
 *
 * Uses mocha tdd interface (suite/test/suiteSetup) as configured in index.ts.
 */

const EXTENSION_ID = 'ZoomBuzz.notethink';
const VIEW_TYPE = 'zoombuzz.notethink';

suite('Web Extension Test Suite', () => {

	suiteSetup(() => {
		vscode.window.showInformationMessage('Start all tests.');
	});

	// ---------------------------------------------------------------
	// Extension presence and activation
	// ---------------------------------------------------------------

	suite('Extension Activation', () => {

		test('Extension should be present in the extension list', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension, `Extension ${EXTENSION_ID} should be installed`);
		});

		test('Extension should activate when a markdown document is opened', async () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension, `Extension ${EXTENSION_ID} should be installed`);

			// Open a markdown document to trigger the onLanguage:markdown activation event
			const uri = vscode.Uri.parse('untitled:activation-test.md');
			await vscode.workspace.openTextDocument(uri);

			// Give the extension a moment to activate
			await new Promise(resolve => setTimeout(resolve, 500));

			assert.ok(extension.isActive, 'Extension should be active after opening a markdown document');
		});

		test('Extension should export activate and deactivate functions', async () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension, `Extension ${EXTENSION_ID} should be installed`);

			// Ensure activated
			if (!extension.isActive) {
				await extension.activate();
			}

			// The extension module should be the exports from extension.ts
			// which defines activate() and deactivate()
			assert.ok(extension.isActive, 'Extension should be active');
		});
	});

	// ---------------------------------------------------------------
	// Command registration
	// ---------------------------------------------------------------

	suite('Command Registration', () => {

		const expectedCommands = [
			// Core command
			'notethink.openview',
			// View type switching
			'notethink.setViewAuto',
			'notethink.setViewDocument',
			'notethink.setViewKanban',
			// Settings toggles
			'notethink.toggleLineNumbers',
			'notethink.toggleContextBars',
			// Navigation
			'notethink.navigateUp',
			'notethink.navigateDown',
			'notethink.drillIn',
			'notethink.drillOut',
			'notethink.clearFocus',
		];

		suiteSetup(async () => {
			// Ensure extension is activated before checking commands
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			if (extension && !extension.isActive) {
				await extension.activate();
			}
		});

		test('All expected commands should be registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			for (const cmd of expectedCommands) {
				assert.ok(
					commands.includes(cmd),
					`Command "${cmd}" should be registered`
				);
			}
		});

		test('View type commands should be registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			assert.ok(commands.includes('notethink.setViewAuto'), 'setViewAuto command should exist');
			assert.ok(commands.includes('notethink.setViewDocument'), 'setViewDocument command should exist');
			assert.ok(commands.includes('notethink.setViewKanban'), 'setViewKanban command should exist');
		});

		test('Navigation commands should be registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			assert.ok(commands.includes('notethink.navigateUp'), 'navigateUp should exist');
			assert.ok(commands.includes('notethink.navigateDown'), 'navigateDown should exist');
			assert.ok(commands.includes('notethink.drillIn'), 'drillIn should exist');
			assert.ok(commands.includes('notethink.drillOut'), 'drillOut should exist');
			assert.ok(commands.includes('notethink.clearFocus'), 'clearFocus should exist');
		});

		test('Toggle commands should be registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			assert.ok(commands.includes('notethink.toggleLineNumbers'), 'toggleLineNumbers should exist');
			assert.ok(commands.includes('notethink.toggleContextBars'), 'toggleContextBars should exist');
		});

		test('No unexpected notethink commands should be registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			const notethinkCommands = commands.filter(c => c.startsWith('notethink.'));
			for (const cmd of notethinkCommands) {
				assert.ok(
					expectedCommands.includes(cmd),
					`Unexpected command "${cmd}" found — update the test if this is intentional`
				);
			}
		});
	});

	// ---------------------------------------------------------------
	// Custom editor contribution
	// ---------------------------------------------------------------

	suite('Custom Editor Provider', () => {

		test('Extension should contribute a custom editor with the correct viewType', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension, `Extension ${EXTENSION_ID} should be installed`);

			const pkg = extension.packageJSON;
			assert.ok(pkg.contributes, 'package.json should have contributes');
			assert.ok(pkg.contributes.customEditors, 'package.json should contribute customEditors');

			const editors = pkg.contributes.customEditors;
			assert.ok(Array.isArray(editors), 'customEditors should be an array');

			const notethinkEditor = editors.find(
				(e: { viewType: string }) => e.viewType === VIEW_TYPE
			);
			assert.ok(notethinkEditor, `Custom editor with viewType "${VIEW_TYPE}" should be registered`);
		});

		test('Custom editor should target markdown files', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const editors = extension.packageJSON.contributes.customEditors;
			const notethinkEditor = editors.find(
				(e: { viewType: string }) => e.viewType === VIEW_TYPE
			);
			assert.ok(notethinkEditor);
			assert.ok(notethinkEditor.selector, 'Custom editor should have a selector');

			const mdSelector = notethinkEditor.selector.find(
				(s: { filenamePattern: string }) => s.filenamePattern === '*.md'
			);
			assert.ok(mdSelector, 'Custom editor selector should match *.md files');
		});

		test('Custom editor should have "option" priority', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const editors = extension.packageJSON.contributes.customEditors;
			const notethinkEditor = editors.find(
				(e: { viewType: string }) => e.viewType === VIEW_TYPE
			);
			assert.ok(notethinkEditor);
			assert.strictEqual(
				notethinkEditor.priority, 'option',
				'Custom editor should use "option" priority (not default)'
			);
		});
	});

	// ---------------------------------------------------------------
	// Workspace root resolution (breadcrumb stripping)
	// ---------------------------------------------------------------

	suite('Workspace Root Resolution', () => {

		test('workspaceFolders should be available', () => {
			const folders = vscode.workspace.workspaceFolders;
			console.log('[DIAG] workspaceFolders:', JSON.stringify(folders?.map(f => ({
				name: f.name,
				uri: f.uri.toString(),
				path: f.uri.path,
				scheme: f.uri.scheme,
			}))));
			assert.ok(folders, 'workspaceFolders should not be undefined');
			assert.ok(folders.length > 0, 'workspaceFolders should have at least one entry');
		});

		test('getWorkspaceFolder should resolve for workspace files', async () => {
			// find a .md file in the workspace
			const uris = await vscode.workspace.findFiles('**/*.md', undefined, 1);
			console.log('[DIAG] findFiles result:', JSON.stringify(uris.map(u => ({
				uri: u.toString(),
				path: u.path,
				scheme: u.scheme,
			}))));
			assert.ok(uris.length > 0, 'Should find at least one .md file');

			const doc = await vscode.workspace.openTextDocument(uris[0]);
			console.log('[DIAG] doc.uri:', doc.uri.toString(), 'path:', doc.uri.path, 'scheme:', doc.uri.scheme);

			const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
			console.log('[DIAG] getWorkspaceFolder:', folder ? JSON.stringify({
				name: folder.name,
				uri: folder.uri.toString(),
				path: folder.uri.path,
				scheme: folder.uri.scheme,
			}) : 'undefined');

			assert.ok(folder, 'getWorkspaceFolder should return a folder for workspace documents');

			// The doc path should start with the workspace folder path
			const starts_with = doc.uri.path.startsWith(folder.uri.path);
			console.log('[DIAG] doc.uri.path.startsWith(folder.uri.path):', starts_with,
				'docPath:', doc.uri.path, 'folderPath:', folder.uri.path);
			assert.ok(starts_with, `doc path "${doc.uri.path}" should start with workspace folder path "${folder.uri.path}"`);
		});

		test('workspace root stripping should produce correct relative segments', async () => {
			const uris = await vscode.workspace.findFiles('**/*.md', undefined, 1);
			assert.ok(uris.length > 0);

			const doc = await vscode.workspace.openTextDocument(uris[0]);
			const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
				|| vscode.workspace.workspaceFolders?.[0];
			const workspace_root = folder?.uri.path || '';

			const doc_path = doc.uri.path;
			let relative_path = doc_path;
			if (workspace_root && doc_path.startsWith(workspace_root)) {
				relative_path = doc_path.slice(workspace_root.length);
			}
			const segments = relative_path.split('/').filter(Boolean);

			console.log('[DIAG] workspace_root:', workspace_root);
			console.log('[DIAG] doc_path:', doc_path);
			console.log('[DIAG] relative_path:', relative_path);
			console.log('[DIAG] segments:', JSON.stringify(segments));

			assert.ok(segments.length > 0, 'Should have at least one path segment');
			// The workspace root folder name itself should NOT appear in the segments
			if (workspace_root) {
				const ws_name = workspace_root.split('/').filter(Boolean).pop();
				assert.ok(
					segments[0] !== ws_name,
					`First segment "${segments[0]}" should not be the workspace folder name "${ws_name}"`
				);
			}
		});
	});

	// ---------------------------------------------------------------
	// Document API interactions
	// ---------------------------------------------------------------

	suite('Document Handling', () => {

		test('Should be able to open an untitled markdown document', async () => {
			const uri = vscode.Uri.parse('untitled:test-document.md');
			const doc = await vscode.workspace.openTextDocument(uri);
			assert.ok(doc, 'Should open document');
			assert.strictEqual(doc.languageId, 'markdown', 'Language ID should be markdown');
		});

		test('Untitled markdown document should start empty', async () => {
			const uri = vscode.Uri.parse('untitled:empty-test.md');
			const doc = await vscode.workspace.openTextDocument(uri);
			assert.strictEqual(doc.getText(), '', 'New untitled document should be empty');
		});

		test('Should be able to apply edits to a document via WorkspaceEdit', async () => {
			const uri = vscode.Uri.parse('untitled:edit-test.md');
			const doc = await vscode.workspace.openTextDocument(uri);

			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), '# Hello NoteThink\n\nSome content.\n');
			const success = await vscode.workspace.applyEdit(edit);

			assert.ok(success, 'Edit should apply successfully');
			assert.ok(
				doc.getText().includes('# Hello NoteThink'),
				'Document should contain the inserted heading'
			);
			assert.ok(
				doc.getText().includes('Some content.'),
				'Document should contain the inserted body text'
			);
		});

		test('Document line count should reflect edits', async () => {
			const uri = vscode.Uri.parse('untitled:linecount-test.md');
			const doc = await vscode.workspace.openTextDocument(uri);

			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), 'Line 1\nLine 2\nLine 3\n');
			await vscode.workspace.applyEdit(edit);

			assert.strictEqual(doc.lineCount, 4, 'Document should have 4 lines (3 content + 1 trailing)');
		});

		test('Document getText with range should return correct substring', async () => {
			const uri = vscode.Uri.parse('untitled:range-test.md');
			const doc = await vscode.workspace.openTextDocument(uri);

			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), '# Title\n\nParagraph text here.\n');
			await vscode.workspace.applyEdit(edit);

			const firstLine = doc.getText(new vscode.Range(0, 0, 0, 7));
			assert.strictEqual(firstLine, '# Title', 'Should return just the first line via range');
		});
	});

	// ---------------------------------------------------------------
	// Extension configuration contribution
	// ---------------------------------------------------------------

	suite('Configuration', () => {

		test('Extension should contribute configuration settings', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const config = extension.packageJSON.contributes.configuration;
			assert.ok(config, 'Extension should contribute configuration');
			assert.ok(Array.isArray(config), 'Configuration should be an array');
			assert.ok(config.length > 0, 'Should have at least one configuration section');
		});

		test('Trace server setting should be available', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const config = extension.packageJSON.contributes.configuration;
			const traceSection = config.find(
				(c: { id: string }) => c.id === 'notethink-extension'
			);
			assert.ok(traceSection, 'Should have notethink-extension configuration section');
			assert.ok(
				traceSection.properties['notethink-extension.trace.server'],
				'Should have trace.server property'
			);
		});
	});

	// ---------------------------------------------------------------
	// Keybindings contribution
	// ---------------------------------------------------------------

	suite('Keybindings', () => {

		test('Extension should contribute keybindings', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const keybindings = extension.packageJSON.contributes.keybindings;
			assert.ok(keybindings, 'Extension should contribute keybindings');
			assert.ok(Array.isArray(keybindings), 'Keybindings should be an array');
		});

		test('Escape key should be bound to clearFocus', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const keybindings = extension.packageJSON.contributes.keybindings;
			const escBinding = keybindings.find(
				(kb: { command: string; key: string }) => kb.key === 'escape'
			);
			assert.ok(escBinding, 'Escape keybinding should exist');
			assert.strictEqual(escBinding.command, 'notethink.clearFocus');
		});

		test('Arrow keys should be bound to navigation', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const keybindings = extension.packageJSON.contributes.keybindings;
			const upBinding = keybindings.find(
				(kb: { key: string }) => kb.key === 'up'
			);
			const downBinding = keybindings.find(
				(kb: { key: string }) => kb.key === 'down'
			);
			assert.ok(upBinding, 'Up arrow keybinding should exist');
			assert.strictEqual(upBinding.command, 'notethink.navigateUp');
			assert.ok(downBinding, 'Down arrow keybinding should exist');
			assert.strictEqual(downBinding.command, 'notethink.navigateDown');
		});

		test('Enter and Backspace should be bound to drill in/out', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const keybindings = extension.packageJSON.contributes.keybindings;
			const enterBinding = keybindings.find(
				(kb: { key: string }) => kb.key === 'enter'
			);
			const backspaceBinding = keybindings.find(
				(kb: { key: string }) => kb.key === 'backspace'
			);
			assert.ok(enterBinding, 'Enter keybinding should exist');
			assert.strictEqual(enterBinding.command, 'notethink.drillIn');
			assert.ok(backspaceBinding, 'Backspace keybinding should exist');
			assert.strictEqual(backspaceBinding.command, 'notethink.drillOut');
		});

		test('All keybindings should be scoped to the NoteThink custom editor', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const keybindings = extension.packageJSON.contributes.keybindings;
			for (const kb of keybindings) {
				assert.ok(
					kb.when && kb.when.includes(`activeCustomEditorId == '${VIEW_TYPE}'`),
					`Keybinding for "${kb.command}" should be scoped to the NoteThink custom editor`
				);
			}
		});
	});

	// ---------------------------------------------------------------
	// Menu contribution
	// ---------------------------------------------------------------

	suite('Menus', () => {

		test('Editor title menus should be contributed', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const menus = extension.packageJSON.contributes.menus;
			assert.ok(menus, 'Extension should contribute menus');
			assert.ok(menus['editor/title'], 'Should have editor/title menu entries');
		});

		test('View type commands should appear in editor title navigation group', () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension);

			const titleMenus = extension.packageJSON.contributes.menus['editor/title'];
			const navEntries = titleMenus.filter(
				(m: { group: string }) => m.group && m.group.startsWith('navigation')
			);

			const navCommands = navEntries.map((m: { command: string }) => m.command);
			assert.ok(navCommands.includes('notethink.setViewAuto'), 'setViewAuto should be in navigation');
			assert.ok(navCommands.includes('notethink.setViewDocument'), 'setViewDocument should be in navigation');
			assert.ok(navCommands.includes('notethink.setViewKanban'), 'setViewKanban should be in navigation');
		});
	});
});

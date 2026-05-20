/**
 * Unit tests for NotethinkEditorProvider message handling.
 *
 * The provider's `myWebviewPanel()` method wires up message listeners on a
 * webview panel.  We exercise those listeners (editText, revealRange,
 * selectRange) by constructing a provider with a mock ExtensionContext,
 * calling `myWebviewPanel()` with a mock panel + document, and then
 * simulating incoming messages.
 */

import * as vscode from 'vscode';
import { createMockWebviewPanel, Position, Range, Selection, WorkspaceEdit, Uri } from '../__mocks__/vscode';
import { NotethinkEditorProvider } from './notethinkEditor';

// ---- helpers ----------------------------------------------------------------

/** Build a minimal mock ExtensionContext */
function mockExtensionContext(): vscode.ExtensionContext {
	return {
		extensionUri: Uri.file('/mock/extension'),
		subscriptions: [],
		extension: { packageJSON: { version: '0.0.0-test' } },
	} as unknown as vscode.ExtensionContext;
}

/**
 * Build a mock TextDocument that translates character offsets to
 * Position objects in a single-line manner for simplicity.
 */
function mockTextDocument(text: string, uriPath: string) {
	return {
		uri: Uri.file(uriPath),
		getText: jest.fn(() => text),
		positionAt: jest.fn((offset: number) => {
			// simple single-line model: line 0, character = offset
			return new Position(0, offset);
		}),
		offsetAt: jest.fn((pos: Position) => pos.character),
	};
}

/**
 * Build a mock TextEditor wrapping a document.
 */
function mockTextEditor(doc: ReturnType<typeof mockTextDocument>) {
	const editor: any = {
		document: doc,
		selection: new Selection(new Position(0, 0), new Position(0, 0)),
		edit: jest.fn(async (callback: (eb: any) => void) => {
			const editBuilder = {
				replace: jest.fn(),
				insert: jest.fn(),
				delete: jest.fn(),
			};
			callback(editBuilder);
			return true;
		}),
		revealRange: jest.fn(),
	};
	return editor;
}

// point the mocked workspace at the given roots so the host-side path-containment guard treats paths under them as in-workspace
function setWorkspaceRoots(roots: string[] | undefined) {
	(vscode.workspace as any).workspaceFolders = roots
		? roots.map((root, index) => ({ uri: Uri.file(root), name: root, index }))
		: undefined;
}

// ---- setup ------------------------------------------------------------------

const defaultDocPath = '/workspace/initial.md';
const defaultDocText = '# Initial Document\n\nSome content here.';

describe('NotethinkEditorProvider', () => {
	let provider: NotethinkEditorProvider;
	let panelHelper: ReturnType<typeof createMockWebviewPanel>;
	let debugSpy: jest.SpyInstance;

	beforeEach(async () => {
		jest.clearAllMocks();
		debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

		// set up a visible editor for the initial document so sendCurrentSelection finds it
		const initialDoc = mockTextDocument(defaultDocText, defaultDocPath);
		const initialEditor = mockTextEditor(initialDoc);
		(vscode.window as any).visibleTextEditors = [initialEditor];

		provider = new NotethinkEditorProvider(mockExtensionContext() as any);
		panelHelper = createMockWebviewPanel();

		// call myWebviewPanel with the initial document
		await (provider as any).myWebviewPanel(panelHelper.panel, initialDoc);

		// the constructor no longer pushes the initial doc - requestInitialState (sent by the webview on mount) triggers it
		await panelHelper.simulateMessage({ type: 'requestInitialState' });
	});

	afterEach(() => {
		debugSpy.mockRestore();
	});

	// ---- initial load -------------------------------------------------------

	describe('initial document load', () => {
		it('sends the initial document as an update message', () => {
			const updates = panelHelper.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const first_update = updates[0];
			const doc_entries = Object.values(first_update.partial.docs) as any[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe(defaultDocPath);
			expect(doc_entries[0].text).toBe(defaultDocText);
		});

		it('sends workspace_root in the update message', () => {
			const updates = panelHelper.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBeGreaterThanOrEqual(1);
			// When getWorkspaceFolder returns undefined, workspace_root should be ''
			expect(updates[0].workspace_root).toBe('');
		});

		it('sends an initial selectionChanged message for styled first render', () => {
			const selections = panelHelper.postedMessages.filter((m: any) => m.type === 'selectionChanged');
			expect(selections.length).toBeGreaterThanOrEqual(1);
			const first_selection = selections[0];
			expect(first_selection.docPath).toBe(defaultDocPath);
			expect(typeof first_selection.selection.head).toBe('number');
			expect(typeof first_selection.selection.anchor).toBe('number');
		});
	});

	describe('workspace_root with real workspace folder', () => {
		it('sends workspace_root from getWorkspaceFolder when available', async () => {
			// Set up getWorkspaceFolder to return a workspace folder
			const workspaceRoot = '/mnt/secure/home/alex/git/github.com/active_development';
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
				uri: Uri.file(workspaceRoot),
				name: 'active_development',
				index: 0,
			});

			const docPath = workspaceRoot + '/countingsheet/nodejs/ledger/docs/todo.md';
			const doc = mockTextDocument('# Todo', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];

			const newProvider = new NotethinkEditorProvider(mockExtensionContext() as any);
			const newPanel = createMockWebviewPanel();
			await (newProvider as any).myWebviewPanel(newPanel.panel, doc);
			await newPanel.simulateMessage({ type: 'requestInitialState' });

			const updates = newPanel.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBeGreaterThanOrEqual(1);
			expect(updates[0].workspace_root).toBe(workspaceRoot);

			// Restore mock
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
		});

		it('sets relative_path on doc when asRelativePath returns a relative path', async () => {
			const workspaceRoot = '/mnt/secure/home/alex/git/github.com/active_development';
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
				uri: Uri.file(workspaceRoot),
				name: 'active_development',
				index: 0,
			});
			// Simulate asRelativePath returning a relative path (no leading /)
			(vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('countingsheet/nodejs/ledger/docs/todo.md');

			const docPath = workspaceRoot + '/countingsheet/nodejs/ledger/docs/todo.md';
			const doc = mockTextDocument('# Todo', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];

			const newProvider = new NotethinkEditorProvider(mockExtensionContext() as any);
			const newPanel = createMockWebviewPanel();
			await (newProvider as any).myWebviewPanel(newPanel.panel, doc);
			await newPanel.simulateMessage({ type: 'requestInitialState' });

			const updates = newPanel.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const doc_entries = Object.values(updates[0].partial.docs) as any[];
			expect(doc_entries[0].relative_path).toBe('countingsheet/nodejs/ledger/docs/todo.md');

			// Restore mocks
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
			(vscode.workspace.asRelativePath as jest.Mock).mockImplementation((pathOrUri: any) => {
				const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri?.path || pathOrUri?.toString?.() || '';
				return p;
			});
		});

		it('does NOT set relative_path when asRelativePath returns an absolute path', async () => {
			// When file is outside workspace, asRelativePath returns the full absolute path
			const docPath = '/other/location/file.md';
			(vscode.workspace.asRelativePath as jest.Mock).mockReturnValue(docPath);

			const doc = mockTextDocument('# Test', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];

			const newProvider = new NotethinkEditorProvider(mockExtensionContext() as any);
			const newPanel = createMockWebviewPanel();
			await (newProvider as any).myWebviewPanel(newPanel.panel, doc);
			await newPanel.simulateMessage({ type: 'requestInitialState' });

			const updates = newPanel.postedMessages.filter((m: any) => m.type === 'update');
			const doc_entries = Object.values(updates[0].partial.docs) as any[];
			expect(doc_entries[0].relative_path).toBeUndefined();

			// Restore mock
			(vscode.workspace.asRelativePath as jest.Mock).mockImplementation((pathOrUri: any) => {
				const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri?.path || pathOrUri?.toString?.() || '';
				return p;
			});
		});
	});

	// ---- editText -----------------------------------------------------------

	describe('editText message', () => {
		const docPath = '/workspace/test.md';
		const docText = 'Hello World';

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('uses editor.edit() when a visible editor exists', async () => {
			const doc = mockTextDocument(docText, docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [{ from: 5, to: 11, insert: ' Jest' }],
			});

			expect(editor.edit).toHaveBeenCalledTimes(1);
			// WorkspaceEdit.applyEdit should NOT have been called
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('uses WorkspaceEdit when no visible editor exists', async () => {
			const doc = mockTextDocument(docText, docPath);
			(vscode.window as any).visibleTextEditors = [];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [{ from: 5, to: 11, insert: ' Jest' }],
			});

			expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
		});

		it('sorts changes end-to-start to preserve offsets', async () => {
			const doc = mockTextDocument('abcdefghij', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [
					{ from: 0, to: 3, insert: 'XYZ' },
					{ from: 7, to: 10, insert: '!!!' },
				],
			});

			// The edit callback receives sorted changes (highest from first)
			expect(editor.edit).toHaveBeenCalledTimes(1);
			const editCallback = editor.edit.mock.calls[0][0];
			const editBuilder = { replace: jest.fn(), insert: jest.fn(), delete: jest.fn() };
			editCallback(editBuilder);
			// First replace should be at offset 7 (the higher offset)
			expect(editBuilder.replace.mock.calls[0][0].start.character).toBe(7);
			// Second replace should be at offset 0
			expect(editBuilder.replace.mock.calls[1][0].start.character).toBe(0);
		});

		it('uses insert (not replace) when change has no "to" field', async () => {
			const doc = mockTextDocument(docText, docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [{ from: 5, insert: ' inserted' }],
			});

			expect(editor.edit).toHaveBeenCalledTimes(1);
			const editCallback = editor.edit.mock.calls[0][0];
			const editBuilder = { replace: jest.fn(), insert: jest.fn(), delete: jest.fn() };
			editCallback(editBuilder);
			expect(editBuilder.insert).toHaveBeenCalledTimes(1);
			expect(editBuilder.replace).not.toHaveBeenCalled();
		});

		it('handles errors without crashing', async () => {
			(vscode.workspace.openTextDocument as jest.Mock).mockRejectedValue(new Error('file not found'));

			// Should not throw
			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: '/workspace/nonexistent.md',
				changes: [{ from: 0, insert: 'x' }],
			});
		});
	});

	// ---- revealRange --------------------------------------------------------

	describe('revealRange message', () => {
		const docPath = '/workspace/test.md';

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('sets selection and calls revealRange on an existing editor', async () => {
			const doc = mockTextDocument('Hello World', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath,
				from: 0,
				to: 5,
			});

			expect(editor.revealRange).toHaveBeenCalledTimes(1);
		});

		it('does nothing when no existing editor is visible', async () => {
			(vscode.window as any).visibleTextEditors = [];

			// Should not throw
			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath,
				from: 0,
				to: 5,
			});

			// No editor to call revealRange on, so nothing should happen
		});

		it('uses from as both start and end when to is absent', async () => {
			const doc = mockTextDocument('Hello World', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath,
				from: 3,
			});

			expect(editor.revealRange).toHaveBeenCalledTimes(1);
			// Selection should have same anchor and active when from === to
			expect(editor.selection.anchor.character).toBe(3);
			expect(editor.selection.active.character).toBe(3);
		});
	});

	// ---- selectRange --------------------------------------------------------

	describe('selectRange message', () => {
		const docPath = '/workspace/test.md';

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('sets selection with head !== anchor (reversed)', async () => {
			const doc = mockTextDocument('Hello World', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as any).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({
				type: 'selectRange',
				docPath,
				from: 2,
				to: 8,
			});

			// When from !== to, Selection(end_pos, start_pos) is used
			// anchor = end_pos (8), active = start_pos (2)
			expect(editor.selection.anchor.character).toBe(8);
			expect(editor.selection.active.character).toBe(2);
			expect(editor.revealRange).toHaveBeenCalledTimes(1);
		});

		it('does nothing when no existing editor is visible', async () => {
			(vscode.window as any).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'selectRange',
				docPath,
				from: 0,
				to: 5,
			});
		});
	});

	// ---- setIntegration aggregate filters -----------------------------------

	describe('setIntegration aggregate filters', () => {
		const DEFAULT_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,dist,build,out,.next,.cache,coverage}/**';
		const flush = () => new Promise(resolve => setImmediate(resolve));

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('uses the default include/exclude when the message carries none', async () => {
			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();

			const find_call = (vscode.workspace.findFiles as jest.Mock).mock.calls[0];
			expect(find_call[0].pattern).toBe('**/*.md');
			expect(find_call[1]).toBe(DEFAULT_EXCLUDE);

			const update = panelHelper.postedMessages.filter((m: any) => m.type === 'update').pop();
			expect(update.aggregate_include).toBe('**/*.md');
			expect(update.aggregate_exclude).toBe(DEFAULT_EXCLUDE);
		});

		it('passes a custom include and treats an empty exclude as no exclusions (null)', async () => {
			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({
				type: 'setIntegration', mode: 'folder', path: '/workspace/notes',
				include: '**/users/**', exclude: '',
			});
			await flush();

			const find_call = (vscode.workspace.findFiles as jest.Mock).mock.calls[0];
			expect(find_call[0].pattern).toBe('**/users/**');
			expect(find_call[1]).toBeNull();

			const update = panelHelper.postedMessages.filter((m: any) => m.type === 'update').pop();
			expect(update.aggregate_include).toBe('**/users/**');
			expect(update.aggregate_exclude).toBe('');
		});

		it('falls back to the default include when an empty include is sent', async () => {
			await panelHelper.simulateMessage({
				type: 'setIntegration', mode: 'folder', path: '/workspace/notes',
				include: '', exclude: '**/skip/**',
			});
			await flush();

			const find_call = (vscode.workspace.findFiles as jest.Mock).mock.calls[0];
			expect(find_call[0].pattern).toBe('**/*.md');
			expect(find_call[1]).toBe('**/skip/**');
		});

		it('retains the user filters across a breadcrumb re-narrow that omits them', async () => {
			await panelHelper.simulateMessage({
				type: 'setIntegration', mode: 'folder', path: '/workspace/notes',
				include: '**/users/**', exclude: '',
			});
			await flush();
			// a breadcrumb segment click re-narrows to a subdirectory without carrying filters
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes/users' });
			await flush();

			const second_call = (vscode.workspace.findFiles as jest.Mock).mock.calls[1];
			expect(second_call[0].pattern).toBe('**/users/**');
			expect(second_call[1]).toBeNull();
		});

		it('switching to current_file tears down the aggregate and re-sends the active doc as a replace', async () => {
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();

			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'current_file' });
			await flush();

			// the active doc is re-sent with no merge_strategy so the webview replaces (prunes) the stale aggregate docs
			const update = panelHelper.postedMessages.find((m: any) => m.type === 'update');
			expect(update).toBeDefined();
			expect(update.merge_strategy).toBeUndefined();
			const doc_entries = Object.values(update.partial.docs) as any[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe(defaultDocPath);
		});
	});

	// ---- security: webview path containment ---------------------------------

	describe('webview path containment (security hardening)', () => {
		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('editText refuses an out-of-workspace path', async () => {
			(vscode.window as any).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: '/etc/shadow',
				changes: [{ from: 0, insert: 'pwned' }],
			});

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('editText refuses an in-workspace non-markdown path', async () => {
			(vscode.window as any).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: '/workspace/secrets.txt',
				changes: [{ from: 0, insert: 'pwned' }],
			});

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('revealRange refuses an out-of-workspace path', async () => {
			(vscode.window as any).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath: '/home/victim/.ssh/id_rsa',
				from: 0,
				to: 5,
			});

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});

		it('setIntegration refuses an out-of-workspace folder', async () => {
			await panelHelper.simulateMessage({
				type: 'setIntegration',
				mode: 'folder',
				path: '/etc',
			});

			expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
			expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
		});

		it('openExternal opens an allowed https URL', async () => {
			await panelHelper.simulateMessage({
				type: 'openExternal',
				url: 'https://example.com/page',
			});

			expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
		});

		it('openExternal refuses a file: URL', async () => {
			await panelHelper.simulateMessage({
				type: 'openExternal',
				url: 'file:///etc/passwd',
			});

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});

		it('openExternal refuses a vscode: URL', async () => {
			await panelHelper.simulateMessage({
				type: 'openExternal',
				url: 'vscode://evil/path',
			});

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});
	});

	// ---- requestInitialState ------------------------------------------------

	describe('requestInitialState message', () => {
		it('sends update and selection messages back to webview', async () => {
			panelHelper.postedMessages.length = 0;

			await panelHelper.simulateMessage({ type: 'requestInitialState' });

			expect(panelHelper.panel.webview.postMessage).toHaveBeenCalled();
			const update_msg = panelHelper.postedMessages.find((m: any) => m.type === 'update');
			expect(update_msg).toBeDefined();
			expect(update_msg.partial.docs).toBeDefined();
			const doc_entries = Object.values(update_msg.partial.docs) as any[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe(defaultDocPath);

			const selection_msg = panelHelper.postedMessages.find((m: any) => m.type === 'selectionChanged');
			expect(selection_msg).toBeDefined();
			expect(selection_msg.docPath).toBe(defaultDocPath);
		});
	});

	// ---- sendCommandToActiveWebview -----------------------------------------

	describe('sendCommandToActiveWebview()', () => {
		it('posts a command message to the active panel', () => {
			panelHelper.postedMessages.length = 0;

			provider.sendCommandToActiveWebview('testCommand', { key: 'value' });

			const msg = panelHelper.postedMessages[panelHelper.postedMessages.length - 1];
			expect(msg.type).toBe('command');
			expect(msg.command).toBe('testCommand');
			expect(msg.key).toBe('value');
		});

		it('does nothing when no active panel exists', () => {
			// Simulate panel disposal
			panelHelper.simulateDispose();

			// Should not throw
			provider.sendCommandToActiveWebview('testCommand');
		});
	});

	// ---- getHtmlForWebview --------------------------------------------------

	describe('getHtmlForWebview()', () => {
		it('returns HTML containing the nonce and script tag', () => {
			const html = panelHelper.panel.webview.html as string;
			expect(html).toContain('<!DOCTYPE html>');
			expect(html).toContain('<div id="root"></div>');
			expect(html).toContain('nonce-');
			expect(html).toContain('Content-Security-Policy');
		});
	});

	// ---- active editor switching --------------------------------------------

	describe('active editor switching', () => {
		let onActiveEditorCallback: (editor: any) => Promise<void>;

		beforeEach(() => {
			onActiveEditorCallback = (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mock.calls[0][0];
		});

		it('switches document when a different .md editor becomes active', async () => {
			const newDoc = mockTextDocument('# New File', '/workspace/new.md');
			const newEditor = mockTextEditor(newDoc);
			(vscode.window as any).visibleTextEditors = [newEditor];

			panelHelper.postedMessages.length = 0;

			await onActiveEditorCallback(newEditor);

			const update = panelHelper.postedMessages.find((m: any) => m.type === 'update');
			expect(update).toBeDefined();
			const doc_entries = Object.values(update.partial.docs) as any[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe('/workspace/new.md');

			const selection = panelHelper.postedMessages.find((m: any) => m.type === 'selectionChanged');
			expect(selection).toBeDefined();
			expect(selection.docPath).toBe('/workspace/new.md');
		});

		it('ignores non-.md editors', async () => {
			const jsonDoc = mockTextDocument('{}', '/workspace/test.json');
			const jsonEditor = mockTextEditor(jsonDoc);

			panelHelper.postedMessages.length = 0;

			await onActiveEditorCallback(jsonEditor);

			expect(panelHelper.postedMessages.length).toBe(0);
		});

		it('ignores when same document is already active', async () => {
			const sameDoc = mockTextDocument(defaultDocText, defaultDocPath);
			const sameEditor = mockTextEditor(sameDoc);

			panelHelper.postedMessages.length = 0;

			await onActiveEditorCallback(sameEditor);

			expect(panelHelper.postedMessages.length).toBe(0);
		});

		it('ignores undefined editor', async () => {
			panelHelper.postedMessages.length = 0;

			await onActiveEditorCallback(undefined);

			expect(panelHelper.postedMessages.length).toBe(0);
		});
	});

	// ---- document change tracking -------------------------------------------

	describe('document change tracking', () => {
		let onChangeCallback: (e: { document: ReturnType<typeof mockTextDocument> }) => void;

		beforeEach(() => {
			onChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];
		});

		it('re-parses active document after debounce', async () => {
			const changedDoc = mockTextDocument('# Updated Content', defaultDocPath);

			panelHelper.postedMessages.length = 0;

			onChangeCallback({ document: changedDoc });

			// immediately after: no update yet (debounce pending)
			expect(panelHelper.postedMessages.length).toBe(0);

			// wait for debounce (250ms + buffer)
			await new Promise(resolve => setTimeout(resolve, 350));

			const updates = panelHelper.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBe(1);
			const doc_entries = Object.values(updates[0].partial.docs) as any[];
			expect(doc_entries[0].text).toBe('# Updated Content');
		});

		it('ignores changes to non-active documents', async () => {
			const otherDoc = mockTextDocument('# Other File', '/workspace/other.md');

			panelHelper.postedMessages.length = 0;

			onChangeCallback({ document: otherDoc });

			await new Promise(resolve => setTimeout(resolve, 350));

			expect(panelHelper.postedMessages.length).toBe(0);
		});

		it('debounce resets on rapid changes', async () => {
			panelHelper.postedMessages.length = 0;

			const change1 = mockTextDocument('# First change', defaultDocPath);
			onChangeCallback({ document: change1 });

			await new Promise(resolve => setTimeout(resolve, 100));

			const change2 = mockTextDocument('# Second change', defaultDocPath);
			onChangeCallback({ document: change2 });

			await new Promise(resolve => setTimeout(resolve, 350));

			const updates = panelHelper.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBe(1);
			const doc_entries = Object.values(updates[0].partial.docs) as any[];
			expect(doc_entries[0].text).toBe('# Second change');
		});
	});

	// ---- selection tracking -------------------------------------------------

	describe('selection tracking', () => {
		let onSelectionCallback: (e: any) => void;

		beforeEach(() => {
			jest.useFakeTimers();
			onSelectionCallback = (vscode.window.onDidChangeTextEditorSelection as jest.Mock).mock.calls[0][0];
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it('forwards selection changes for the active document', () => {
			const doc = mockTextDocument(defaultDocText, defaultDocPath);
			panelHelper.postedMessages.length = 0;

			onSelectionCallback({
				textEditor: {
					document: doc,
					selection: new Selection(new Position(0, 5), new Position(0, 10)),
				},
				selections: [new Selection(new Position(0, 5), new Position(0, 10))],
			});

			jest.advanceTimersByTime(150);

			const selection = panelHelper.postedMessages.find((m: any) => m.type === 'selectionChanged');
			expect(selection).toBeDefined();
			expect(selection.docPath).toBe(defaultDocPath);
		});

		it('debounces rapid selection changes and only sends the last one', () => {
			const doc = mockTextDocument(defaultDocText, defaultDocPath);
			panelHelper.postedMessages.length = 0;

			// Fire three rapid selection changes
			for (const offset of [5, 10, 15]) {
				onSelectionCallback({
					textEditor: {
						document: doc,
						selection: new Selection(new Position(0, offset), new Position(0, offset)),
					},
					selections: [new Selection(new Position(0, offset), new Position(0, offset))],
				});
			}

			jest.advanceTimersByTime(150);

			// Only the last one should have been sent
			const selectionMessages = panelHelper.postedMessages.filter((m: any) => m.type === 'selectionChanged');
			expect(selectionMessages).toHaveLength(1);
			expect(selectionMessages[0].selection.head).toBe(15);
		});

		it('ignores selection changes for non-active documents', () => {
			const otherDoc = mockTextDocument('other', '/workspace/other.md');
			panelHelper.postedMessages.length = 0;

			onSelectionCallback({
				textEditor: {
					document: otherDoc,
					selection: new Selection(new Position(0, 0), new Position(0, 0)),
				},
				selections: [new Selection(new Position(0, 0), new Position(0, 0))],
			});

			jest.advanceTimersByTime(150);

			expect(panelHelper.postedMessages.length).toBe(0);
		});
	});

	// ---- active-file watcher lifecycle --------------------------------------

	describe('active-file watcher', () => {
		const docPath = '/workspace/lonely.md';
		const docText = '# Lonely';

		function makeWatcher() {
			return {
				onDidCreate: jest.fn(),
				onDidChange: jest.fn(),
				onDidDelete: jest.fn(),
				dispose: jest.fn(),
			};
		}

		// build a panel for a doc with no visible editor — the precondition that arms the watcher
		async function setupUnvisitedDoc(opts: { settingOn?: boolean } = {}) {
			const setting_on = opts.settingOn ?? true;
			(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
				get: jest.fn((_key: string, fallback: unknown) => {
					if (_key === 'watchUnopenedFilesInViewer') { return setting_on; }
					return fallback;
				}),
				update: jest.fn(async () => {}),
			});
			(vscode.window as any).visibleTextEditors = [];
			const doc = mockTextDocument(docText, docPath);
			const local_provider = new NotethinkEditorProvider(mockExtensionContext() as any);
			const local_panel = createMockWebviewPanel();
			await (local_provider as any).myWebviewPanel(local_panel.panel, doc);
			await local_panel.simulateMessage({ type: 'requestInitialState' });
			return { provider: local_provider, panel: local_panel, doc };
		}

		beforeEach(() => {
			setWorkspaceRoots(['/workspace']);
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation(() => makeWatcher());
		});
		afterEach(() => {
			setWorkspaceRoots(undefined);
			(vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
				get: jest.fn(() => undefined),
				update: jest.fn(async () => {}),
			}));
		});

		it('arms a file-system watcher for the active file when no visible editor exists', async () => {
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
			await setupUnvisitedDoc();
			const calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls;
			expect(calls.length).toBeGreaterThanOrEqual(1);
			const last = calls[calls.length - 1][0];
			// RelativePattern over the parent folder, narrowed to the file name
			expect(last?.base).toBe('/workspace');
			expect(last?.pattern).toBe('lonely.md');
		});

		it('does NOT arm a watcher when the active file is already visible in a text editor', async () => {
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
			// the outer beforeEach already configured visibleTextEditors = [initialEditor] for defaultDocPath
			// since the default panelHelper's active path is visible, no watcher should be armed
			expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length).toBe(0);
		});

		it('does NOT arm a watcher when the setting is off', async () => {
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
			await setupUnvisitedDoc({ settingOn: false });
			expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length).toBe(0);
		});

		it('re-parses the active doc when the watcher fires onDidChange', async () => {
			const { panel } = await setupUnvisitedDoc();
			const watcher_instance = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			const on_change_cb = watcher_instance.onDidChange.mock.calls[0][0];

			const updated_doc = mockTextDocument('# Lonely updated', docPath);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(updated_doc);

			panel.postedMessages.length = 0;
			await on_change_cb(Uri.file(docPath));

			const updates = panel.postedMessages.filter((m: any) => m.type === 'update');
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const doc_entries = Object.values(updates[0].partial.docs) as any[];
			expect(doc_entries[0].text).toBe('# Lonely updated');
		});

		it('disposes the watcher when the setting flips off via configuration change', async () => {
			await setupUnvisitedDoc();
			const watcher_instance = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			expect(watcher_instance.dispose).not.toHaveBeenCalled();

			// flip the underlying config to off, then trigger the config-change callback
			(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
				get: jest.fn(() => false),
				update: jest.fn(async () => {}),
			});
			const on_config_cb = (vscode.workspace.onDidChangeConfiguration as jest.Mock).mock.calls.slice(-1)[0][0];
			on_config_cb({ affectsConfiguration: (key: string) => key === 'notethink.watchUnopenedFilesInViewer' });

			expect(watcher_instance.dispose).toHaveBeenCalledTimes(1);
		});

		it('arms a watcher when the setting flips on via configuration change', async () => {
			const { provider: _provider } = await setupUnvisitedDoc({ settingOn: false });
			const initial_calls = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length;
			expect(initial_calls).toBe(0);

			(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
				get: jest.fn(() => true),
				update: jest.fn(async () => {}),
			});
			const on_config_cb = (vscode.workspace.onDidChangeConfiguration as jest.Mock).mock.calls.slice(-1)[0][0];
			on_config_cb({ affectsConfiguration: (key: string) => key === 'notethink.watchUnopenedFilesInViewer' });

			expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length).toBe(1);
		});

		it('disposes the watcher when entering folder (aggregate) mode', async () => {
			const { panel } = await setupUnvisitedDoc();
			const watcher_instance = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;

			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
			await panel.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace' });
			await new Promise(resolve => setImmediate(resolve));

			expect(watcher_instance.dispose).toHaveBeenCalledTimes(1);
		});

		it('disposes the watcher when the editor panel is disposed', async () => {
			const { panel } = await setupUnvisitedDoc();
			const watcher_instance = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			panel.simulateDispose();
			expect(watcher_instance.dispose).toHaveBeenCalledTimes(1);
		});

		it('re-evaluates when the visible-editor set changes (visible→hidden re-arms; hidden→visible disposes)', async () => {
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
			// start with no visible editor → watcher armed on first sync
			await setupUnvisitedDoc();
			const first_watcher = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;

			// now simulate an editor becoming visible for the same file
			const editor = mockTextEditor(mockTextDocument(docText, docPath));
			(vscode.window as any).visibleTextEditors = [editor];
			const on_visible_cb = (vscode.window.onDidChangeVisibleTextEditors as jest.Mock).mock.calls.slice(-1)[0][0];
			on_visible_cb([editor]);

			expect(first_watcher.dispose).toHaveBeenCalledTimes(1);
		});
	});
});

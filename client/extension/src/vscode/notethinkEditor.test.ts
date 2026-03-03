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

		it('sends an initial selectionChanged message for styled first render', () => {
			const selections = panelHelper.postedMessages.filter((m: any) => m.type === 'selectionChanged');
			expect(selections.length).toBeGreaterThanOrEqual(1);
			const first_selection = selections[0];
			expect(first_selection.docPath).toBe(defaultDocPath);
			expect(typeof first_selection.selection.head).toBe('number');
			expect(typeof first_selection.selection.anchor).toBe('number');
		});
	});

	// ---- editText -----------------------------------------------------------

	describe('editText message', () => {
		const docPath = '/workspace/test.md';
		const docText = 'Hello World';

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
				docPath: '/nonexistent.md',
				changes: [{ from: 0, insert: 'x' }],
			});
		});
	});

	// ---- revealRange --------------------------------------------------------

	describe('revealRange message', () => {
		const docPath = '/workspace/test.md';

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
			onSelectionCallback = (vscode.window.onDidChangeTextEditorSelection as jest.Mock).mock.calls[0][0];
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

			const selection = panelHelper.postedMessages.find((m: any) => m.type === 'selectionChanged');
			expect(selection).toBeDefined();
			expect(selection.docPath).toBe(defaultDocPath);
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

			expect(panelHelper.postedMessages.length).toBe(0);
		});
	});
});

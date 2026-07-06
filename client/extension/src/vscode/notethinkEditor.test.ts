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
import { createMockWebviewPanel, Position, Selection, Uri } from '../__mocks__/vscode';
import { NotethinkEditorProvider } from './notethinkEditor';
import { DEFAULT_EXCLUDE_FILTER } from '../constants';

// ---- helpers ----------------------------------------------------------------

type MockTextDocument = {
	uri: Uri;
	getText: jest.Mock<string, []>;
	positionAt: jest.Mock<Position, [number]>;
	offsetAt: jest.Mock<number, [Position]>;
};

type EditBuilder = {
	replace: jest.Mock;
	insert: jest.Mock;
	delete: jest.Mock;
};

type MockTextEditor = {
	document: MockTextDocument;
	selection: Selection;
	edit: jest.Mock<Promise<boolean>, [(eb: EditBuilder) => void]>;
	revealRange: jest.Mock;
};

type WorkspaceMutable = {
	workspaceFolders: Array<{ uri: Uri; name: string; index: number }> | undefined;
};

type WindowMutable = {
	visibleTextEditors: MockTextEditor[];
};

/** Generic message record posted to or arriving on the webview. */
type MessageRecord = Record<string, unknown>;
/** Shape of update messages (helps narrow `partial.docs` lookups). */
type UpdateDocEntry = {
	path: string;
	text?: string;
	relative_path?: string;
	createdBy?: string;
	[key: string]: unknown;
};
type UpdatePartial = { docs: Record<string, UpdateDocEntry> };
type UpdateMessage = MessageRecord & {
	type: 'update';
	partial: UpdatePartial;
	workspace_root?: string;
	merge_strategy?: string;
	include_filter?: string;
	exclude_filter?: string | null;
	aggregate_total_discovered?: number;
	aggregate_truncated?: boolean;
};
type SelectionMessage = MessageRecord & {
	type: 'selectionChanged';
	docPath: string;
	selection: { head: number; anchor: number };
};

function getUpdates(msgs: MessageRecord[]): UpdateMessage[] {
	return msgs.filter(m => m.type === 'update') as UpdateMessage[];
}
function getSelections(msgs: MessageRecord[]): SelectionMessage[] {
	return msgs.filter(m => m.type === 'selectionChanged') as SelectionMessage[];
}
function findUpdate(msgs: MessageRecord[]): UpdateMessage | undefined {
	return msgs.find(m => m.type === 'update') as UpdateMessage | undefined;
}
function findSelection(msgs: MessageRecord[]): SelectionMessage | undefined {
	return msgs.find(m => m.type === 'selectionChanged') as SelectionMessage | undefined;
}
function findByType(msgs: MessageRecord[], type: string): MessageRecord | undefined {
	return msgs.find(m => m.type === type);
}

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
function mockTextDocument(text: string, uriPath: string): MockTextDocument {
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
function mockTextEditor(doc: MockTextDocument): MockTextEditor {
	const editor: MockTextEditor = {
		document: doc,
		selection: new Selection(new Position(0, 0), new Position(0, 0)),
		edit: jest.fn(async (callback: (eb: EditBuilder) => void) => {
			const editBuilder: EditBuilder = {
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
function setWorkspaceRoots(roots: string[] | undefined): void {
	(vscode.workspace as unknown as WorkspaceMutable).workspaceFolders = roots
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
		(vscode.window as unknown as WindowMutable).visibleTextEditors = [initialEditor];

		provider = new NotethinkEditorProvider(mockExtensionContext());
		panelHelper = createMockWebviewPanel();

		// call myWebviewPanel with the initial document
		await (provider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(panelHelper.panel, initialDoc);

		// the constructor no longer pushes the initial doc - requestInitialState (sent by the webview on mount) triggers it
		await panelHelper.simulateMessage({ type: 'requestInitialState' });
	});

	afterEach(() => {
		debugSpy.mockRestore();
	});

	// ---- initial load -------------------------------------------------------

	describe('initial document load', () => {
		it('sends the initial document as an update message', () => {
			const updates = getUpdates(panelHelper.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const first_update = updates[0];
			const doc_entries = Object.values(first_update.partial.docs) as UpdateDocEntry[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe(defaultDocPath);
			expect(doc_entries[0].text).toBe(defaultDocText);
		});

		it('sends workspace_root in the update message', () => {
			const updates = getUpdates(panelHelper.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			// when getWorkspaceFolder returns undefined, workspace_root should be ''
			expect(updates[0].workspace_root).toBe('');
		});

		it('sends an initial selectionChanged message for styled first render', () => {
			const selections = getSelections(panelHelper.postedMessages);
			expect(selections.length).toBeGreaterThanOrEqual(1);
			const first_selection = selections[0];
			expect(first_selection.docPath).toBe(defaultDocPath);
			expect(typeof first_selection.selection.head).toBe('number');
			expect(typeof first_selection.selection.anchor).toBe('number');
		});
	});

	describe('workspace_root with real workspace folder', () => {
		it('sends workspace_root from getWorkspaceFolder when available', async () => {
			// set up getWorkspaceFolder to return a workspace folder
			const workspaceRoot = '/mnt/secure/home/alex/git/github.com/active_development';
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
				uri: Uri.file(workspaceRoot),
				name: 'active_development',
				index: 0,
			});

			const docPath = workspaceRoot + '/countingsheet/nodejs/ledger/docs/todo.md';
			const doc = mockTextDocument('# Todo', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			const newProvider = new NotethinkEditorProvider(mockExtensionContext());
			const newPanel = createMockWebviewPanel();
			await (newProvider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(newPanel.panel, doc);
			await newPanel.simulateMessage({ type: 'requestInitialState' });

			const updates = getUpdates(newPanel.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			expect(updates[0].workspace_root).toBe(workspaceRoot);

			// restore mock
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
		});

		it('sets relative_path on doc when asRelativePath returns a relative path', async () => {
			const workspaceRoot = '/mnt/secure/home/alex/git/github.com/active_development';
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
				uri: Uri.file(workspaceRoot),
				name: 'active_development',
				index: 0,
			});
			// simulate asRelativePath returning a relative path (no leading /)
			(vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('countingsheet/nodejs/ledger/docs/todo.md');

			const docPath = workspaceRoot + '/countingsheet/nodejs/ledger/docs/todo.md';
			const doc = mockTextDocument('# Todo', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			const newProvider = new NotethinkEditorProvider(mockExtensionContext());
			const newPanel = createMockWebviewPanel();
			await (newProvider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(newPanel.panel, doc);
			await newPanel.simulateMessage({ type: 'requestInitialState' });

			const updates = getUpdates(newPanel.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].relative_path).toBe('countingsheet/nodejs/ledger/docs/todo.md');

			// restore mocks
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
			(vscode.workspace.asRelativePath as jest.Mock).mockImplementation((pathOrUri: unknown) => {
				const u = pathOrUri as { path?: string; toString?: () => string } | string | undefined;
				const p = typeof u === 'string' ? u : u?.path || u?.toString?.() || '';
				return p;
			});
		});

		it('does NOT set relative_path when asRelativePath returns an absolute path', async () => {
			// when file is outside workspace, asRelativePath returns the full absolute path
			const docPath = '/other/location/file.md';
			(vscode.workspace.asRelativePath as jest.Mock).mockReturnValue(docPath);

			const doc = mockTextDocument('# Test', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			const newProvider = new NotethinkEditorProvider(mockExtensionContext());
			const newPanel = createMockWebviewPanel();
			await (newProvider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(newPanel.panel, doc);
			await newPanel.simulateMessage({ type: 'requestInitialState' });

			const updates = getUpdates(newPanel.postedMessages);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].relative_path).toBeUndefined();

			// restore mock
			(vscode.workspace.asRelativePath as jest.Mock).mockImplementation((pathOrUri: unknown) => {
				const u = pathOrUri as { path?: string; toString?: () => string } | string | undefined;
				const p = typeof u === 'string' ? u : u?.path || u?.toString?.() || '';
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
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [{ from: 5, to: 11, insert: ' Jest' }],
			});

			expect(editor.edit).toHaveBeenCalledTimes(1);
			// WorkspaceEdit.applyEdit should NOT have been called (WorkspaceEdit is a vscode class - proper noun)
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('uses WorkspaceEdit when no visible editor exists', async () => {
			const doc = mockTextDocument(docText, docPath);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
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
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [
					{ from: 0, to: 3, insert: 'XYZ' },
					{ from: 7, to: 10, insert: '!!!' },
				],
			});

			// the edit callback receives sorted changes (highest from first)
			expect(editor.edit).toHaveBeenCalledTimes(1);
			const editCallback = editor.edit.mock.calls[0][0];
			const editBuilder = { replace: jest.fn(), insert: jest.fn(), delete: jest.fn() };
			editCallback(editBuilder);
			// first replace should be at offset 7 (the higher offset)
			expect(editBuilder.replace.mock.calls[0][0].start.character).toBe(7);
			// second replace should be at offset 0
			expect(editBuilder.replace.mock.calls[1][0].start.character).toBe(0);
		});

		it('uses insert (not replace) when change has no "to" field', async () => {
			const doc = mockTextDocument(docText, docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
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

			// should not throw
			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: '/workspace/nonexistent.md',
				changes: [{ from: 0, insert: 'x' }],
			});
		});

		// regression: legacy single-doc payload (docPath + changes) still applies one edit
		it('single-doc payload still applies a single edit', async () => {
			const doc = mockTextDocument(docText, docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath,
				changes: [{ from: 0, to: 5, insert: 'Howdy' }],
			});

			expect(editor.edit).toHaveBeenCalledTimes(1);
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		// editing the active doc re-emits the updated doc plus a fresh selection so the webview never holds stale MDAST
		it('re-emits an update for the edited active doc and a selectionChanged', async () => {
			const doc = mockTextDocument(defaultDocText, defaultDocPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: defaultDocPath,
				changes: [{ from: 0, to: 5, insert: 'XXXXX' }],
			});

			const update = findUpdate(panelHelper.postedMessages);
			expect(update).toBeDefined();
			const doc_entries = Object.values(update.partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].path).toBe(defaultDocPath);
			const selection = findSelection(panelHelper.postedMessages);
			expect(selection).toBeDefined();
			expect(selection.docPath).toBe(defaultDocPath);
		});

		// the edit clears the debounce timer so a queued onDidChangeTextDocument re-parse cannot re-emit a delayed stale update after the batch
		it('clears the pending change-debounce timer so no delayed update follows the edit', async () => {
			const change_cb = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls.slice(-1)[0][0];
			const doc = mockTextDocument(defaultDocText, defaultDocPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);

			// arm the debounce timer first, then apply an edit that should clear it
			change_cb({ document: mockTextDocument('# pending', defaultDocPath) });
			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: defaultDocPath,
				changes: [{ from: 0, to: 5, insert: 'YYYYY' }],
			});

			panelHelper.postedMessages.length = 0;
			await new Promise(resolve => setTimeout(resolve, 350));
			const delayed = getUpdates(panelHelper.postedMessages);
			expect(delayed.length).toBe(0);
		});
	});

	// ---- editText multi-doc batch ------------------------------------------------

	describe('editText multi-doc batch', () => {
		const docPathA = '/workspace/a.md';
		const docPathB = '/workspace/b.md';
		const docTextA = 'Alpha contents';
		const docTextB = 'Bravo contents';

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		// dispatch openTextDocument by uri so the batch can read each doc back individually
		function rigOpenByPath(docs_by_path: Record<string, ReturnType<typeof mockTextDocument>>): void {
			(vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (arg: unknown) => {
				const a = arg as { path?: string; fsPath?: string; toString?: () => string } | string | undefined;
				const target_path: string = typeof a === 'string' ? a : (a?.path || a?.fsPath || a?.toString?.() || '');
				const found = docs_by_path[target_path];
				if (!found) {
					throw new Error(`no mock doc for ${target_path}`);
				}
				return found;
			});
		}

		it('applies edits to every named doc in the batch', async () => {
			const docA = mockTextDocument(docTextA, docPathA);
			const docB = mockTextDocument(docTextB, docPathB);
			const editorA = mockTextEditor(docA);
			const editorB = mockTextEditor(docB);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editorA, editorB];
			rigOpenByPath({ [docPathA]: docA, [docPathB]: docB });

			await panelHelper.simulateMessage({
				type: 'editText',
				changes_by_doc: {
					[docPathA]: [{ from: 0, to: 5, insert: 'AAAAA' }],
					[docPathB]: [{ from: 0, to: 5, insert: 'BBBBB' }],
				},
			});

			expect(editorA.edit).toHaveBeenCalledTimes(1);
			expect(editorB.edit).toHaveBeenCalledTimes(1);
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('re-emits sendDoc for every touched doc in the batch', async () => {
			const docA = mockTextDocument(docTextA, docPathA);
			const docB = mockTextDocument(docTextB, docPathB);
			const editorA = mockTextEditor(docA);
			const editorB = mockTextEditor(docB);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editorA, editorB];
			rigOpenByPath({ [docPathA]: docA, [docPathB]: docB });

			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({
				type: 'editText',
				changes_by_doc: {
					[docPathA]: [{ from: 0, to: 5, insert: 'AAAAA' }],
					[docPathB]: [{ from: 0, to: 5, insert: 'BBBBB' }],
				},
			});

			const updates = getUpdates(panelHelper.postedMessages);
			const touched_paths = new Set<string>();
			for (const update of updates) {
				for (const entry of Object.values(update.partial.docs) as UpdateDocEntry[]) {
					touched_paths.add(entry.path);
				}
			}
			expect(touched_paths.has(docPathA)).toBe(true);
			expect(touched_paths.has(docPathB)).toBe(true);
		});

		it('applies the good docs and rejects the bad path when one entry is out of workspace', async () => {
			const docA = mockTextDocument(docTextA, docPathA);
			const editorA = mockTextEditor(docA);
			const bad_path = '/etc/shadow';
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editorA];
			rigOpenByPath({ [docPathA]: docA });
			const errorLogSpy = jest.spyOn(require('../lib/errorops'), 'writeToErrorLog');

			await panelHelper.simulateMessage({
				type: 'editText',
				changes_by_doc: {
					[docPathA]: [{ from: 0, to: 5, insert: 'AAAAA' }],
					[bad_path]: [{ from: 0, insert: 'pwned' }],
				},
			});

			expect(editorA.edit).toHaveBeenCalledTimes(1);
			// openTextDocument must never be called for the rejected out-of-workspace path
			const open_calls = (vscode.workspace.openTextDocument as jest.Mock).mock.calls;
			for (const call of open_calls) {
				const arg = call[0];
				const called_path: string = typeof arg === 'string' ? arg : (arg?.path || arg?.fsPath || '');
				expect(called_path).not.toBe(bad_path);
			}
			expect(errorLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('path outside workspace'),
				bad_path,
			);
			errorLogSpy.mockRestore();
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
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath,
				from: 0,
				to: 5,
			});

			expect(editor.revealRange).toHaveBeenCalledTimes(1);
		});

		it('does nothing when no existing editor is visible', async () => {
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];

			// should not throw
			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath,
				from: 0,
				to: 5,
			});

			// no editor to call revealRange on, so nothing should happen
		});

		it('uses from as both start and end when to is absent', async () => {
			const doc = mockTextDocument('Hello World', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({
				type: 'revealRange',
				docPath,
				from: 3,
			});

			expect(editor.revealRange).toHaveBeenCalledTimes(1);
			// selection should have same anchor and active when from === to
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
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({
				type: 'selectRange',
				docPath,
				from: 2,
				to: 8,
			});

			/*
			 * when from !== to, Selection(end_pos, start_pos) is used
			 * anchor = end_pos (8), active = start_pos (2)
			 */
			expect(editor.selection.anchor.character).toBe(8);
			expect(editor.selection.active.character).toBe(2);
			expect(editor.revealRange).toHaveBeenCalledTimes(1);
		});

		it('does nothing when no existing editor is visible', async () => {
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'selectRange',
				docPath,
				from: 0,
				to: 5,
			});
		});
	});

	// ---- editor-on-click settings -------------------------------------------

	describe('editor-on-click reveal / openNewEditorIfNoneOpen setting', () => {
		const docPath = '/workspace/test.md';
		const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

		// make getConfiguration('notethink.settings').get(path, default) return overrides[path] when present, else the passed default (so readSetting yields the built-in defaults for un-overridden keys)
		function mockSettings(overrides: Record<string, unknown>): void {
			(vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({
				get: jest.fn((key: string, def: unknown) => (key in overrides ? overrides[key] : def)),
				update: jest.fn(async () => {}),
				inspect: jest.fn(() => undefined),
			}));
		}

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => {
			setWorkspaceRoots(undefined);
			delete (vscode.window as unknown as { tabGroups?: unknown }).tabGroups;
		});

		it('reveal moves the caret and steals focus to a visible editor (switching hardcoded on)', async () => {
			const doc = mockTextDocument('Hello World', docPath);
			const editor = mockTextEditor(doc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];

			await panelHelper.simulateMessage({ type: 'revealRange', docPath, from: 0, to: 5 });

			expect(editor.revealRange).toHaveBeenCalledTimes(1);
			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
		});

		it('openNewEditorIfNoneOpen off (default) does not spawn a group when the board is the only group', async () => {
			mockSettings({});
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			(vscode.workspace.openTextDocument as jest.Mock).mockClear();
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath: '/workspace/notes/x.md', from: 0, to: 5 });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});

		it('openNewEditorIfNoneOpen on opens the note in a new beside group when the board is the only group', async () => {
			mockSettings({ 'view.generic.openNewEditorIfNoneOpen': true });
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();
			const target_doc = mockTextDocument('# note', '/workspace/notes/x.md');
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(target_doc);
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(target_doc));
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath: '/workspace/notes/x.md', from: 0, to: 5 });

			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
			const open_call = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
			expect(open_call[1].viewColumn).toBe(vscode.ViewColumn.Beside);
		});

		it('reveal reuses an existing other editor group instead of spawning a beside group', async () => {
			mockSettings({});
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();
			const target_doc = mockTextDocument('# note', '/workspace/notes/x.md');
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(target_doc);
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(target_doc));
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			// another editor group is open in column One (not the panel's column) with no tab holding the doc
			(vscode.window as unknown as { tabGroups: unknown }).tabGroups = { all: [{ viewColumn: vscode.ViewColumn.One, tabs: [] }] };
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath: '/workspace/notes/x.md', from: 0, to: 5 });

			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
			const open_call = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
			expect(open_call[1].viewColumn).toBe(vscode.ViewColumn.One);
		});

		// single-file mode (no folder integration): the clicked note's docPath is the board's own file, so the reveal path must never target the board's own column - when the user opts into openNewEditorIfNoneOpen it opens Beside, never over the board
		it('single-file mode opens the source beside the board (never over it) when openNewEditorIfNoneOpen is on', async () => {
			mockSettings({ 'view.generic.openNewEditorIfNoneOpen': true });
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			// the only tab open is our own NoteThink board, holding the same file the note comes from, in column One (the panel's column)
			(panelHelper.panel as unknown as { viewColumn: vscode.ViewColumn }).viewColumn = vscode.ViewColumn.One;
			(vscode.window as unknown as { tabGroups: unknown }).tabGroups = {
				all: [{ viewColumn: vscode.ViewColumn.One, tabs: [{ input: { uri: Uri.file(docPath), viewType: 'notethink.viewer' } }] }],
			};
			const target_doc = mockTextDocument('# note', docPath);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(target_doc);
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(target_doc));
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath, from: 0, to: 5 });

			// board tab is skipped by findColumnWithDoc, so with no other group the note opens Beside rather than over the board's own column
			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
			const open_call = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
			expect(open_call[1].viewColumn).toBe(vscode.ViewColumn.Beside);
		});

		it('single-file mode stays quiet when openNewEditorIfNoneOpen is off and the board is the only tab', async () => {
			mockSettings({ 'view.generic.openNewEditorIfNoneOpen': false });
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			(panelHelper.panel as unknown as { viewColumn: vscode.ViewColumn }).viewColumn = vscode.ViewColumn.One;
			(vscode.window as unknown as { tabGroups: unknown }).tabGroups = {
				all: [{ viewColumn: vscode.ViewColumn.One, tabs: [{ input: { uri: Uri.file(docPath), viewType: 'notethink.viewer' } }] }],
			};
			(vscode.workspace.openTextDocument as jest.Mock).mockClear();
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath, from: 0, to: 5 });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});

		it('reuses an existing plain text-editor tab of the doc rather than spawning a beside group', async () => {
			mockSettings({});
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			(panelHelper.panel as unknown as { viewColumn: vscode.ViewColumn }).viewColumn = vscode.ViewColumn.One;
			// a real text-editor tab (no viewType) holds the doc in column Two; the board tab sits in column One
			(vscode.window as unknown as { tabGroups: unknown }).tabGroups = {
				all: [
					{ viewColumn: vscode.ViewColumn.One, tabs: [{ input: { uri: Uri.file(docPath), viewType: 'notethink.viewer' } }] },
					{ viewColumn: vscode.ViewColumn.Two, tabs: [{ input: { uri: Uri.file(docPath) } }] },
				],
			};
			const target_doc = mockTextDocument('# note', docPath);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(target_doc);
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(target_doc));
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath, from: 0, to: 5 });

			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
			const open_call = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
			expect(open_call[1].viewColumn).toBe(vscode.ViewColumn.Two);
		});

		// folderless window (a loose .md opened with no workspace folder): isWithinWorkspace fails closed, but the board's own file must still be revealable when the user opts into openNewEditorIfNoneOpen
		it('folderless window opens the board own file even with no workspace folder open', async () => {
			setWorkspaceRoots(undefined);
			mockSettings({ 'view.generic.openNewEditorIfNoneOpen': true });
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			(panelHelper.panel as unknown as { viewColumn: vscode.ViewColumn }).viewColumn = vscode.ViewColumn.One;
			(vscode.window as unknown as { tabGroups: unknown }).tabGroups = {
				all: [{ viewColumn: vscode.ViewColumn.One, tabs: [{ input: { uri: Uri.file(defaultDocPath), viewType: 'notethink.viewer' } }] }],
			};
			const target_doc = mockTextDocument('# note', defaultDocPath);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(target_doc);
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(target_doc));
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			// defaultDocPath is the board's own file (active_path), so the reveal is allowed despite the empty workspace
			await panelHelper.simulateMessage({ type: 'revealRange', docPath: defaultDocPath, from: 0, to: 5 });

			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
			const open_call = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
			expect(open_call[1].viewColumn).toBe(vscode.ViewColumn.Beside);
		});

		it('folderless window still refuses a reveal target that is not the board own file', async () => {
			setWorkspaceRoots(undefined);
			mockSettings({});
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			(vscode.workspace.openTextDocument as jest.Mock).mockClear();
			(vscode.window.showTextDocument as jest.Mock).mockClear();

			await panelHelper.simulateMessage({ type: 'revealRange', docPath: '/elsewhere/evil.md', from: 0, to: 5 });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});
	});

	// ---- setIntegration folder filters -----------------------------------

	describe('setIntegration folder filters', () => {
		const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('uses the default include/exclude when the message carries none', async () => {
			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();

			const find_call = (vscode.workspace.findFiles as jest.Mock).mock.calls[0];
			expect(find_call[0].pattern).toBe('**/*.md');
			expect(find_call[1]).toBe(DEFAULT_EXCLUDE_FILTER);

			const update = getUpdates(panelHelper.postedMessages).pop();
			expect(update.include_filter).toBe('**/*.md');
			expect(update.exclude_filter).toBe(DEFAULT_EXCLUDE_FILTER);
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

			const update = getUpdates(panelHelper.postedMessages).pop();
			expect(update.include_filter).toBe('**/users/**');
			expect(update.exclude_filter).toBe('');
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

		it('retains the user filters across a breadcrumb re-narrow that omits them - read from the workspace cascade, not stale in-memory state', async () => {
			// simulate the user's filters being persisted under notethink.settings.files.* (what the Files drawer's Apply does via updateSetting). The settings module reads via getConfiguration('notethink.settings') and dotted paths
			(vscode.workspace.getConfiguration as jest.Mock).mockImplementation((section: string) => {
				if (section === 'notethink.settings') {
					return {
						get: jest.fn((key: string) => {
							if (key === 'files.includeFilter') { return '**/users/**'; }
							if (key === 'files.excludeFilter') { return ''; }
							return undefined;
						}),
						update: jest.fn(async () => {}),
						inspect: jest.fn(() => undefined),
					};
				}
				return { get: jest.fn(() => undefined), update: jest.fn(async () => {}), inspect: jest.fn(() => undefined) };
			});

			await panelHelper.simulateMessage({
				type: 'setIntegration', mode: 'folder', path: '/workspace/notes',
				include: '**/users/**', exclude: '',
			});
			await flush();
			// a breadcrumb segment click re-narrows to a subdirectory without carrying filters; the cascade is now the source of truth, so the same filters are picked up
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes/users' });
			await flush();

			const second_call = (vscode.workspace.findFiles as jest.Mock).mock.calls[1];
			expect(second_call[0].pattern).toBe('**/users/**');
			expect(second_call[1]).toBeNull();
		});

		it('emits a docDeleted tombstone when the folder watcher fires onDidDelete for a loaded doc', async () => {
			const file_path = '/workspace/notes/gone.md';
			const loaded_doc = mockTextDocument('# present', file_path);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(loaded_doc);
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([Uri.file(file_path)]);

			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			while (getUpdates(panelHelper.postedMessages).length < 2) {
				await new Promise(resolve => setImmediate(resolve));
			}

			const folder_watcher = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			const on_delete_cb = folder_watcher.onDidDelete.mock.calls[0][0];

			panelHelper.postedMessages.length = 0;
			await on_delete_cb(Uri.file(file_path));

			const tombstone = findByType(panelHelper.postedMessages, 'docDeleted');
			expect(tombstone).toBeDefined();
			expect(tombstone.docPath).toBe(file_path);
		});

		it('a watcher-driven onDidCreate add re-sends the stored discovery totals (not 0/false)', async () => {
			const file_a = '/workspace/notes/a.md';
			const file_b = '/workspace/notes/b.md';
			const file_c = '/workspace/notes/c.md';
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockTextDocument('# a', file_a));
			// discovery finds three files so total_discovered=3, truncated=false
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([Uri.file(file_a), Uri.file(file_b), Uri.file(file_c)]);

			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			while (getUpdates(panelHelper.postedMessages).length < 2) {
				await new Promise(resolve => setImmediate(resolve));
			}

			const folder_watcher = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			const on_create_cb = folder_watcher.onDidCreate.mock.calls[0][0];
			const new_file = '/workspace/notes/d.md';
			(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(new TextEncoder().encode('# d'));

			panelHelper.postedMessages.length = 0;
			await on_create_cb(Uri.file(new_file));

			const update = getUpdates(panelHelper.postedMessages).pop();
			expect(update).toBeDefined();
			expect(update.aggregate_total_discovered).toBe(3);
			expect(update.aggregate_truncated).toBe(false);
		});

		it('switching to current_file tears down the folder integration and re-sends the active doc as a replace', async () => {
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();

			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'current_file' });
			await flush();

			// the active doc is re-sent with no merge_strategy so the webview replaces (prunes) the stale folder docs
			const update = findUpdate(panelHelper.postedMessages);
			expect(update).toBeDefined();
			expect(update.merge_strategy).toBeUndefined();
			const doc_entries = Object.values(update.partial.docs) as UpdateDocEntry[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe(defaultDocPath);
		});

		it('emits a pendingChange { key: folderDiscovery, on: true } before loading and { on: false } after the bulk replace', async () => {
			const file_a = '/workspace/notes/a.md';
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockTextDocument('# a', file_a));
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([Uri.file(file_a)]);

			panelHelper.postedMessages.length = 0;
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			while (getUpdates(panelHelper.postedMessages).length < 2) {
				await new Promise(resolve => setImmediate(resolve));
			}

			const pending_changes = panelHelper.postedMessages.filter(m => m.type === 'pendingChange');
			const on_msg = pending_changes.find(m => m.key === 'folderDiscovery' && m.on === true);
			const off_msg = pending_changes.find(m => m.key === 'folderDiscovery' && m.on === false);
			expect(on_msg).toBeDefined();
			expect(off_msg).toBeDefined();
		});

		it('does NOT emit a pendingChange when the discovered set exactly matches the cached docs (fast path)', async () => {
			const file_a = '/workspace/notes/a.md';
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockTextDocument('# a', file_a));
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([Uri.file(file_a)]);
			// pin a stable mtime so the second discoverFolderDocs sees the cached + discovered sets match
			(vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: 1, ctime: 0, mtime: 12345, size: 0 });

			// first entry: populates integration_docs (also emits a pendingChange on, then off)
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			while (getUpdates(panelHelper.postedMessages).length < 2) {
				await new Promise(resolve => setImmediate(resolve));
			}

			// second entry: same path, same files, same mtimes - fast path should skip the pendingChange + skip per-file loads
			panelHelper.postedMessages.length = 0;
			(vscode.workspace.openTextDocument as jest.Mock).mockClear();
			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			await flush();

			const pending_changes = panelHelper.postedMessages.filter(m => m.type === 'pendingChange');
			expect(pending_changes).toEqual([]);
			// fast path: no per-file openTextDocument calls beyond the no-ops; the aggregate payload is sent without reloading
			const aggregate = panelHelper.postedMessages.find(m => m.type === 'update' && (m as Record<string, unknown>).aggregate_total_discovered !== undefined);
			expect(aggregate).toBeDefined();
		});
	});

	// ---- security: webview path containment ---------------------------------

	describe('webview path containment (security hardening)', () => {
		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('editText refuses an out-of-workspace path', async () => {
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: '/etc/shadow',
				changes: [{ from: 0, insert: 'pwned' }],
			});

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('editText refuses an in-workspace non-markdown path', async () => {
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];

			await panelHelper.simulateMessage({
				type: 'editText',
				docPath: '/workspace/secrets.txt',
				changes: [{ from: 0, insert: 'pwned' }],
			});

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
		});

		it('revealRange refuses an out-of-workspace path', async () => {
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];

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

	// ---- requestJumpTargets / openFile (breadcrumb jump drawer) -------------

	describe('requestJumpTargets message', () => {
		type JumpTargetsMessage = MessageRecord & {
			type: 'jumpTargets';
			mode: string;
			path: string;
			entries: Array<{ label: string; path: string; kind: string }>;
		};
		const dir = (vscode.FileType as unknown as { Directory: number }).Directory;
		const file = (vscode.FileType as unknown as { File: number }).File;

		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => {
			setWorkspaceRoots(undefined);
			(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
		});

		it('folder mode returns child-folder entries, exclude-filtered', async () => {
			(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([
				['users', dir],
				['projects', dir],
				['node_modules', dir],
				['readme.md', file],
			]);
			panelHelper.postedMessages.length = 0;

			await panelHelper.simulateMessage({ type: 'requestJumpTargets', mode: 'folder', path: '/workspace/notes' });

			const reply = findByType(panelHelper.postedMessages, 'jumpTargets') as JumpTargetsMessage;
			expect(reply).toBeDefined();
			expect(reply.mode).toBe('folder');
			expect(reply.path).toBe('/workspace/notes');
			// node_modules is dropped by the default exclude; the .md file is not a folder; entries are sorted by label
			expect(reply.entries).toEqual([
				{ label: 'projects', path: '/workspace/notes/projects', kind: 'folder' },
				{ label: 'users', path: '/workspace/notes/users', kind: 'folder' },
			]);
		});

		it('current_file mode returns sibling .md entries minus the current file', async () => {
			(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([
				['alpha.md', file],
				['beta.md', file],
				['self.md', file],
				['notes.txt', file],
				['subdir', dir],
			]);
			panelHelper.postedMessages.length = 0;

			await panelHelper.simulateMessage({ type: 'requestJumpTargets', mode: 'current_file', path: '/workspace/docs/self.md' });

			const reply = findByType(panelHelper.postedMessages, 'jumpTargets') as JumpTargetsMessage;
			expect(reply).toBeDefined();
			expect(reply.mode).toBe('current_file');
			expect(reply.path).toBe('/workspace/docs/self.md');
			// self.md is dropped, non-.md and folders excluded, sorted by label
			expect(reply.entries).toEqual([
				{ label: 'alpha.md', path: '/workspace/docs/alpha.md', kind: 'file' },
				{ label: 'beta.md', path: '/workspace/docs/beta.md', kind: 'file' },
			]);
		});

		it('refuses a folder path outside the workspace (no reply)', async () => {
			panelHelper.postedMessages.length = 0;

			await panelHelper.simulateMessage({ type: 'requestJumpTargets', mode: 'folder', path: '/etc' });

			expect(vscode.workspace.fs.readDirectory).not.toHaveBeenCalled();
			expect(findByType(panelHelper.postedMessages, 'jumpTargets')).toBeUndefined();
		});

		it('refuses a current_file path outside the workspace (no reply)', async () => {
			panelHelper.postedMessages.length = 0;

			await panelHelper.simulateMessage({ type: 'requestJumpTargets', mode: 'current_file', path: '/etc/passwd.md' });

			expect(vscode.workspace.fs.readDirectory).not.toHaveBeenCalled();
			expect(findByType(panelHelper.postedMessages, 'jumpTargets')).toBeUndefined();
		});
	});

	describe('openFile message', () => {
		beforeEach(() => setWorkspaceRoots(['/workspace']));
		afterEach(() => setWorkspaceRoots(undefined));

		it('opens a valid in-workspace .md file via the reveal path', async () => {
			const docPath = '/workspace/docs/target.md';
			const doc = mockTextDocument('# Target', docPath);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(doc));

			await panelHelper.simulateMessage({ type: 'openFile', path: docPath });

			expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
			expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
		});

		it('refuses an out-of-workspace path', async () => {
			await panelHelper.simulateMessage({ type: 'openFile', path: '/etc/shadow.md' });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});

		it('refuses an in-workspace non-markdown path', async () => {
			await panelHelper.simulateMessage({ type: 'openFile', path: '/workspace/docs/secrets.txt' });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});
	});

	// ---- requestInitialState ------------------------------------------------

	describe('requestInitialState message', () => {
		it('sends update and selection messages back to webview', async () => {
			panelHelper.postedMessages.length = 0;

			await panelHelper.simulateMessage({ type: 'requestInitialState' });

			expect(panelHelper.panel.webview.postMessage).toHaveBeenCalled();
			const update_msg = findUpdate(panelHelper.postedMessages);
			expect(update_msg).toBeDefined();
			expect(update_msg.partial.docs).toBeDefined();
			const doc_entries = Object.values(update_msg.partial.docs) as UpdateDocEntry[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe(defaultDocPath);

			const selection_msg = findSelection(panelHelper.postedMessages);
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
			// simulate panel disposal
			panelHelper.simulateDispose();

			// should not throw
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
		let onActiveEditorCallback: (editor: MockTextEditor | undefined) => Promise<void>;

		beforeEach(() => {
			onActiveEditorCallback = (vscode.window.onDidChangeActiveTextEditor as jest.Mock).mock.calls[0][0];
		});

		it('switches document when a different .md editor becomes active', async () => {
			const newDoc = mockTextDocument('# New File', '/workspace/new.md');
			const newEditor = mockTextEditor(newDoc);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [newEditor];

			panelHelper.postedMessages.length = 0;

			await onActiveEditorCallback(newEditor);

			const update = findUpdate(panelHelper.postedMessages);
			expect(update).toBeDefined();
			const doc_entries = Object.values(update.partial.docs) as UpdateDocEntry[];
			expect(doc_entries.length).toBe(1);
			expect(doc_entries[0].path).toBe('/workspace/new.md');

			const selection = findSelection(panelHelper.postedMessages);
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

			const updates = getUpdates(panelHelper.postedMessages);
			expect(updates.length).toBe(1);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
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

			const updates = getUpdates(panelHelper.postedMessages);
			expect(updates.length).toBe(1);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].text).toBe('# Second change');
		});
	});

	// ---- selection tracking -------------------------------------------------

	describe('selection tracking', () => {
		let onSelectionCallback: (e: { textEditor: { document: MockTextDocument; selection: Selection }; selections: Selection[] }) => void;

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

			const selection = findSelection(panelHelper.postedMessages);
			expect(selection).toBeDefined();
			expect(selection.docPath).toBe(defaultDocPath);
		});

		it('debounces rapid selection changes and only sends the last one', () => {
			const doc = mockTextDocument(defaultDocText, defaultDocPath);
			panelHelper.postedMessages.length = 0;

			// fire three rapid selection changes
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

			// only the last one should have been sent
			const selectionMessages = getSelections(panelHelper.postedMessages);
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

		function makeWatcher(): { onDidCreate: jest.Mock; onDidChange: jest.Mock; onDidDelete: jest.Mock; dispose: jest.Mock } {
			return {
				onDidCreate: jest.fn(),
				onDidChange: jest.fn(),
				onDidDelete: jest.fn(),
				dispose: jest.fn(),
			};
		}

		// build a panel for a doc with no visible editor - the precondition that arms the watcher
		async function setupUnvisitedDoc(opts: { settingOn?: boolean } = {}): Promise<{ provider: NotethinkEditorProvider; panel: ReturnType<typeof createMockWebviewPanel>; doc: MockTextDocument }> {
			const setting_on = opts.settingOn ?? true;
			(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
				get: jest.fn((_key: string, fallback: unknown) => {
					if (_key === 'view.generic.watchUnopenedFilesInViewer') { return setting_on; }
					return fallback;
				}),
				update: jest.fn(async () => {}),
				inspect: jest.fn(() => undefined),
			});
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [];
			const doc = mockTextDocument(docText, docPath);
			const local_provider = new NotethinkEditorProvider(mockExtensionContext());
			const local_panel = createMockWebviewPanel();
			await (local_provider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(local_panel.panel, doc);
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
			/*
			 * the outer beforeEach already configured visibleTextEditors = [initialEditor] for defaultDocPath
			 * since the default panelHelper's active path is visible, no watcher should be armed
			 */
			expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length).toBe(0);
		});

		it('does NOT arm a watcher when the setting is off', async () => {
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
			await setupUnvisitedDoc({ settingOn: false });
			expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length).toBe(0);
		});

		it('re-parses the active doc from disk (not the openTextDocument cache) when the watcher fires onDidChange', async () => {
			const { panel } = await setupUnvisitedDoc();
			const watcher_instance = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			const on_change_cb = watcher_instance.onDidChange.mock.calls[0][0];

			// fs.readFile returns the fresh on-disk bytes; openTextDocument is rigged to a stale value to prove we are NOT going through that path
			const fresh_text = '# Lonely updated';
			(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(new TextEncoder().encode(fresh_text));
			const stale_doc = mockTextDocument('# Lonely (stale cache)', docPath);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(stale_doc);

			panel.postedMessages.length = 0;
			await on_change_cb(Uri.file(docPath));

			expect(vscode.workspace.fs.readFile).toHaveBeenCalled();
			const updates = getUpdates(panel.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].text).toBe(fresh_text);
			expect(doc_entries[0].createdBy).toBe('fsWatcher');
		});

		it('folder-mode watcher re-parses changed files from disk, bypassing the openTextDocument cache', async () => {
			const file_path = '/workspace/notes/story.md';
			// phase-1 discovery uses openTextDocument (initial load, cache is fresh from disk anyway)
			const initial_doc = mockTextDocument('# story v1', file_path);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(initial_doc);
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([Uri.file(file_path)]);

			await panelHelper.simulateMessage({ type: 'setIntegration', mode: 'folder', path: '/workspace/notes' });
			// phase-1 loadOne uses crypto.subtle.digest in buildDoc which spans multiple event-loop cycles; wait until both phase-1 messages (per-file merge + Promise.allSettled.then canonical) have landed before clearing, otherwise a late-arriving v1 merge would race the watcher's v2 post and become updates[0]
			while (getUpdates(panelHelper.postedMessages).length < 2) {
				await new Promise(resolve => setImmediate(resolve));
			}

			// rig openTextDocument to a stale value to prove the watcher path does NOT use it
			const stale_doc = mockTextDocument('# story (stale cache)', file_path);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(stale_doc);
			// fresh disk content the watcher should pick up via fs.readFile
			const fresh_text = '# story v2 (from disk)';
			(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(new TextEncoder().encode(fresh_text));

			// grab the folder watcher instance and fire onDidChange
			const folder_watcher = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			const on_change_cb = folder_watcher.onDidChange.mock.calls[0][0];

			panelHelper.postedMessages.length = 0;
			await on_change_cb(Uri.file(file_path));

			expect(vscode.workspace.fs.readFile).toHaveBeenCalled();
			const updates = getUpdates(panelHelper.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].text).toBe(fresh_text);
			expect(doc_entries[0].createdBy).toBe('fsWatcher');
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
			on_config_cb({ affectsConfiguration: (key: string) => key === 'notethink.settings.view.generic.watchUnopenedFilesInViewer' });

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
			on_config_cb({ affectsConfiguration: (key: string) => key === 'notethink.settings.view.generic.watchUnopenedFilesInViewer' });

			expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.length).toBe(1);
		});

		it('disposes the watcher when entering folder mode', async () => {
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

		// onDidCreate shares the same disk-bypass re-parse path as onDidChange (file recreated after delete)
		it('re-parses from disk when the watcher fires onDidCreate', async () => {
			const { panel } = await setupUnvisitedDoc();
			const watcher_instance = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;
			const on_create_cb = watcher_instance.onDidCreate.mock.calls[0][0];

			const fresh_text = '# Lonely recreated';
			(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(new TextEncoder().encode(fresh_text));

			panel.postedMessages.length = 0;
			await on_create_cb(Uri.file(docPath));

			expect(vscode.workspace.fs.readFile).toHaveBeenCalled();
			const updates = getUpdates(panel.postedMessages);
			expect(updates.length).toBeGreaterThanOrEqual(1);
			const doc_entries = Object.values(updates[0].partial.docs) as UpdateDocEntry[];
			expect(doc_entries[0].text).toBe(fresh_text);
		});

		it('re-evaluates when the visible-editor set changes (visible→hidden re-arms; hidden→visible disposes)', async () => {
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
			// start with no visible editor → watcher armed on first sync
			await setupUnvisitedDoc();
			const first_watcher = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.slice(-1)[0].value;

			// now simulate an editor becoming visible for the same file
			const editor = mockTextEditor(mockTextDocument(docText, docPath));
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			const on_visible_cb = (vscode.window.onDidChangeVisibleTextEditors as jest.Mock).mock.calls.slice(-1)[0][0];
			on_visible_cb([editor]);

			expect(first_watcher.dispose).toHaveBeenCalledTimes(1);
		});
	});

	/*
	 * ---- non-file: scheme folder mode (VS Code Web / custom FileSystemProvider) ----
	 * shared vscode-vfs: fixtures for the non-file: scheme folder-mode + openRelative blocks below
	 */
	const VFS_AUTHORITY = 'github';
	const VFS_ROOT = '/zoombuzz/notethink';
	const vfsUri = (p: string): Uri => Uri.parse(`vscode-vfs://${VFS_AUTHORITY}${p}`);

	describe('folder mode on a non-file: workspace scheme', () => {
		const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

		// stand up a fresh panel whose workspace folder + active doc both live on a vscode-vfs: scheme, so base_uri carries that scheme end-to-end
		async function setupVfsPanel(): Promise<ReturnType<typeof createMockWebviewPanel>> {
			const folder_uri = vfsUri(VFS_ROOT);
			(vscode.workspace as unknown as WorkspaceMutable).workspaceFolders = [{ uri: folder_uri, name: 'notethink', index: 0 }];
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({ uri: folder_uri, name: 'notethink', index: 0 });
			const doc_uri = vfsUri(`${VFS_ROOT}/welcome/intro.md`);
			const doc = { uri: doc_uri, getText: jest.fn(() => '# Intro'), positionAt: jest.fn((o: number) => new Position(0, o)), offsetAt: jest.fn((pos: Position) => pos.character) };
			const editor = mockTextEditor(doc as unknown as MockTextDocument);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			const local_provider = new NotethinkEditorProvider(mockExtensionContext());
			const local_panel = createMockWebviewPanel();
			await (local_provider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(local_panel.panel, doc);
			await local_panel.simulateMessage({ type: 'requestInitialState' });
			return local_panel;
		}

		// mock the provider's readDirectory as a path→entries tree so the walk can traverse it
		function mockVfsTree(tree: Record<string, Array<[string, vscode.FileType]>>): void {
			(vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: Uri) => tree[uri.path] ?? []);
		}

		afterEach(() => {
			(vscode.workspace as unknown as WorkspaceMutable).workspaceFolders = undefined;
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
			(vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation(() => ({
				onDidCreate: jest.fn(), onDidChange: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn(),
			}));
		});

		it('discovers folder docs via the provider readDirectory walk on a non-file: scheme (findFiles bypassed)', async () => {
			mockVfsTree({
				[VFS_ROOT]: [['welcome', vscode.FileType.Directory]],
				[`${VFS_ROOT}/welcome`]: [['main', vscode.FileType.Directory]],
				[`${VFS_ROOT}/welcome/main`]: [['intro.md', vscode.FileType.File]],
			});
			// findFiles returns nothing on this scheme - discovery must come from the walk, not findFiles
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
			(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(
				{ uri: vfsUri(`${VFS_ROOT}/welcome/main/intro.md`), getText: jest.fn(() => '# Intro'), positionAt: jest.fn((o: number) => new Position(0, o)), offsetAt: jest.fn((pos: Position) => pos.character) },
			);

			const panel = await setupVfsPanel();
			panel.postedMessages.length = 0;
			await panel.simulateMessage({ type: 'setIntegration', mode: 'folder', path: `${VFS_ROOT}/welcome` });
			while (getUpdates(panel.postedMessages).length < 1) { await flush(); }

			// the walk read the integration folder with the vscode-vfs scheme preserved
			const read_uris = (vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.map(c => c[0] as Uri);
			expect(read_uris.some(u => u.scheme === 'vscode-vfs' && u.path === `${VFS_ROOT}/welcome`)).toBe(true);
			// the nested file the walk found made it into an update payload
			const paths = getUpdates(panel.postedMessages)
				.flatMap(u => Object.values(u.partial.docs) as UpdateDocEntry[])
				.map(d => d.path);
			expect(paths).toContain(`${VFS_ROOT}/welcome/main/intro.md`);
		});

		it('prunes an excluded directory during the walk and post-filters its files', async () => {
			mockVfsTree({
				[VFS_ROOT]: [['welcome', vscode.FileType.Directory]],
				[`${VFS_ROOT}/welcome`]: [['keep.md', vscode.FileType.File], ['node_modules', vscode.FileType.Directory]],
				[`${VFS_ROOT}/welcome/node_modules`]: [['dep.md', vscode.FileType.File]],
			});
			(vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (u: Uri) =>
				({ uri: u, getText: jest.fn(() => '# x'), positionAt: jest.fn((o: number) => new Position(0, o)), offsetAt: jest.fn((pos: Position) => pos.character) }),
			);

			const panel = await setupVfsPanel();
			panel.postedMessages.length = 0;
			await panel.simulateMessage({ type: 'setIntegration', mode: 'folder', path: `${VFS_ROOT}/welcome` });
			while (getUpdates(panel.postedMessages).length < 1) { await flush(); }

			// the walk never descends into node_modules (probe-prune), so its readDirectory is never called
			const read_paths = (vscode.workspace.fs.readDirectory as jest.Mock).mock.calls.map(c => (c[0] as Uri).path);
			expect(read_paths).not.toContain(`${VFS_ROOT}/welcome/node_modules`);
			const paths = getUpdates(panel.postedMessages)
				.flatMap(u => Object.values(u.partial.docs) as UpdateDocEntry[])
				.map(d => d.path);
			expect(paths).toContain(`${VFS_ROOT}/welcome/keep.md`);
			expect(paths).not.toContain(`${VFS_ROOT}/welcome/node_modules/dep.md`);
		});

		it('does NOT throw when the provider watcher creation fails (static content)', async () => {
			(vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
			(vscode.workspace.createFileSystemWatcher as jest.Mock).mockImplementation(() => {
				throw new Error('watch() unsupported on this provider');
			});

			const panel = await setupVfsPanel();
			// folder entry must complete despite the throwing watcher; an update still ships
			await expect(panel.simulateMessage({ type: 'setIntegration', mode: 'folder', path: `${VFS_ROOT}/welcome` })).resolves.toBeUndefined();
			await flush();
		});
	});

	// ---- relative-link open (openRelative) ----------------------------------

	describe('openRelative message', () => {
		async function setupVfsActiveDoc(active_path: string): Promise<ReturnType<typeof createMockWebviewPanel>> {
			const folder_uri = vfsUri(VFS_ROOT);
			(vscode.workspace as unknown as WorkspaceMutable).workspaceFolders = [{ uri: folder_uri, name: 'notethink', index: 0 }];
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({ uri: folder_uri, name: 'notethink', index: 0 });
			const doc_uri = vfsUri(active_path);
			const doc = { uri: doc_uri, getText: jest.fn(() => '# Active'), positionAt: jest.fn((o: number) => new Position(0, o)), offsetAt: jest.fn((pos: Position) => pos.character) };
			const editor = mockTextEditor(doc as unknown as MockTextDocument);
			(vscode.window as unknown as WindowMutable).visibleTextEditors = [editor];
			const local_provider = new NotethinkEditorProvider(mockExtensionContext());
			const local_panel = createMockWebviewPanel();
			await (local_provider as unknown as { myWebviewPanel: (panel: unknown, doc: unknown) => Promise<void> }).myWebviewPanel(local_panel.panel, doc);
			await local_panel.simulateMessage({ type: 'requestInitialState' });
			return local_panel;
		}

		afterEach(() => {
			(vscode.workspace as unknown as WorkspaceMutable).workspaceFolders = undefined;
			(vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
		});

		it('resolves a sibling .md href against the active doc URI, preserving the scheme, and opens it', async () => {
			const panel = await setupVfsActiveDoc(`${VFS_ROOT}/welcome/intro.md`);
			const opened: Uri[] = [];
			(vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (u: Uri) => {
				opened.push(u);
				return { uri: u, getText: jest.fn(() => '# Sib'), positionAt: jest.fn((o: number) => new Position(0, o)), offsetAt: jest.fn((pos: Position) => pos.character) };
			});
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(mockTextDocument('# Sib', '/x')));

			await panel.simulateMessage({ type: 'openRelative', href: 'sibling.md' });

			expect(opened.length).toBe(1);
			expect(opened[0].scheme).toBe('vscode-vfs');
			expect(opened[0].authority).toBe(VFS_AUTHORITY);
			expect(opened[0].path).toBe(`${VFS_ROOT}/welcome/sibling.md`);
		});

		it('resolves a sub-path href against the active doc URI', async () => {
			const panel = await setupVfsActiveDoc(`${VFS_ROOT}/welcome/intro.md`);
			const opened: Uri[] = [];
			(vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async (u: Uri) => {
				opened.push(u);
				return { uri: u, getText: jest.fn(() => '# Sub'), positionAt: jest.fn((o: number) => new Position(0, o)), offsetAt: jest.fn((pos: Position) => pos.character) };
			});
			(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockTextEditor(mockTextDocument('# Sub', '/x')));

			await panel.simulateMessage({ type: 'openRelative', href: 'main/intro.md#section?q=1' });

			expect(opened.length).toBe(1);
			// the #fragment and ?query are stripped before joining
			expect(opened[0].path).toBe(`${VFS_ROOT}/welcome/main/intro.md`);
		});

		it('refuses a `..`-escape href that climbs out of the workspace', async () => {
			const panel = await setupVfsActiveDoc(`${VFS_ROOT}/welcome/intro.md`);
			(vscode.workspace.openTextDocument as jest.Mock).mockClear();

			await panel.simulateMessage({ type: 'openRelative', href: '../../../../../../etc/passwd.md' });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
		});

		it('refuses a non-.md href', async () => {
			const panel = await setupVfsActiveDoc(`${VFS_ROOT}/welcome/intro.md`);
			(vscode.workspace.openTextDocument as jest.Mock).mockClear();

			await panel.simulateMessage({ type: 'openRelative', href: 'evil.sh' });

			expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
		});
	});
});

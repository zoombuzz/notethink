/**
 * Unit tests for the activate() command surface.
 *
 * activate() registers notethink.openViewer, whose guard decides between three outcomes:
 * open on the active .md file, open docless (the board aggregates the workspace root),
 * or warn because there is neither a file nor a folder to show.
 */

import * as vscode from 'vscode';
import { Uri } from './__mocks__/vscode';
import { activate } from './extension';

type WorkspaceMutable = {
	workspaceFolders: Array<{ uri: Uri; name: string; index: number }> | undefined;
};

type WindowMutable = {
	activeTextEditor: unknown;
};

function mockExtensionContext(): vscode.ExtensionContext {
	return {
		extensionUri: Uri.file('/mock/extension'),
		logUri: Uri.file('/mock/logs'),
		subscriptions: [],
		extension: { packageJSON: { version: '0.0.0-test' } },
	} as unknown as vscode.ExtensionContext;
}

// point the mocked workspace at the given roots, or at no folder at all when passed undefined
function setWorkspaceRoots(roots: string[] | undefined): void {
	(vscode.workspace as unknown as WorkspaceMutable).workspaceFolders = roots
		? roots.map((root, index) => ({ uri: Uri.file(root), name: root, index }))
		: undefined;
}

function setActiveEditorPath(doc_path: string | undefined): void {
	(vscode.window as unknown as WindowMutable).activeTextEditor = doc_path
		? { document: { uri: Uri.file(doc_path), getText: () => '# doc' } }
		: undefined;
}

// pull the callback activate() registered for a command name out of the registerCommand mock
function registeredCommand(command_name: string): () => Promise<void> {
	const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(c => c[0] === command_name);
	return call[1] as () => Promise<void>;
}

describe('notethink.openViewer command', () => {
	let openViewer: () => Promise<void>;

	beforeEach(() => {
		jest.clearAllMocks();
		(vscode.window.createWebviewPanel as jest.Mock).mockReturnValue({
			active: true,
			webview: {
				options: {},
				html: '',
				postMessage: jest.fn(async () => true),
				onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
				asWebviewUri: jest.fn((uri: Uri) => uri),
				cspSource: 'https://test.csp.source',
			},
			onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
			onDidChangeViewState: jest.fn(() => ({ dispose: jest.fn() })),
		});
		activate(mockExtensionContext());
		openViewer = registeredCommand('notethink.openViewer');
	});

	afterEach(() => {
		setWorkspaceRoots(undefined);
		setActiveEditorPath(undefined);
	});

	it('opens the panel on the active .md file when one is active', async () => {
		setWorkspaceRoots(['/workspace']);
		setActiveEditorPath('/workspace/todo.md');

		await openViewer();

		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
	});

	// the docless open: nothing to render on, but the workspace root gives the board a folder to aggregate
	it('opens the panel with no document when no .md file is active but a workspace folder exists', async () => {
		setWorkspaceRoots(['/workspace']);
		setActiveEditorPath(undefined);

		await openViewer();

		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
	});

	// a non-markdown active editor is the same "no file to show" case as no editor at all
	it('opens the panel with no document when the active editor is not markdown', async () => {
		setWorkspaceRoots(['/workspace']);
		setActiveEditorPath('/workspace/notes.txt');

		await openViewer();

		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
	});

	it('warns and opens nothing when there is neither an active .md file nor a workspace folder', async () => {
		setWorkspaceRoots(undefined);
		setActiveEditorPath(undefined);

		await openViewer();

		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('NoteThink: open a .md file first');
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
	});

	it('warns when a non-markdown editor is active and no workspace folder is open', async () => {
		setWorkspaceRoots(undefined);
		setActiveEditorPath('/elsewhere/notes.txt');

		await openViewer();

		expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
	});

	// a loose .md file opened with no folder still has something to show, so it must not warn
	it('does not warn for an active .md file in a folderless window', async () => {
		setWorkspaceRoots(undefined);
		setActiveEditorPath('/elsewhere/loose.md');

		await openViewer();

		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
	});
});

import * as vscode from 'vscode';
import { GitHubFileSystemProvider } from './githubFileSystemProvider';
import { ensureAuthenticated, registerSaveToGitHub } from './dulcetSaveToGitHub';

const API_BASE = 'https://dulcet.notegit.com';

function mockFetchOk(json: unknown = {}) {
	return jest.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: () => Promise.resolve(json),
	});
}

function mockFetchFail(status = 401) {
	return jest.fn().mockResolvedValue({
		ok: false,
		status,
		json: () => Promise.resolve({}),
	});
}

describe('ensureAuthenticated', () => {
	let provider: GitHubFileSystemProvider;

	beforeEach(() => {
		provider = new GitHubFileSystemProvider(API_BASE);
		jest.useFakeTimers();
	});

	afterEach(() => {
		(globalThis as any).fetch = undefined;
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('returns true immediately if already authenticated', async () => {
		(globalThis as any).fetch = mockFetchOk();
		const result = await ensureAuthenticated(provider, API_BASE);
		expect(result).toBe(true);
	});

	it('shows sign-in prompt when not authenticated', async () => {
		(globalThis as any).fetch = mockFetchFail();
		(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Cancel');

		const result = await ensureAuthenticated(provider, API_BASE);
		expect(result).toBe(false);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Sign in to GitHub to save your work.',
			'Sign In',
			'Cancel',
		);
	});

	it('opens external login URL when user clicks Sign In', async () => {
		let call_count = 0;
		(globalThis as any).fetch = jest.fn().mockImplementation(() => {
			call_count++;
			// first call: not authenticated; subsequent calls: authenticated
			if (call_count <= 1) {
				return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
			}
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
		});
		(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Sign In');

		jest.useRealTimers();
		const result = await ensureAuthenticated(provider, API_BASE);

		expect(vscode.env.openExternal).toHaveBeenCalled();
		expect(result).toBe(true);
	});
});

describe('registerSaveToGitHub', () => {
	let provider: GitHubFileSystemProvider;
	let context: any;
	let registered_command: (...args: any[]) => Promise<void>;

	beforeEach(() => {
		jest.clearAllMocks();
		provider = new GitHubFileSystemProvider(API_BASE);
		context = {
			subscriptions: [],
			globalState: {
				_store: {} as Record<string, any>,
				get: jest.fn(function (this: any, key: string) { return this._store[key]; }),
				update: jest.fn(async function (this: any, key: string, value: any) { this._store[key] = value; }),
			},
			extensionUri: vscode.Uri.parse('https://dulcet.notegit.com/extensions/notethink'),
		};
		context.globalState.get.mockImplementation((key: string) => context.globalState._store[key]);
		context.globalState.update.mockImplementation(async (key: string, value: any) => { context.globalState._store[key] = value; });

		(vscode.commands.registerCommand as jest.Mock).mockImplementation((_name: string, handler: any) => {
			registered_command = handler;
			return { dispose: jest.fn() };
		});

		registerSaveToGitHub(context, provider, API_BASE);
	});

	afterEach(() => {
		(globalThis as any).fetch = undefined;
		jest.restoreAllMocks();
		vscode.window.activeTextEditor = undefined;
	});

	it('registers the dulcet.saveToGitHub command', () => {
		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			'dulcet.saveToGitHub',
			expect.any(Function),
		);
	});

	it('warns when no active editor', async () => {
		vscode.window.activeTextEditor = undefined;
		await registered_command();
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No active editor to save.');
	});

	it('prompts only for commit message when file is github:// scheme', async () => {
		const github_uri = vscode.Uri.parse('github:///octocat/repo/main/notes/test.md');
		vscode.window.activeTextEditor = {
			document: {
				uri: github_uri,
				getText: () => '# Test content',
			},
			viewColumn: 1,
		} as any;

		// auth check passes
		(globalThis as any).fetch = jest.fn()
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) })
			// commitFile PUT response
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'new' } }) });

		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('Update notes/test.md');

		await registered_command();

		// should only be called once (commit message), not 4 times (full dialog)
		expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining('Saved to GitHub'),
		);
	});

	it('shows full save dialog for untitled documents', async () => {
		const untitled_uri = vscode.Uri.parse('untitled:Untitled-1');
		vscode.window.activeTextEditor = {
			document: {
				uri: untitled_uri,
				getText: () => '# New note',
			},
			viewColumn: 1,
		} as any;

		// auth
		(globalThis as any).fetch = jest.fn()
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) })
			// commitFile PUT
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'abc' } }) });

		(vscode.window.showInputBox as jest.Mock)
			.mockResolvedValueOnce('octocat/my-notes')   // repo
			.mockResolvedValueOnce('notes/untitled.md')   // filepath
			.mockResolvedValueOnce('main')                // branch
			.mockResolvedValueOnce('Create new note');     // commit message

		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		await registered_command();

		expect(vscode.window.showInputBox).toHaveBeenCalledTimes(4);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining('Saved to GitHub: octocat/my-notes/notes/untitled.md'),
		);
	});

	it('cancels when user dismisses repo input', async () => {
		const untitled_uri = vscode.Uri.parse('untitled:Untitled-1');
		vscode.window.activeTextEditor = {
			document: {
				uri: untitled_uri,
				getText: () => '# Note',
			},
			viewColumn: 1,
		} as any;

		(globalThis as any).fetch = mockFetchOk();
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined); // user cancels

		await registered_command();

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
			expect.stringContaining('Saved'),
		);
	});

	it('remembers last repo and branch in globalState', async () => {
		const untitled_uri = vscode.Uri.parse('untitled:Untitled-1');
		vscode.window.activeTextEditor = {
			document: {
				uri: untitled_uri,
				getText: () => '# Note',
			},
			viewColumn: 1,
		} as any;

		(globalThis as any).fetch = jest.fn()
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'x' } }) });

		(vscode.window.showInputBox as jest.Mock)
			.mockResolvedValueOnce('myorg/notes-repo')
			.mockResolvedValueOnce('docs/note.md')
			.mockResolvedValueOnce('develop')
			.mockResolvedValueOnce('Add note');

		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		await registered_command();

		expect(context.globalState._store['dulcet.lastRepo']).toBe('myorg/notes-repo');
		expect(context.globalState._store['dulcet.lastBranch']).toBe('develop');
	});

	it('shows error message on save failure', async () => {
		const github_uri = vscode.Uri.parse('github:///octocat/repo/main/test.md');
		vscode.window.activeTextEditor = {
			document: {
				uri: github_uri,
				getText: () => '# Content',
			},
			viewColumn: 1,
		} as any;

		(globalThis as any).fetch = jest.fn()
			.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({}) });

		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('Update test.md');

		await registered_command();

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining('Save failed'),
		);
	});
});

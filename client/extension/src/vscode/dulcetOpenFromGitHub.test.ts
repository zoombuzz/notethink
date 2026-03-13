import * as vscode from 'vscode';
import { GitHubFileSystemProvider } from './githubFileSystemProvider';
import {
	registerOpenFromGitHub,
	handleUrlOpening,
	getRecentFiles,
	fetchBranches,
	browseFiles,
} from './dulcetOpenFromGitHub';

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

describe('fetchBranches', () => {
	afterEach(() => {
		(globalThis as any).fetch = undefined;
	});

	it('returns branch names from GitHub API', async () => {
		(globalThis as any).fetch = mockFetchOk([
			{ name: 'main' },
			{ name: 'develop' },
			{ name: 'feature/x' },
		]);

		const result = await fetchBranches(API_BASE, 'octocat', 'hello-world');
		expect(result).toEqual(['main', 'develop', 'feature/x']);
		expect((globalThis as any).fetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/github/repos/octocat/hello-world/branches'),
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('returns empty array on API error', async () => {
		(globalThis as any).fetch = mockFetchFail(404);
		const result = await fetchBranches(API_BASE, 'octocat', 'missing');
		expect(result).toEqual([]);
	});
});

describe('browseFiles', () => {
	afterEach(() => {
		(globalThis as any).fetch = undefined;
		jest.restoreAllMocks();
	});

	it('returns selected file path', async () => {
		(globalThis as any).fetch = mockFetchOk([
			{ name: 'docs', path: 'docs', type: 'dir' },
			{ name: 'README.md', path: 'README.md', type: 'file' },
		]);

		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
			label: '$(file) README.md',
			description: 'README.md',
		});

		const result = await browseFiles(API_BASE, 'octocat', 'repo', 'main');
		expect(result).toBe('README.md');
	});

	it('navigates into directories and back', async () => {
		const fetch_mock = jest.fn();
		// first call: repo root
		fetch_mock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([
				{ name: 'docs', path: 'docs', type: 'dir' },
				{ name: 'README.md', path: 'README.md', type: 'file' },
			]),
		});
		// second call: docs/ directory
		fetch_mock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([
				{ name: 'guide.md', path: 'docs/guide.md', type: 'file' },
			]),
		});
		(globalThis as any).fetch = fetch_mock;

		(vscode.window.showQuickPick as jest.Mock)
			// select docs directory
			.mockResolvedValueOnce({ label: '$(folder) docs', description: 'docs' })
			// select guide.md
			.mockResolvedValueOnce({ label: '$(file) guide.md', description: 'docs/guide.md' });

		const result = await browseFiles(API_BASE, 'octocat', 'repo', 'main');
		expect(result).toBe('docs/guide.md');
		expect(fetch_mock).toHaveBeenCalledTimes(2);
	});

	it('returns undefined when user cancels', async () => {
		(globalThis as any).fetch = mockFetchOk([
			{ name: 'README.md', path: 'README.md', type: 'file' },
		]);
		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

		const result = await browseFiles(API_BASE, 'octocat', 'repo', 'main');
		expect(result).toBeUndefined();
	});

	it('shows error on API failure', async () => {
		(globalThis as any).fetch = mockFetchFail(500);

		const result = await browseFiles(API_BASE, 'octocat', 'repo', 'main');
		expect(result).toBeUndefined();
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining('Failed to list files'),
		);
	});
});

describe('registerOpenFromGitHub', () => {
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

		registerOpenFromGitHub(context, provider, API_BASE);
	});

	afterEach(() => {
		(globalThis as any).fetch = undefined;
		jest.restoreAllMocks();
	});

	it('registers the dulcet.openFromGitHub command', () => {
		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			'dulcet.openFromGitHub',
			expect.any(Function),
		);
	});

	it('shows browse option when no recent files', async () => {
		// auth passes
		(globalThis as any).fetch = mockFetchOk();

		// user cancels QuickPick
		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

		await registered_command();

		expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ label: expect.stringContaining('Browse repository') }),
			]),
			expect.any(Object),
		);
	});

	it('shows recent files when available', async () => {
		context.globalState._store['dulcet.recentFiles'] = [
			{ owner: 'octocat', repo: 'notes', branch: 'main', filepath: 'test.md', timestamp: Date.now() },
		];

		(globalThis as any).fetch = mockFetchOk();
		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

		await registered_command();

		const picks = (vscode.window.showQuickPick as jest.Mock).mock.calls[0][0];
		expect(picks[0].label).toBe('test.md');
		expect(picks[0].description).toBe('octocat/notes (main)');
	});

	it('opens recent file when selected', async () => {
		context.globalState._store['dulcet.recentFiles'] = [
			{ owner: 'octocat', repo: 'notes', branch: 'main', filepath: 'docs/note.md', timestamp: Date.now() },
		];

		(globalThis as any).fetch = mockFetchOk();
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		// select the recent file
		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
			label: 'docs/note.md',
			description: 'octocat/notes (main)',
		});

		await registered_command();

		expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
		const open_uri = (vscode.workspace.openTextDocument as jest.Mock).mock.calls[0][0];
		expect(open_uri.scheme).toBe('github');
		expect(open_uri.path).toContain('octocat/notes/main/docs/note.md');
		// should execute notethink.openview for .md files
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('notethink.openview');
	});

	it('full browse flow: repo → branch → file → open', async () => {
		let fetch_call = 0;
		(globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
			fetch_call++;
			if (fetch_call === 1) {
				// auth check
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
			}
			if (url.includes('/branches')) {
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.resolve([{ name: 'main' }, { name: 'develop' }]),
				});
			}
			// contents listing
			return Promise.resolve({
				ok: true,
				status: 200,
				json: () => Promise.resolve([
					{ name: 'notes.md', path: 'notes.md', type: 'file' },
				]),
			});
		});

		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		// select "Browse"
		(vscode.window.showQuickPick as jest.Mock)
			.mockResolvedValueOnce({ label: expect.stringContaining('Browse'), description: 'Enter repository and browse files' })
			// select branch
			.mockResolvedValueOnce('main')
			// select file
			.mockResolvedValueOnce({ label: '$(file) notes.md', description: 'notes.md' });

		// the first showQuickPick call is for the main menu
		// need to make it match the BROWSE_LABEL
		(vscode.window.showQuickPick as jest.Mock).mockReset();
		(vscode.window.showQuickPick as jest.Mock)
			.mockResolvedValueOnce({ label: '$(folder-opened) Browse repository\u2026', description: 'Enter repository and browse files' })
			.mockResolvedValueOnce('main')
			.mockResolvedValueOnce({ label: '$(file) notes.md', description: 'notes.md' });

		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('octocat/my-notes');

		await registered_command();

		expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
		expect(context.globalState._store['dulcet.lastRepo']).toBe('octocat/my-notes');
		expect(context.globalState._store['dulcet.lastBranch']).toBe('main');
	});

	it('cancels when user dismisses repo input', async () => {
		(globalThis as any).fetch = mockFetchOk();

		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
			label: '$(folder-opened) Browse repository\u2026',
			description: 'Enter repository and browse files',
		});
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

		await registered_command();

		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
	});

	it('shows error when no branches found', async () => {
		let fetch_call = 0;
		(globalThis as any).fetch = jest.fn().mockImplementation(() => {
			fetch_call++;
			if (fetch_call === 1) {
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
			}
			// branches returns empty
			return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
		});

		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
			label: '$(folder-opened) Browse repository\u2026',
			description: 'Enter repository and browse files',
		});
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('octocat/missing');

		await registered_command();

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining('Could not fetch branches'),
		);
	});

	it('stores opened file in recent files', async () => {
		context.globalState._store['dulcet.recentFiles'] = [
			{ owner: 'old', repo: 'repo', branch: 'main', filepath: 'old.md', timestamp: 1 },
		];

		(globalThis as any).fetch = mockFetchOk();
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		// select a recent file
		(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
			label: 'old.md',
			description: 'old/repo (main)',
		});

		await registered_command();

		const recents = context.globalState._store['dulcet.recentFiles'];
		expect(recents[0].filepath).toBe('old.md');
		expect(recents[0].timestamp).toBeGreaterThan(1);
	});
});

describe('handleUrlOpening', () => {
	let context: any;

	beforeEach(() => {
		jest.clearAllMocks();
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
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('opens file from dulcet.openFile config', async () => {
		(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
			get: jest.fn(() => 'octocat/notes/main/docs/readme.md'),
		});
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		await handleUrlOpening(context);

		expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
		const open_uri = (vscode.workspace.openTextDocument as jest.Mock).mock.calls[0][0];
		expect(open_uri.scheme).toBe('github');
		expect(open_uri.path).toContain('octocat/notes/main/docs/readme.md');
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('notethink.openview');
	});

	it('does nothing when no openFile config', async () => {
		(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
			get: jest.fn(() => undefined),
		});

		await handleUrlOpening(context);

		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
	});

	it('does nothing when path has fewer than 4 segments', async () => {
		(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
			get: jest.fn(() => 'octocat/notes/main'),
		});

		await handleUrlOpening(context);

		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
	});

	it('adds opened file to recent files', async () => {
		(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
			get: jest.fn(() => 'octocat/notes/main/test.md'),
		});
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({});
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

		await handleUrlOpening(context);

		const recents = context.globalState._store['dulcet.recentFiles'];
		expect(recents).toHaveLength(1);
		expect(recents[0]).toEqual(expect.objectContaining({
			owner: 'octocat',
			repo: 'notes',
			branch: 'main',
			filepath: 'test.md',
		}));
	});
});

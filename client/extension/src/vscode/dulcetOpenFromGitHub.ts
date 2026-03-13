import * as vscode from 'vscode';
import { GitHubFileSystemProvider } from './githubFileSystemProvider';
import { ensureAuthenticated } from './dulcetSaveToGitHub';

const RECENT_FILES_KEY = 'dulcet.recentFiles';
const MAX_RECENT_FILES = 20;
const BROWSE_LABEL = '$(folder-opened) Browse repository\u2026';

interface RecentFile {
	owner: string;
	repo: string;
	branch: string;
	filepath: string;
	timestamp: number;
}

interface GitHubBranch {
	name: string;
}

interface GitHubContentItem {
	name: string;
	path: string;
	type: 'file' | 'dir' | 'symlink' | 'submodule';
}

// --- helpers ---

async function githubApiFetch(apiBaseUrl: string, path: string): Promise<Response> {
	return fetch(`${apiBaseUrl}/api/github/${path}`, {
		headers: { 'Accept': 'application/vnd.github.v3+json' },
		credentials: 'include',
	});
}

export async function fetchBranches(apiBaseUrl: string, owner: string, repo: string): Promise<string[]> {
	const response = await githubApiFetch(
		apiBaseUrl,
		`repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
	);
	if (!response.ok) { return []; }
	const data = await response.json() as GitHubBranch[];
	return data.map(b => b.name);
}

export async function browseFiles(
	apiBaseUrl: string,
	owner: string,
	repo: string,
	branch: string,
): Promise<string | undefined> {
	let current_path = '';

	while (true) {
		const path_segment = current_path
			? current_path.split('/').map(encodeURIComponent).join('/')
			: '';
		const api_path = path_segment
			? `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path_segment}?ref=${encodeURIComponent(branch)}`
			: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`;

		const response = await githubApiFetch(apiBaseUrl, api_path);
		if (!response.ok) {
			vscode.window.showErrorMessage(`Failed to list files: HTTP ${response.status}`);
			return undefined;
		}

		const items = await response.json() as GitHubContentItem[];
		const sorted = [...items].sort((a, b) => {
			if (a.type === 'dir' && b.type !== 'dir') { return -1; }
			if (a.type !== 'dir' && b.type === 'dir') { return 1; }
			return a.name.localeCompare(b.name);
		});

		const picks: vscode.QuickPickItem[] = [];
		if (current_path) {
			picks.push({ label: '..', description: 'Parent directory' });
		}
		for (const item of sorted) {
			const icon = item.type === 'dir' ? '$(folder)' : '$(file)';
			picks.push({ label: `${icon} ${item.name}`, description: item.path });
		}

		const place_holder = current_path
			? `${owner}/${repo}/${current_path}/`
			: `${owner}/${repo}/`;

		const selection = await vscode.window.showQuickPick(picks, {
			placeHolder: place_holder,
			title: 'Select a file to open',
		});

		if (!selection) { return undefined; }

		if (selection.label === '..') {
			current_path = current_path.split('/').slice(0, -1).join('/');
			continue;
		}

		const selected_path = selection.description!;
		const selected_item = sorted.find(i => i.path === selected_path);
		if (!selected_item) { return undefined; }

		if (selected_item.type === 'dir') {
			current_path = selected_item.path;
			continue;
		}

		return selected_item.path;
	}
}

export function getRecentFiles(context: vscode.ExtensionContext): RecentFile[] {
	return context.globalState.get<RecentFile[]>(RECENT_FILES_KEY) ?? [];
}

function addRecentFile(context: vscode.ExtensionContext, file: Omit<RecentFile, 'timestamp'>): void {
	const recents = getRecentFiles(context);
	const updated = [
		{ ...file, timestamp: Date.now() },
		...recents.filter(r =>
			!(r.owner === file.owner && r.repo === file.repo && r.filepath === file.filepath && r.branch === file.branch),
		),
	].slice(0, MAX_RECENT_FILES);
	context.globalState.update(RECENT_FILES_KEY, updated);
}

async function openGitHubFileAndView(
	owner: string,
	repo: string,
	branch: string,
	filepath: string,
): Promise<void> {
	const uri = GitHubFileSystemProvider.createUri(owner, repo, branch, filepath);
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });

	// auto-open NoteThink view for markdown files
	if (filepath.endsWith('.md')) {
		await vscode.commands.executeCommand('notethink.openview');
	}
}

// --- registration ---

export function registerOpenFromGitHub(
	context: vscode.ExtensionContext,
	github_fs: GitHubFileSystemProvider,
	api_base_url: string,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('dulcet.openFromGitHub', async () => {
			const authenticated = await ensureAuthenticated(github_fs, api_base_url);
			if (!authenticated) { return; }

			// build QuickPick: recent files + browse option
			const recents = getRecentFiles(context);
			const picks: vscode.QuickPickItem[] = [];

			for (const recent of recents) {
				picks.push({
					label: recent.filepath,
					description: `${recent.owner}/${recent.repo} (${recent.branch})`,
				});
			}

			if (recents.length > 0) {
				picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
			}
			picks.push({ label: BROWSE_LABEL, description: 'Enter repository and browse files' });

			const choice = await vscode.window.showQuickPick(picks, {
				placeHolder: 'Select a recent file or browse a repository',
				title: 'Open from GitHub',
			});

			if (!choice) { return; }

			if (choice.label !== BROWSE_LABEL) {
				// user selected a recent file
				const recent = recents.find(r =>
					r.filepath === choice.label
					&& choice.description === `${r.owner}/${r.repo} (${r.branch})`,
				);
				if (recent) {
					addRecentFile(context, recent);
					await openGitHubFileAndView(recent.owner, recent.repo, recent.branch, recent.filepath);
				}
				return;
			}

			// browse flow: step 1 - owner/repo
			const last_repo = context.globalState.get<string>('dulcet.lastRepo') ?? '';
			const repo_input = await vscode.window.showInputBox({
				prompt: 'Repository (owner/repo)',
				placeHolder: 'octocat/my-notes',
				value: last_repo,
				validateInput: (value) => {
					if (!value.match(/^[^/]+\/[^/]+$/)) {
						return 'Enter as owner/repo (e.g. octocat/my-notes)';
					}
					return undefined;
				},
			});
			if (!repo_input) { return; }

			const [owner, repo] = repo_input.split('/');

			// step 2 - select branch
			const branches = await fetchBranches(api_base_url, owner, repo);
			if (branches.length === 0) {
				vscode.window.showErrorMessage(
					`Could not fetch branches for ${repo_input}. Check the repository name and your permissions.`,
				);
				return;
			}

			const last_branch = context.globalState.get<string>('dulcet.lastBranch') ?? 'main';
			const sorted_branches = [...branches].sort((a, b) => {
				if (a === last_branch) { return -1; }
				if (b === last_branch) { return 1; }
				if (a === 'main') { return -1; }
				if (b === 'main') { return 1; }
				return a.localeCompare(b);
			});

			const branch_pick = await vscode.window.showQuickPick(sorted_branches, {
				placeHolder: 'Select a branch',
				title: `${owner}/${repo}`,
			});
			if (!branch_pick) { return; }

			// step 3 - browse and select file
			const filepath = await browseFiles(api_base_url, owner, repo, branch_pick);
			if (!filepath) { return; }

			// remember for next time
			await context.globalState.update('dulcet.lastRepo', repo_input);
			await context.globalState.update('dulcet.lastBranch', branch_pick);

			// add to recents and open
			addRecentFile(context, { owner, repo, branch: branch_pick, filepath });
			await openGitHubFileAndView(owner, repo, branch_pick, filepath);
		}),
	);
}

// --- URL-based opening ---

export async function handleUrlOpening(
	context: vscode.ExtensionContext,
): Promise<void> {
	const open_file = vscode.workspace.getConfiguration('dulcet').get<string>('openFile');
	if (!open_file) { return; }

	// parse owner/repo/branch/rest...
	const parts = open_file.split('/').filter(Boolean);
	if (parts.length < 4) { return; }

	const [owner, repo, branch, ...rest] = parts;
	const filepath = rest.join('/');

	addRecentFile(context, { owner, repo, branch, filepath });
	await openGitHubFileAndView(owner, repo, branch, filepath);
}

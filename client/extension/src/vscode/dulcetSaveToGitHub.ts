import * as vscode from 'vscode';
import { GitHubFileSystemProvider } from './githubFileSystemProvider';

const AUTH_POLL_INTERVAL_MS = 2000;
const AUTH_POLL_TIMEOUT_MS = 120000;

interface SaveTarget {
	owner: string;
	repo: string;
	branch: string;
	filepath: string;
	message: string;
}

export async function ensureAuthenticated(
	github_fs: GitHubFileSystemProvider,
	api_base_url: string,
): Promise<boolean> {
	if (await github_fs.checkAuthenticated()) {
		return true;
	}

	const choice = await vscode.window.showInformationMessage(
		'Sign in to GitHub to save your work.',
		'Sign In',
		'Cancel',
	);
	if (choice !== 'Sign In') {
		return false;
	}

	const login_uri = vscode.Uri.parse(`${api_base_url}/api/auth/github/login`);
	await vscode.env.openExternal(login_uri);

	// poll for auth completion
	github_fs.clearAuthCache();
	const start = Date.now();
	while (Date.now() - start < AUTH_POLL_TIMEOUT_MS) {
		await new Promise(resolve => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
		github_fs.clearAuthCache();
		if (await github_fs.checkAuthenticated()) {
			vscode.window.showInformationMessage('Signed in to GitHub successfully.');
			return true;
		}
	}

	vscode.window.showErrorMessage('GitHub sign-in timed out. Please try again.');
	return false;
}

async function promptSaveTarget(
	context: vscode.ExtensionContext,
	default_filename: string,
): Promise<SaveTarget | undefined> {
	const last_repo = context.globalState.get<string>('dulcet.lastRepo') ?? '';
	const last_branch = context.globalState.get<string>('dulcet.lastBranch') ?? 'main';

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
	if (!repo_input) { return undefined; }

	const filepath_input = await vscode.window.showInputBox({
		prompt: 'File path in repository',
		placeHolder: 'notes/my-note.md',
		value: default_filename,
	});
	if (!filepath_input) { return undefined; }

	const branch_input = await vscode.window.showInputBox({
		prompt: 'Branch',
		value: last_branch,
	});
	if (!branch_input) { return undefined; }

	const message_input = await vscode.window.showInputBox({
		prompt: 'Commit message',
		value: `Update ${filepath_input}`,
	});
	if (!message_input) { return undefined; }

	const [owner, repo] = repo_input.split('/');

	// remember for next time
	await context.globalState.update('dulcet.lastRepo', repo_input);
	await context.globalState.update('dulcet.lastBranch', branch_input);

	return {
		owner,
		repo,
		branch: branch_input,
		filepath: filepath_input,
		message: message_input,
	};
}

async function promptCommitMessage(filepath: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		prompt: 'Commit message',
		value: `Update ${filepath}`,
	});
}

export function registerSaveToGitHub(
	context: vscode.ExtensionContext,
	github_fs: GitHubFileSystemProvider,
	api_base_url: string,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('dulcet.saveToGitHub', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('No active editor to save.');
				return;
			}

			const doc = editor.document;
			const content = new TextEncoder().encode(doc.getText());

			// check auth
			const authenticated = await ensureAuthenticated(github_fs, api_base_url);
			if (!authenticated) { return; }

			if (doc.uri.scheme === 'github') {
				// already on GitHub — prompt for commit message only
				const parsed = GitHubFileSystemProvider.parseUri(doc.uri);
				const message = await promptCommitMessage(parsed.filepath);
				if (!message) { return; }

				try {
					await github_fs.commitFile(doc.uri, content, message);
					vscode.window.showInformationMessage(`Saved to GitHub: ${parsed.filepath}`);
				} catch (err) {
					vscode.window.showErrorMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			} else {
				// untitled or local document — full save dialog
				const filename = doc.uri.path.split('/').pop() ?? 'untitled.md';
				const default_name = filename.startsWith('Untitled') ? 'notes/untitled.md' : filename;

				const target = await promptSaveTarget(context, default_name);
				if (!target) { return; }

				const github_uri = GitHubFileSystemProvider.createUri(
					target.owner,
					target.repo,
					target.branch,
					target.filepath,
				);

				try {
					await github_fs.commitFile(github_uri, content, target.message);
					vscode.window.showInformationMessage(`Saved to GitHub: ${target.owner}/${target.repo}/${target.filepath}`);

					// open the file from GitHub so subsequent saves use the github:// scheme
					const github_doc = await vscode.workspace.openTextDocument(github_uri);
					await vscode.window.showTextDocument(github_doc, { viewColumn: editor.viewColumn });
				} catch (err) {
					vscode.window.showErrorMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}),
	);
}

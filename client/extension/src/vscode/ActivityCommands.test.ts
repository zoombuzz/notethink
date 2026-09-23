import * as vscode from 'vscode';
import { ActivityCommands } from './ActivityCommands';
import type { ActivityTree } from '../types/AgentActivity';

const WORKSPACE_PATH = '/ws';
const ROOT_PATH = '/ws/notethink';
const TRANSCRIPTS: Record<string, string> = {
	'claude-bound-busy': '/home/test/.claude/projects/-ws-notethink/claude-bound-busy.jsonl',
	'codex-no-question': '/home/test/.codex/sessions/2026/09/22/rollout-codex-no-question.jsonl',
};

function makeTree(): ActivityTree {
	return {
		generated_at: '2026-09-22T00:00:00Z',
		branch: 'staging',
		head_commit: 'a'.repeat(40),
		uncommitted: [
			{ path: 'package.json', change: 'modified' },
			{ path: 'client/extension/src/types/AgentActivity.ts', change: 'added' },
			{ path: 'media/board-icon.png', change: 'deleted' },
		],
		committed: [{ sha: 'b'.repeat(40), subject: 'first commit', session_id: 'claude-bound-busy' }],
	};
}

describe('opening what an activity row points at', () => {
	let posted: Array<Record<string, unknown>>;
	let statted: string[];
	let commands: ActivityCommands;
	let tree: ActivityTree;

	function mountWorkspace(present_paths: string[]): void {
		statted = [];
		(vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file(WORKSPACE_PATH), name: 'ws', index: 0 }];
		(vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
			statted.push(uri.path);
			if (!present_paths.includes(uri.path)) { throw new Error(`no such file ${uri.path}`); }
			return { type: 1, ctime: 0, mtime: 0, size: 10 };
		});
	}

	beforeEach(() => {
		jest.clearAllMocks();
		posted = [];
		tree = makeTree();
		mountWorkspace([
			`${ROOT_PATH}/package.json`,
			`${ROOT_PATH}/client/extension/src/types/AgentActivity.ts`,
		]);
		commands = new ActivityCommands(
			vscode.Uri.file(WORKSPACE_PATH),
			{
				treeFor: (root_path: string) => root_path === ROOT_PATH ? tree : undefined,
				transcriptPathFor: (session_id: string) => TRANSCRIPTS[session_id],
			},
			message => posted.push(message),
		);
	});

	async function openDiff(file_path: string): Promise<boolean> {
		return commands.handleMessage({ type: 'openActivityDiff', root_path: ROOT_PATH, path: file_path });
	}

	it('diffs a modified file against a live git: HEAD URI, never a stored copy', async () => {
		expect(await openDiff('package.json')).toBe(true);
		const [command, left, right, title] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
		expect(command).toBe('vscode.diff');
		expect((left as vscode.Uri).scheme).toBe('git');
		expect(JSON.parse((left as vscode.Uri).query)).toEqual({ path: `${ROOT_PATH}/package.json`, ref: 'HEAD' });
		expect((right as vscode.Uri).path).toBe(`${ROOT_PATH}/package.json`);
		expect(title).toContain('package.json');
		expect(posted).toEqual([]);
	});

	it('opens an added file on its own, since an added file has no committed side to read', async () => {
		await openDiff('client/extension/src/types/AgentActivity.ts');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		const [uri] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
		expect((uri as vscode.Uri).path).toBe(`${ROOT_PATH}/client/extension/src/types/AgentActivity.ts`);
	});

	it('opens a deleted file on its own, from its committed side, since it has no working-tree side left to diff against', async () => {
		mountWorkspace([]);
		await openDiff('media/board-icon.png');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		const [uri] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
		expect((uri as vscode.Uri).scheme).toBe('git');
	});

	it('refuses a path outside the workspace without so much as looking for it', async () => {
		tree.uncommitted.push({ path: '../../etc/passwd', change: 'modified' });
		expect(await openDiff('../../etc/passwd')).toBe(true);
		expect(statted).not.toContain('/etc/passwd');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		expect(posted[0]).toEqual({ type: 'activityUnavailable', request: 'diff', reason: 'no_side', path: '../../etc/passwd' });
	});

	it('refuses a path the uncommitted band does not list, and a root the analyser has read no tree for', async () => {
		await openDiff('client/extension/src/lib/errorops.ts');
		expect(posted[0].reason).toBe('not_listed');
		await commands.handleMessage({ type: 'openActivityDiff', root_path: '/ws/elsewhere', path: 'package.json' });
		expect(posted[1].reason).toBe('unknown_root');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('leaves a message it does not own to the panel that called it', async () => {
		expect(await commands.handleMessage({ type: 'openFile', path: '/ws/notethink/README.md' })).toBe(false);
	});

	it('hands a Claude Code session to its own chat panel', async () => {
		expect(await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' })).toBe(true);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('claude-vscode.editor.open', 'claude-bound-busy');
		expect(posted).toEqual([]);
	});

	it('opens a session from a vendor with no chat panel as its own transcript, beside the board', async () => {
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'codex', session_id: 'codex-no-question' });
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		const [uri, options] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
		expect((uri as vscode.Uri).path).toBe(TRANSCRIPTS['codex-no-question']);
		expect(options).toEqual(expect.objectContaining({ viewColumn: vscode.ViewColumn.Beside }));
		expect(posted).toEqual([]);
	});

	it('opens the transcript when the vendor command fails', async () => {
		(vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('command not found'));
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' });
		const [uri] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
		expect((uri as vscode.Uri).path).toBe(TRANSCRIPTS['claude-bound-busy']);
		expect(posted).toEqual([]);
	});

	it('refuses a session the analyser has read no transcript for, and an unsafe session id', async () => {
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'grok', session_id: 'grok-never-scanned' });
		expect(posted[0]).toEqual({ type: 'activityUnavailable', request: 'chat', reason: 'no_transcript', session_id: 'grok-never-scanned' });
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: '../../../etc/passwd' });
		expect(posted[1].reason).toBe('bad_request');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
	});
});

import * as vscode from 'vscode';
import { createMockWebviewPanel } from '../__mocks__/vscode';
import { ActivityCommands } from './ActivityCommands';
import type { ActivityTree } from '../types/AgentActivity';

const WORKSPACE_PATH = '/ws';
const ROOT_PATH = '/ws/notethink';
/*
 * '-ws' is /ws encoded the way Claude Code names its project directories (agenthomeops.encodeClaudeProjectDirName), so
 * 'claude-root-session' is the one whose own cwd was the workspace root itself; 'claude-bound-busy' ran in a subfolder
 * repo under it, so its own encoded directory ('-ws-notethink') differs.
 */
const TRANSCRIPTS: Record<string, string> = {
	'claude-root-session': '/home/test/.claude/projects/-ws/claude-root-session.jsonl',
	'claude-bound-busy': '/home/test/.claude/projects/-ws-notethink/claude-bound-busy.jsonl',
	'codex-no-question': '/home/test/.codex/sessions/2026/09/22/rollout-codex-no-question.jsonl',
	'grok-no-text': '/home/test/.grok/sessions/-ws/grok-no-text/events.jsonl',
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
				transcriptUriFor: (session_id: string) => TRANSCRIPTS[session_id] === undefined ? undefined : vscode.Uri.file(TRANSCRIPTS[session_id]),
			},
			message => posted.push(message),
			() => vscode.ViewColumn.Two,
		);
	});

	// the chat view reads the transcript's bytes and opens a webview panel in the viewer-anchored column
	function mockChatPanel(transcript_text: string = ''): ReturnType<typeof createMockWebviewPanel> {
		const helper = createMockWebviewPanel();
		(vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(helper.panel);
		(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(new TextEncoder().encode(transcript_text));
		return helper;
	}

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

	it('hands a Claude Code session started at the workspace root to its own chat panel, in the viewer-anchored column', async () => {
		expect(await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-root-session' })).toBe(true);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('claude-vscode.editor.open', 'claude-root-session', undefined, vscode.ViewColumn.Two);
		expect(posted).toEqual([]);
	});

	it('opens the notethink chat view instead of the chat panel for a session started in a subfolder, since the panel would only start a blank chat', async () => {
		const line = JSON.stringify({ type: 'user', timestamp: '2026-09-22T10:00:00Z', message: { role: 'user', content: 'hello from a subfolder' } });
		const helper = mockChatPanel(`${line}\n`);
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' });
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		const [, , show_options] = (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0];
		expect(show_options).toEqual(expect.objectContaining({ viewColumn: vscode.ViewColumn.Two }));
		expect(((vscode.workspace.fs.readFile as jest.Mock).mock.calls[0][0] as vscode.Uri).path).toBe(TRANSCRIPTS['claude-bound-busy']);
		expect((helper.panel as { webview: { html: string } }).webview.html).toContain('hello from a subfolder');
		expect(posted).toEqual([]);
	});

	it('in a multi-root workspace, opens the chat for a session under workspaceFolders[0] even when the board sits in a different folder', async () => {
		(vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
			{ uri: vscode.Uri.file(WORKSPACE_PATH), name: 'ws', index: 0 },
			{ uri: vscode.Uri.file('/ws2'), name: 'ws2', index: 1 },
		];
		// the board's own folder is the SECOND root, deliberately not workspaceFolders[0]
		const multi_root_commands = new ActivityCommands(
			vscode.Uri.file('/ws2'),
			{ treeFor: () => undefined, transcriptUriFor: () => vscode.Uri.file(TRANSCRIPTS['claude-root-session']) },
			message => posted.push(message),
			() => vscode.ViewColumn.Two,
		);
		await multi_root_commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-root-session' });
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('claude-vscode.editor.open', 'claude-root-session', undefined, vscode.ViewColumn.Two);
	});

	it('in a multi-root workspace, opens the chat view for a session under the board\'s own folder when that is not workspaceFolders[0]', async () => {
		(vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [
			{ uri: vscode.Uri.file(WORKSPACE_PATH), name: 'ws', index: 0 },
			{ uri: vscode.Uri.file('/ws2'), name: 'ws2', index: 1 },
		];
		const second_folder_transcript = '/home/test/.claude/projects/-ws2/claude-second-folder-session.jsonl';
		// the board's own folder is the SECOND root; the session's own project directory names that root, not workspaceFolders[0]
		const multi_root_commands = new ActivityCommands(
			vscode.Uri.file('/ws2'),
			{ treeFor: () => undefined, transcriptUriFor: () => vscode.Uri.file(second_folder_transcript) },
			message => posted.push(message),
			() => vscode.ViewColumn.Two,
		);
		mockChatPanel();
		await multi_root_commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-second-folder-session' });
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(((vscode.workspace.fs.readFile as jest.Mock).mock.calls[0][0] as vscode.Uri).path).toBe(second_folder_transcript);
	});

	it('reads a transcript on the remote host it came from, never rebuilding it as a local file', async () => {
		const remote_transcript = vscode.Uri.parse('vscode-remote://ssh-remote%2Bdevhost/home/test/.claude/projects/-ws-notethink/claude-bound-busy.jsonl');
		const remote_commands = new ActivityCommands(
			vscode.Uri.file(WORKSPACE_PATH),
			{ treeFor: () => undefined, transcriptUriFor: () => remote_transcript },
			message => posted.push(message),
			() => vscode.ViewColumn.Two,
		);
		mockChatPanel();
		await remote_commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' });
		expect(((vscode.workspace.fs.readFile as jest.Mock).mock.calls[0][0] as vscode.Uri).toString()).toBe(remote_transcript.toString());
		expect(posted).toEqual([]);
	});

	it('opens a session from a vendor with no chat panel as a chat view, in the viewer-anchored column', async () => {
		const line = JSON.stringify({ type: 'response_item', timestamp: '2026-09-22T10:00:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex says hi' }] } });
		const helper = mockChatPanel(`${line}\n`);
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'codex', session_id: 'codex-no-question' });
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		const [, , show_options] = (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0];
		expect(show_options).toEqual(expect.objectContaining({ viewColumn: vscode.ViewColumn.Two }));
		expect((helper.panel as { webview: { html: string } }).webview.html).toContain('codex says hi');
		expect(posted).toEqual([]);
	});

	it('shows a clear notice, not an empty page, for a vendor whose transcript carries no conversation', async () => {
		const helper = mockChatPanel('{"type":"tool_started","tool_name":"x"}\n');
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'grok', session_id: 'grok-no-text' });
		expect((vscode.workspace.fs.readFile as jest.Mock)).not.toHaveBeenCalled();
		expect((helper.panel as { webview: { html: string } }).webview.html).toContain('cannot be rendered as a chat');
	});

	it('reveals and refreshes the existing chat view when the same session is clicked again, rather than opening a second', async () => {
		const helper = mockChatPanel('');
		const message = { type: 'openActivityChat', vendor: 'codex', session_id: 'codex-no-question' };
		await commands.handleMessage(message);
		await commands.handleMessage(message);
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
		expect((helper.panel as { reveal: jest.Mock }).reveal).toHaveBeenCalledWith(vscode.ViewColumn.Two, false);
		expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(2);
	});

	it('opens the raw transcript when the chat view asks for it, as the old fallback did', async () => {
		const helper = mockChatPanel('');
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'codex', session_id: 'codex-no-question' });
		await helper.simulateMessage({ type: 'openRaw' });
		const [uri, options] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
		expect((uri as vscode.Uri).path).toBe(TRANSCRIPTS['codex-no-question']);
		expect(options).toEqual(expect.objectContaining({ viewColumn: vscode.ViewColumn.Two }));
	});

	it('reports activityUnavailable when the transcript cannot be read, never throwing at the webview', async () => {
		mockChatPanel();
		(vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no such file'));
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'codex', session_id: 'codex-no-question' });
		expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
		expect(posted).toEqual([{ type: 'activityUnavailable', request: 'chat', reason: 'open_failed', session_id: 'codex-no-question' }]);
	});

	it('opens the chat view, in the viewer-anchored column, when the vendor command rejects a session it should have been able to open', async () => {
		(vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('command not found'));
		mockChatPanel();
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-root-session' });
		expect(((vscode.workspace.fs.readFile as jest.Mock).mock.calls[0][0] as vscode.Uri).path).toBe(TRANSCRIPTS['claude-root-session']);
		const [, , show_options] = (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0];
		expect(show_options).toEqual(expect.objectContaining({ viewColumn: vscode.ViewColumn.Two }));
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

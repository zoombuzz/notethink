import * as fs from 'node:fs';
import * as nodepath from 'node:path';
import * as vscode from 'vscode';
import { ActivityCommands } from './ActivityCommands';
import { parseActivityTree } from '../lib/activityops';
import type { ActivityTree } from '../types/AgentActivity';

/*
 * The opener is driven with the fixture working tree, because the admission rule under test is
 * "the contract lists this path": a tree restated here would let the gate and the fixture drift
 * apart, and the fixture is what a producer reads as documentation.
 */
const FIXTURES_DIR = nodepath.join(__dirname, '..', '..', '..', '..', 'playwright', 'fixtures', 'activity');
const WORKSPACE_PATH = '/ws';
const ROOT_PATH = '/ws/notethink';
const CONTRACT_PATH = `${ROOT_PATH}/.notethink`;
const BASE_BLOB = 'blobs/8c3a9f11da1abebb774cc753cfeccd67c68d8ae3a29479756f9f556eee4453b0.json';

function fixtureTree(): ActivityTree {
	const parsed = parseActivityTree(fs.readFileSync(nodepath.join(FIXTURES_DIR, 'tree.json'), 'utf-8'));
	if (!parsed.ok) { throw new Error(`the tree fixture was refused: ${parsed.reason}`); }
	return parsed.value;
}

describe('opening what an activity row points at', () => {
	let posted: Array<Record<string, unknown>>;
	let statted: string[];
	let commands: ActivityCommands;
	let tree: ActivityTree;

	// every path the fixture tree names, plus the blobs it references, as files that exist
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
		tree = fixtureTree();
		mountWorkspace([
			`${ROOT_PATH}/client/extension/src/types/AgentActivity.ts`,
			`${ROOT_PATH}/package.json`,
			`${ROOT_PATH}/client/webview/src/notethink-views/src/components/notes/StickyNote.tsx`,
			`${CONTRACT_PATH}/${BASE_BLOB}`,
			`${CONTRACT_PATH}/blobs/2fed2679082ce5e91ec373df6ffcf62e1a4b450889cc9c99e6616fdd9699c4c5.tsx`,
			`${CONTRACT_PATH}/blobs/a2631be9937502ce7ea9ad0997b1348b56f0c82f0233250348eeea36ea5fd4e8.tsx`,
		]);
		commands = new ActivityCommands(
			vscode.Uri.file(WORKSPACE_PATH),
			{ treeFor: (root_path: string) => root_path === ROOT_PATH ? tree : undefined },
			message => posted.push(message),
		);
	});

	async function openDiff(file_path: string, band = 'uncommitted'): Promise<boolean> {
		return commands.handleMessage({ type: 'openActivityDiff', root_path: ROOT_PATH, path: file_path, band });
	}

	it('admits a non-markdown path the contract lists, and diffs the stored side against the working file', async () => {
		expect(await openDiff('package.json')).toBe(true);
		const [command, left, right, title] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
		expect(command).toBe('vscode.diff');
		expect((left as vscode.Uri).path).toBe(`${CONTRACT_PATH}/${BASE_BLOB}`);
		expect((right as vscode.Uri).path).toBe(`${ROOT_PATH}/package.json`);
		expect(title).toContain('package.json');
		expect(posted).toEqual([]);
	});

	it('diffs both stored sides for a file changed by a commit on the branch', async () => {
		await openDiff('client/webview/src/notethink-views/src/components/notes/StickyNote.tsx', 'committed');
		const [, left, right] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
		expect((left as vscode.Uri).path).toContain('/blobs/2fed2679');
		expect((right as vscode.Uri).path).toContain('/blobs/a2631be9');
	});

	it('opens an added file on its own, since an added file has no left-hand side', async () => {
		await openDiff('client/extension/src/types/AgentActivity.ts');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		const [uri] = (vscode.window.showTextDocument as jest.Mock).mock.calls[0];
		expect((uri as vscode.Uri).path).toBe(`${ROOT_PATH}/client/extension/src/types/AgentActivity.ts`);
	});

	it('resolves a contract path against the contract root and nowhere else', async () => {
		// the same file sitting at the workspace-relative spelling instead: a producer never writes one, so it is not a second place to look
		mountWorkspace([`${WORKSPACE_PATH}/client/extension/src/types/AgentActivity.ts`]);
		await openDiff('client/extension/src/types/AgentActivity.ts');
		expect(statted).toEqual([`${ROOT_PATH}/client/extension/src/types/AgentActivity.ts`]);
		expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		expect(posted[0].reason).toBe('no_side');
	});

	it('refuses a path outside the workspace without so much as looking for it', async () => {
		tree.uncommitted.push({ path: '../../etc/passwd', change: 'modified' });
		expect(await openDiff('../../etc/passwd')).toBe(true);
		expect(statted).not.toContain('/etc/passwd');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		expect(posted[0]).toEqual({ type: 'activityUnavailable', request: 'diff', reason: 'no_side', path: '../../etc/passwd' });
	});

	it('refuses a path the contract does not list, and a root it has read no tree for', async () => {
		await openDiff('client/extension/src/lib/errorops.ts');
		expect(posted[0].reason).toBe('not_listed');
		await commands.handleMessage({ type: 'openActivityDiff', root_path: '/ws/elsewhere', path: 'package.json', band: 'uncommitted' });
		expect(posted[1].reason).toBe('unknown_root');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('says the diff is unavailable when a side exists and the producer did not store it', async () => {
		await openDiff('media/board-icon.png');
		expect(posted[0]).toEqual({ type: 'activityUnavailable', request: 'diff', reason: 'omitted_binary', path: 'media/board-icon.png' });
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

	it('falls back for a vendor with no chat panel, a command that fails, and an unsafe session id', async () => {
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'codex', session_id: 'codex-no-question' });
		expect(posted[0]).toEqual({ type: 'activityUnavailable', request: 'chat', reason: 'no_chat_panel', session_id: 'codex-no-question' });
		(vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('command not found'));
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' });
		expect(posted[1].reason).toBe('command_failed');
		await commands.handleMessage({ type: 'openActivityChat', vendor: 'claude-code', session_id: '../../../etc/passwd' });
		expect(posted[2].reason).toBe('bad_request');
		expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
	});
});

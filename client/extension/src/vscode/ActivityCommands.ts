import * as path from 'path';
import * as vscode from 'vscode';
import { activityBlobPathFor, activityChangedFileIn } from '../lib/activitystoreops';
import { writeToErrorLog, writeToLog, writeToLogAtLevel } from '../lib/errorops';
import { isWithinWorkspace } from '../lib/pathops';
import { ACTIVITY_SESSION_ID_PATTERN, ACTIVITY_VENDOR_CLAUDE_CODE, type ActivityChangedFile, type ActivityTree } from '../types/AgentActivity';
import type { HashMapOf } from '../types/general';

export const ACTIVITY_MESSAGE_OPEN_DIFF = 'openActivityDiff';
export const ACTIVITY_MESSAGE_OPEN_CHAT = 'openActivityChat';

/*
 * The chat panel each vendor's session can be opened in, by the vendor slug the contract carries.
 * Claude Code is the only vendor shipping a VS Code extension today, and its command is
 * undocumented with no stability contract, so the call is guarded and a vendor absent from this map
 * falls back to NoteThink's own drawer. The map is where the next vendor's command goes.
 */
const ACTIVITY_CHAT_COMMANDS: HashMapOf<string> = {
	[ACTIVITY_VENDOR_CLAUDE_CODE]: 'claude-vscode.editor.open',
};

/**
 * ActivityTreeLookup is the reader's published working tree, the only thing that admits a path to
 * the diff opener. Narrow on purpose, so the opener can be tested against a stub tree.
 */
export interface ActivityTreeLookup {
	treeFor(root_path: string): ActivityTree | undefined;
}

/**
 * What a webview activity row does when it is clicked: open a changed file as a two-column diff,
 * and open an agent's conversation in its vendor's own chat panel.
 *
 * Both sides of a diff come from the contract, because this host cannot produce either: it is a web
 * extension with no child processes, so it cannot run git, and the built-in git extension lives in
 * an extension host it cannot reach. The producer stores the committed side as a blob and the
 * working file is the other side.
 *
 * The admission rule for a path is the contract listing it. Every other path into an editor here
 * stays markdown-only, and this one is the deliberate exception: a changed file is whatever the
 * repository holds, so the gate is that the producer named it in a band AND it resolves inside the
 * workspace. An unlisted path is refused before any URI is built from it.
 *
 * Nothing here throws at the webview. A side the producer did not store, a vendor with no chat
 * panel and a command that fails are all reported back as one message, so the board can say the
 * diff is unavailable rather than opening an empty pane, and fall back to its own drawer.
 */
export class ActivityCommands {
	constructor(
		private readonly base_uri: vscode.Uri,
		private readonly lookup: ActivityTreeLookup,
		private readonly post: (message: Record<string, unknown>) => void,
	) {}

	/** true when the message was an activity command and has been handled, so the panel's own dispatch can carry on past it */
	public async handleMessage(e: Record<string, unknown>): Promise<boolean> {
		if (e.type === ACTIVITY_MESSAGE_OPEN_DIFF) { await this.openDiff(e); return true; }
		if (e.type === ACTIVITY_MESSAGE_OPEN_CHAT) { await this.openChat(e); return true; }
		return false;
	}

	// --- opening a changed file ---

	private async openDiff(e: Record<string, unknown>): Promise<void> {
		const root_path = typeof e.root_path === 'string' ? e.root_path : '';
		const file_path = typeof e.path === 'string' ? e.path : '';
		const band = typeof e.band === 'string' ? e.band : '';
		try {
			const tree = this.lookup.treeFor(root_path);
			if (!tree) { this.refuseDiff(file_path, 'unknown_root', `no contract working tree read for ${root_path}`); return; }
			const entry = activityChangedFileIn(tree, band, file_path);
			if (!entry) { this.refuseDiff(file_path, 'not_listed', `the ${band || 'unnamed'} band does not list ${file_path}`); return; }
			const left = await this.blobUri(root_path, entry.base_blob);
			const right = entry.head_blob ? await this.blobUri(root_path, entry.head_blob) : await this.workingFileUri(root_path, file_path);
			await this.showSides(entry, tree, left, right);
		} catch (err) {
			writeToErrorLog('openDiff', `failed to open the diff for ${file_path}`, err);
			this.refuseDiff(file_path, 'open_failed', 'the editor refused to open the diff');
		}
	}

	/**
	 * Show whichever sides exist: both as a diff, one alone as a plain editor, neither as a refusal.
	 * A side that is missing because the producer chose not to store it is distinguished from one
	 * that does not exist at all, which is what `omitted` is for: the first is reported unavailable,
	 * the second is simply what an added or a deleted file looks like.
	 */
	private async showSides(entry: ActivityChangedFile, tree: ActivityTree, left: vscode.Uri | undefined, right: vscode.Uri | undefined): Promise<void> {
		if (entry.omitted && (!left || !right)) { this.refuseDiff(entry.path, `omitted_${entry.omitted}`, `the producer stored no ${entry.omitted === 'size' ? 'content for a file this large' : 'content for a binary file'}`); return; }
		const show_options = { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false };
		if (left && right) {
			await vscode.commands.executeCommand('vscode.diff', left, right, this.diffTitle(entry, tree), show_options);
			return;
		}
		const only_side = left ?? right;
		if (!only_side) { this.refuseDiff(entry.path, 'no_side', 'neither side of the diff could be resolved'); return; }
		await vscode.window.showTextDocument(only_side, show_options);
	}

	// name both sides in the tab, since a diff whose sides are unlabelled says nothing about what it is measuring against
	private diffTitle(entry: ActivityChangedFile, tree: ActivityTree): string {
		const file_name = path.posix.basename(entry.path);
		const left_label = entry.base_blob ? (tree.base_ref ?? tree.head_commit.slice(0, 8)) : 'nothing';
		const right_label = entry.head_blob ? tree.head_commit.slice(0, 8) : 'working tree';
		return `${file_name} (${left_label} vs ${right_label})`;
	}

	/** a blob the contract references, once it is confined to `blobs/`, inside the workspace, and actually there */
	private async blobUri(root_path: string, blob_reference: string | undefined): Promise<vscode.Uri | undefined> {
		const blob_path = activityBlobPathFor(root_path, blob_reference);
		if (!blob_path) { return undefined; }
		if (!isWithinWorkspace(blob_path)) {
			writeToLogAtLevel('error', 'blobUri', `blob outside the workspace, refusing ${blob_path}`);
			return undefined;
		}
		const uri = this.base_uri.with({ path: blob_path });
		return await this.exists(uri) ? uri : undefined;
	}

	/**
	 * The changed file in the workspace. A producer writes every path relative to the contract root,
	 * which is the only base it can know, so resolving one is a single join against where the
	 * `.notethink/` directory was found. Whether the result is inside the workspace is a separate
	 * question asked afterwards, and it is what stops a path climbing out of the repository.
	 */
	private async workingFileUri(root_path: string, file_path: string): Promise<vscode.Uri | undefined> {
		const resolved = path.posix.join(root_path, file_path);
		if (!isWithinWorkspace(resolved)) {
			writeToLogAtLevel('error', 'workingFileUri', `contract path outside the workspace, refusing ${file_path}`);
			return undefined;
		}
		const uri = this.base_uri.with({ path: resolved });
		if (await this.exists(uri)) { return uri; }
		writeToLog('workingFileUri', `the contract lists ${file_path} and no such file is in the workspace`);
		return undefined;
	}

	// a stat that throws is the answer rather than a failure: the file is not there, which is what a deleted or unstored side looks like
	private async exists(uri: vscode.Uri): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	}

	private refuseDiff(file_path: string, reason: string, detail: string): void {
		writeToLog('refuseDiff', `${reason}: ${detail}`);
		this.post({ type: 'activityUnavailable', request: 'diff', reason, path: file_path });
	}

	// --- opening an agent's conversation ---

	/**
	 * Hand a session to its vendor's chat panel, and say so when there is none to hand it to. The
	 * command resolves even for a session id the vendor does not know (measured against Claude Code
	 * 2.1.274), so a rejection is the only failure it can report, and anything else is the vendor's
	 * to show.
	 */
	private async openChat(e: Record<string, unknown>): Promise<void> {
		const vendor = typeof e.vendor === 'string' ? e.vendor : '';
		const session_id = typeof e.session_id === 'string' ? e.session_id : '';
		if (!ACTIVITY_SESSION_ID_PATTERN.test(session_id)) {
			writeToLogAtLevel('error', 'openChat', `session id is not a safe path segment, refusing a chat open for vendor ${vendor}`);
			this.post({ type: 'activityUnavailable', request: 'chat', reason: 'bad_request', session_id });
			return;
		}
		const command = ACTIVITY_CHAT_COMMANDS[vendor];
		if (!command) {
			this.post({ type: 'activityUnavailable', request: 'chat', reason: 'no_chat_panel', session_id });
			return;
		}
		try {
			await vscode.commands.executeCommand(command, session_id);
			writeToLog('openChat', `handed session ${session_id} to ${command}`);
		} catch (err) {
			// the vendor's extension is absent, disabled, or the command has moved on; the board falls back to its own drawer
			writeToErrorLog('openChat', `${command} failed for session ${session_id}`, err);
			this.post({ type: 'activityUnavailable', request: 'chat', reason: 'command_failed', session_id });
		}
	}
}

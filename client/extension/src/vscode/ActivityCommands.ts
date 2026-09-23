import * as path from 'path';
import * as vscode from 'vscode';
import { ACTIVITY_VENDOR_CLAUDE_CODE, type ActivityChangedFile, type ActivityTree } from '../types/AgentActivity';
import { writeToErrorLog, writeToLog, writeToLogAtLevel } from '../lib/errorops';
import { isWithinWorkspace } from '../lib/pathops';
import type { HashMapOf } from '../types/general';

export const ACTIVITY_MESSAGE_OPEN_DIFF = 'openActivityDiff';
export const ACTIVITY_MESSAGE_OPEN_CHAT = 'openActivityChat';
export const ACTIVITY_MESSAGE_DEMAND = 'activityDemand';
export const ACTIVITY_MESSAGE_WITHDRAW = 'activityWithdraw';

// a session id is a vendor-chosen string that becomes an argument to a vendor command; bounded and pattern-checked so a malformed one is refused before it reaches executeCommand
const ACTIVITY_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/*
 * The chat panel each vendor's session can be opened in, by the vendor slug the analyser carries.
 * Claude Code is the only vendor shipping a VS Code extension whose command takes a session id, and
 * that command is undocumented with no stability contract, so the call is guarded and a vendor absent
 * from this map opens the session's own transcript instead. The map is where the next vendor's
 * command goes.
 */
const ACTIVITY_CHAT_COMMANDS: HashMapOf<string> = {
	[ACTIVITY_VENDOR_CLAUDE_CODE]: 'claude-vscode.editor.open',
};

/**
 * ActivityTreeLookup is the analyser's own last read: the working tree, the only thing that admits a
 * path to the diff opener, and each session's transcript, the only thing that admits a file to the
 * chat opener's fallback. Narrow on purpose, so the openers can be tested against a stub.
 */
export interface ActivityTreeLookup {
	treeFor(root_path: string): ActivityTree | undefined;
	transcriptPathFor(session_id: string): string | undefined;
}

/**
 * What a webview activity row does when it is clicked: open a changed file as a two-column diff
 * against a live `git:` HEAD URI, and open an agent's conversation in its vendor's own chat panel.
 *
 * The analyser reads the working tree itself through the built-in git extension, so the committed
 * side of an uncommitted file's diff is read live, on demand, rather than fetched from a stored
 * copy. The admission rule for a path is still the analyser's own tree listing it, and this stays
 * the one deliberate exception to every other reveal
 * and jump path's markdown-only gate (`PanelSession.ts`): a changed file is whatever the repository
 * holds.
 *
 * Nothing here throws at the webview. A path the tree does not list, a session with no transcript to
 * open and a command that fails are all reported back as one message, so the board can say what could
 * not be opened rather than opening an empty pane.
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
		try {
			const tree = this.lookup.treeFor(root_path);
			if (!tree) { this.refuseDiff(file_path, 'unknown_root', `no working tree read for ${root_path}`); return; }
			const entry = tree.uncommitted.find(candidate => candidate.path === file_path);
			if (!entry) { this.refuseDiff(file_path, 'not_listed', `the uncommitted band does not list ${file_path}`); return; }
			const resolved = path.posix.join(root_path, entry.path);
			if (!isWithinWorkspace(resolved)) {
				writeToLogAtLevel('error', 'openDiff', `changed-file path outside the workspace, refusing ${file_path}`);
				this.refuseDiff(file_path, 'no_side', 'neither side of the diff could be resolved');
				return;
			}
			const left = this.headUri(resolved, entry.change);
			const right = entry.change === 'deleted' ? undefined : await this.workingFileUri(resolved);
			await this.showSides(entry, left, right);
		} catch (err) {
			writeToErrorLog('openDiff', `failed to open the diff for ${file_path}`, err);
			this.refuseDiff(file_path, 'open_failed', 'the editor refused to open the diff');
		}
	}

	/**
	 * Show whichever sides exist: both as a diff, one alone as a plain editor, neither as a refusal.
	 * `added` has no committed side to read at all, which is what `left` being undefined here means;
	 * `deleted` has no working-tree side, which is what `right` being undefined means.
	 */
	private async showSides(entry: ActivityChangedFile, left: vscode.Uri | undefined, right: vscode.Uri | undefined): Promise<void> {
		const show_options = { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false };
		if (left && right) {
			await vscode.commands.executeCommand('vscode.diff', left, right, this.diffTitle(entry), show_options);
			return;
		}
		const only_side = left ?? right;
		if (!only_side) { this.refuseDiff(entry.path, 'no_side', 'neither side of the diff could be resolved'); return; }
		await vscode.window.showTextDocument(only_side, show_options);
	}

	// name both sides in the tab, since a diff whose sides are unlabelled says nothing about what it is measuring against
	private diffTitle(entry: ActivityChangedFile): string {
		const file_name = path.posix.basename(entry.path);
		return `${file_name} (HEAD vs working tree)`;
	}

	/**
	 * The committed side of an uncommitted change, read live through the git extension's own `git:`
	 * document-content provider rather than a stored copy; absent for a file the repository has no
	 * committed version of at all. The scheme, path and JSON query below are the git extension's own
	 * `toGitUri` shape (`extensions/git/src/uri.ts` in VS Code's source), reconstructed here since
	 * that module is not a dependency of this project; a diff opened against a live checkout of this
	 * shape is the way to confirm it still matches a future VS Code release.
	 */
	private headUri(resolved: string, change: ActivityChangedFile['change']): vscode.Uri | undefined {
		if (change === 'added') { return undefined; }
		const working_uri = this.base_uri.with({ path: resolved });
		return working_uri.with({ scheme: 'git', query: JSON.stringify({ path: working_uri.fsPath, ref: 'HEAD' }) });
	}

	/** the changed file in the workspace; the caller has already confirmed `resolved` sits inside it */
	private async workingFileUri(resolved: string): Promise<vscode.Uri | undefined> {
		const uri = this.base_uri.with({ path: resolved });
		if (await this.exists(uri)) { return uri; }
		writeToLog('workingFileUri', `the working tree lists ${resolved} and no such file is in the workspace`);
		return undefined;
	}

	// a stat that throws is the answer rather than a failure: the file is not there, which is what a deleted file looks like
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
	 * Open a session in VS Code rather than on the card: in its vendor's chat panel where one takes a
	 * session id, else as its own transcript in an editor beside the board. The vendor command resolves
	 * even for a session id the vendor does not know, so a rejection is the only failure it can report,
	 * and a rejection falls through to the transcript too.
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
		if (command) {
			try {
				await vscode.commands.executeCommand(command, session_id);
				writeToLog('openChat', `handed session ${session_id} to ${command}`);
				return;
			} catch (err) {
				// the vendor's extension is absent, disabled, or the command has moved on
				writeToErrorLog('openChat', `${command} failed for session ${session_id}, opening its transcript instead`, err);
			}
		}
		await this.openTranscript(session_id);
	}

	// the transcript path comes from the analyser's own last scan, never from the message, so the webview cannot name a file to open
	private async openTranscript(session_id: string): Promise<void> {
		const transcript_path = this.lookup.transcriptPathFor(session_id);
		if (!transcript_path) {
			this.post({ type: 'activityUnavailable', request: 'chat', reason: 'no_transcript', session_id });
			return;
		}
		try {
			const show_options = { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false };
			await vscode.window.showTextDocument(vscode.Uri.file(transcript_path), show_options);
			writeToLog('openTranscript', `opened the transcript of session ${session_id}`);
		} catch (err) {
			writeToErrorLog('openTranscript', `failed to open the transcript of session ${session_id}`, err);
			this.post({ type: 'activityUnavailable', request: 'chat', reason: 'open_failed', session_id });
		}
	}
}

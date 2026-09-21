import * as path from 'path';
import * as vscode from 'vscode';
import {
	activityFileKindFromFileName,
	activitySessionIdFromFileName,
	parseActivityDigest,
	parseActivityEvents,
	parseActivityManifest,
	parseActivitySession,
	parseActivityTree,
} from '../lib/activityops';
import {
	activityContractRelative,
	activityContractRootFor,
	activityMaxBytesForKind,
	buildActivitySnapshot,
	emptyActivityContractRoot,
	type ActivityContractRoot,
	type ActivityFileKind,
	type ActivitySessionFiles,
	type ActivityStore,
} from '../lib/activitystoreops';
import { writeToErrorLog, writeToLog } from '../lib/errorops';
import { isPathWithin, isWithinWorkspace } from '../lib/pathops';
import { ACTIVITY_DIR, ACTIVITY_ROOT_GLOB, ACTIVITY_SESSIONS_DIR, ACTIVITY_SESSIONS_GLOB, type ActivityParseResult, type ActivityRejectCode, type ActivityTree } from '../types/AgentActivity';

/*
 * The initial scan walks directories rather than calling findFiles, and the choice is measured.
 *
 * findFiles cannot be asked to ignore the user's excludes AND stay cheap. `null` is the only value
 * that disregards their `files.exclude`, because an omitted argument applies it and a pattern of our
 * own applies IN ADDITION to it rather than instead of it (measured: with `**\/.*` in files.exclude
 * and a contract directory present, `null` found every contract file while a pattern and an omitted
 * argument each found none). `.notethink` is a dotted directory, so anything but `null` can leave the
 * board saying no producer is writing while one writes away. But `null` also stops findFiles pruning
 * anything: on a 1,535,139-file workspace the two glob scans cost 2228ms and returned a `.notethink`
 * that was sitting inside a `node_modules` package, which is not a contract root at all.
 *
 * A walk of our own answers all of it. It consults no setting, so the immunity is inherent rather
 * than bought; it prunes what it likes, so a dependency's stray contract directory is never read; and
 * it runs through the provider's own readDirectory, which is the only discovery that works on a
 * custom scheme, where findFiles returns nothing. Measured on the same workspace: 155ms and 294
 * directories read, against 2228ms, and it found the seeded contract root while ignoring the decoy.
 * `PanelSession.discoverViaReadDirectoryWalk` is the same shape for the same reason.
 */
// a contract root is a repository root, so it sits at or just below a workspace folder: this covers a folder that IS the repository, one that holds repositories, and one grouping directory between them
const ACTIVITY_WALK_MAX_DEPTH = 3;
// an absolute bound, so a pathological tree or a symlink cycle cannot spin the walk; a 1,535,139-file workspace read 294 directories at the depth above
const ACTIVITY_WALK_MAX_DIRECTORIES = 2000;
// a repository is never found inside these, and everything else dotted is pruned too, so an agent worktree mirroring the repo tree is not walked twice
const ACTIVITY_WALK_PRUNE = ['node_modules'];
// contract writes arrive in bursts (a session file, its event log and the manifest for one tool call), so a burst posts one snapshot
const ACTIVITY_REFRESH_DEBOUNCE_MS = 250;
// a producer going stale changes the board with no file event behind it, so liveness is re-evaluated on a timer as well as on every read
const ACTIVITY_LIVENESS_POLL_MS = 5000;

/**
 * Reads the agent activity contract for one panel: watches every `.notethink/` directory in the
 * workspace, parses what a producer writes there, and posts the result to the webview as its own
 * message. ACTIVITY_CONTRACT.md is the specification, `activityops.ts` parses one file and
 * `activitystoreops.ts` folds the files into the payload.
 *
 * Deliberately a separate watcher from the folder markdown one. The folder watcher hands every
 * file it sees to loadFolderDoc, which parses whatever it is given into a markdown doc in the
 * aggregate, so a contract file reaching it would draw as a story; the include filter is what
 * keeps the two apart and must never widen past markdown to take contract files in.
 *
 * The contract is read whole-file, which is the only read the VS Code file-system API offers, so
 * every file is refused on its byte size before it is decoded. A refusal keeps the last good value
 * and is reported rather than swallowed: a producer writes while this reads, so a truncated file is
 * the normal failure, and a board that silently drops what it cannot read looks exactly like a
 * board with nothing happening on it.
 */
export class ActivityReader {
	private readonly store: ActivityStore = {};
	// contract file paths waiting to be re-read, drained by one debounced refresh
	private readonly dirty = new Set<string>();
	private readonly watchers: vscode.FileSystemWatcher[] = [];
	private folders_subscription: vscode.Disposable | undefined;
	private refresh_timer: ReturnType<typeof setTimeout> | undefined;
	private liveness_timer: ReturnType<typeof setInterval> | undefined;
	private initial_scan: Promise<void> | undefined;
	// the last snapshot posted, serialised, so a heartbeat that changes nothing the board draws posts nothing
	private last_posted: string | undefined;
	// nothing is posted until the webview has asked for its initial state, because a message posted into a webview whose bundle has not loaded yet is simply dropped
	private webview_listening = false;

	constructor(
		private readonly base_uri: vscode.Uri,
		private readonly post: (message: Record<string, unknown>) => void,
	) {}

	/** arm the watchers and start reading whatever is already on disk, so the board is answerable the moment the webview asks; nothing is posted until it does */
	public async start(): Promise<void> {
		this.armWatchers();
		// a folder added mid-session brings its own contract directory, and the watchers only see what happens after that, so the scan is run again
		this.folders_subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void this.scanContractFiles().catch(err => writeToErrorLog('start', 'contract re-scan after a workspace folder change failed', err));
		});
		this.liveness_timer = setInterval(() => this.postSnapshotIfChanged(), ACTIVITY_LIVENESS_POLL_MS);
		// a repeating timer must never be the reason a host stays alive; a web host's setInterval returns a plain number with no unref to call, so the call is optional
		(this.liveness_timer as unknown as { unref?: () => void }).unref?.();
		this.runInitialScan();
	}

	/**
	 * Start the first read without waiting for it. The panel that owns this reader is itself awaited
	 * by the custom editor's resolve, and a scan holds that open for as long as it runs; the board is
	 * painted and answering messages by then, so nothing is gained by making the editor wait for a
	 * contract that may not exist. A scan that fails must still say so, or a board reporting nothing
	 * would be indistinguishable from a workspace with nothing in it.
	 */
	private runInitialScan(): void {
		this.initial_scan = this.scanContractFiles().catch(err => writeToErrorLog('runInitialScan', 'the initial contract scan failed', err));
	}

	// the first scan's completion, for a caller that has to know the first read has landed; the panel deliberately does not wait for it
	public async initialScanSettled(): Promise<void> {
		await this.initial_scan;
	}

	public dispose(): void {
		if (this.refresh_timer !== undefined) { clearTimeout(this.refresh_timer); this.refresh_timer = undefined; }
		if (this.liveness_timer !== undefined) { clearInterval(this.liveness_timer); this.liveness_timer = undefined; }
		this.folders_subscription?.dispose();
		this.folders_subscription = undefined;
		for (const watcher of this.watchers) { watcher.dispose(); }
		this.watchers.length = 0;
	}

	/**
	 * Post the current snapshot unconditionally, for a webview that has just (re)loaded and holds
	 * nothing. This is also the first post of the session: the panel calls it when the webview asks
	 * for its initial state, which is the first proof the bundle is listening. An empty snapshot is
	 * posted like any other, because "no producer is writing" is the answer to draw.
	 */
	public resend(): void {
		this.webview_listening = true;
		this.last_posted = undefined;
		this.postSnapshotIfChanged();
	}

	// the working tree a contract root last published, or undefined for a root that publishes none; the diff opener's admission gate reads it
	public treeFor(root_path: string): ActivityTree | undefined {
		return this.store[root_path]?.tree;
	}

	// --- watching ---

	private armWatchers(): void {
		for (const glob of [ACTIVITY_ROOT_GLOB, ACTIVITY_SESSIONS_GLOB]) {
			try {
				const watcher = vscode.workspace.createFileSystemWatcher(glob);
				watcher.onDidCreate(uri => this.markDirty(uri.path));
				watcher.onDidChange(uri => this.markDirty(uri.path));
				watcher.onDidDelete(uri => this.forgetContractFile(uri.path));
				this.watchers.push(watcher);
			} catch (err) {
				// a custom file-system provider may make watch() a no-op or throw; the initial scan still populated the board, it just will not see live writes
				writeToErrorLog('armWatchers', `contract watcher unavailable for ${glob}`, err);
			}
		}
	}

	private async scanContractFiles(): Promise<void> {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const contract_dirs = await this.walkForContractDirectories(folder.uri);
			for (const contract_dir of contract_dirs) { await this.markContractDirectory(contract_dir); }
		}
		await this.refresh();
	}

	/**
	 * Find each `.notethink/` at or below a workspace folder, bounded by depth and by directories
	 * read. Pruning is ours to decide rather than the user's: a repository never sits inside a
	 * dependency directory, and a stray contract directory shipped inside one is not a contract root.
	 */
	private async walkForContractDirectories(folder_uri: vscode.Uri): Promise<vscode.Uri[]> {
		const found: vscode.Uri[] = [];
		const stack: Array<{ uri: vscode.Uri, depth: number }> = [{ uri: folder_uri, depth: 0 }];
		let read = 0;
		while (stack.length > 0 && read < ACTIVITY_WALK_MAX_DIRECTORIES) {
			read++;
			const { uri, depth } = stack.pop()!;
			let entries: Array<[string, vscode.FileType]>;
			try {
				entries = await vscode.workspace.fs.readDirectory(uri);
			} catch (err) {
				writeToErrorLog('walkForContractDirectories', `readDirectory failed for ${uri.path}`, err);
				continue;
			}
			for (const [name, type] of entries) {
				if (type !== vscode.FileType.Directory) { continue; }
				if (name === ACTIVITY_DIR) { found.push(vscode.Uri.joinPath(uri, name)); continue; }
				if (depth >= ACTIVITY_WALK_MAX_DEPTH || name.startsWith('.') || ACTIVITY_WALK_PRUNE.includes(name)) { continue; }
				stack.push({ uri: vscode.Uri.joinPath(uri, name), depth: depth + 1 });
			}
		}
		if (read >= ACTIVITY_WALK_MAX_DIRECTORIES) {
			// a contract directory beyond the bound is still picked up by the watchers, at the producer's next heartbeat rather than now
			writeToLog('walkForContractDirectories', `walk cap hit: stopped after ${ACTIVITY_WALK_MAX_DIRECTORIES} directories under ${folder_uri.path}`);
		}
		return found;
	}

	// queue every file a contract directory holds, the three per-session ones included; readContractFile is what decides which of them are the contract's
	private async markContractDirectory(contract_dir: vscode.Uri): Promise<void> {
		for (const dir of [contract_dir, vscode.Uri.joinPath(contract_dir, ACTIVITY_SESSIONS_DIR)]) {
			try {
				const entries = await vscode.workspace.fs.readDirectory(dir);
				for (const [name, type] of entries) {
					if (type === vscode.FileType.File) { this.dirty.add(path.posix.join(dir.path, name)); }
				}
			} catch (err) {
				// a contract directory with no sessions/ yet is the normal shape before a producer's first session, so this is reported and not fatal
				writeToLog('markContractDirectory', `could not list ${dir.path}: ${String(err)}`);
			}
		}
	}

	private markDirty(file_path: string): void {
		this.dirty.add(file_path);
		if (this.refresh_timer !== undefined) { return; }
		this.refresh_timer = setTimeout(() => {
			this.refresh_timer = undefined;
			void this.refresh().catch(err => writeToErrorLog('markDirty', 'contract refresh failed', err));
		}, ACTIVITY_REFRESH_DEBOUNCE_MS);
	}

	private async refresh(): Promise<void> {
		const file_paths = [...this.dirty];
		this.dirty.clear();
		for (const file_path of file_paths) { await this.readContractFile(file_path); }
		this.postSnapshotIfChanged();
	}

	// --- reading ---

	private recordFor(root_path: string): ActivityContractRoot {
		const existing = this.store[root_path];
		if (existing) { return existing; }
		const record = emptyActivityContractRoot(root_path, this.workspaceRelative(root_path));
		this.store[root_path] = record;
		return record;
	}

	// the contract root relative to the workspace folder containing it, which is what a declared contract-root-relative path is joined to before it is matched against a note's own path; empty when the contract root is the workspace folder itself
	private workspaceRelative(absolute_path: string): string {
		const root_paths = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.path);
		const containing = root_paths.find(root_path => isPathWithin(absolute_path, [root_path]));
		return containing ? path.posix.relative(containing, absolute_path) : absolute_path;
	}

	private async readContractFile(file_path: string): Promise<void> {
		const root_path = activityContractRootFor(file_path);
		if (!root_path) { return; }
		const file_name = path.posix.basename(file_path);
		const kind = activityFileKindFromFileName(file_name);
		// `sessions/` is watched whole, so anything in it that is not one of the three per-session files is not ours to read
		if (!kind) { return; }
		if (!isWithinWorkspace(file_path)) {
			writeToLog('readContractFile', `contract file outside the workspace, refusing ${file_path}`);
			return;
		}
		const record = this.recordFor(root_path);
		const text = await this.readBoundedText(file_path, kind, record);
		if (text === undefined) { return; }
		if (kind === 'manifest' || kind === 'tree') { this.storeRootFile(record, kind, file_path, text); return; }
		this.storeSessionFile(record, kind, file_name, file_path, text);
	}

	/**
	 * Read a contract file whole, refusing it on its byte size before decoding it. The size check is
	 * the one that matters: the file API takes no offset and no length, so an oversized file cannot
	 * be sampled, and a producer that cannot fit inside a bound is obliged to drop content instead.
	 */
	private async readBoundedText(file_path: string, kind: ActivityFileKind, record: ActivityContractRoot): Promise<string | undefined> {
		const uri = this.base_uri.with({ path: file_path });
		const max_bytes = activityMaxBytesForKind(kind);
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > max_bytes) {
				this.noteRefusal(record, file_path, 'too_large', `${stat.size} bytes, over the ${max_bytes} byte bound`);
				writeToLog('readBoundedText', `refused ${file_path}: ${stat.size} bytes over the ${max_bytes} byte bound`);
				return undefined;
			}
			const bytes = await vscode.workspace.fs.readFile(uri);
			return new TextDecoder().decode(bytes);
		} catch (err) {
			// a read that throws is what a file deleted between the watcher event and this read looks like, so it is reported and not fatal
			this.noteRefusal(record, file_path, 'unreadable', 'the file could not be read');
			writeToErrorLog('readBoundedText', `failed to read contract file ${file_path}`, err);
			return undefined;
		}
	}

	/**
	 * The parsed value, or undefined when the file was refused. A refusal leaves the store's last
	 * good value where it is, and both a refusal and a partial read are recorded against the file so
	 * the board can say what it could not read, then cleared by the next clean read of that file.
	 */
	private takeParsed<T>(record: ActivityContractRoot, file_path: string, parsed: ActivityParseResult<T>): T | undefined {
		if (!parsed.ok) {
			this.noteRefusal(record, file_path, parsed.code, parsed.reason);
			writeToLog('takeParsed', `refused ${file_path}: ${parsed.code} ${parsed.reason}`);
			return undefined;
		}
		if (parsed.dropped && parsed.dropped.length > 0) {
			this.noteRefusal(record, file_path, 'invalid_shape', `dropped ${parsed.dropped.length}: ${parsed.dropped.join('; ')}`);
			writeToLog('takeParsed', `dropped ${parsed.dropped.length} entries from ${file_path}: ${parsed.dropped.join('; ')}`);
			return parsed.value;
		}
		delete record.refusals[file_path];
		return parsed.value;
	}

	private noteRefusal(record: ActivityContractRoot, file_path: string, code: ActivityRejectCode, reason: string): void {
		const file = activityContractRelative(record.root_path, file_path);
		record.refusals[file_path] = { file, code, reason, session_id: activitySessionIdFromFileName(path.posix.basename(file_path)) };
	}

	private storeRootFile(record: ActivityContractRoot, kind: 'manifest' | 'tree', file_path: string, text: string): void {
		if (kind === 'manifest') {
			const manifest = this.takeParsed(record, file_path, parseActivityManifest(text));
			if (manifest) { record.manifest = manifest; }
			return;
		}
		const tree = this.takeParsed(record, file_path, parseActivityTree(text));
		if (tree) { record.tree = tree; }
	}

	private storeSessionFile(record: ActivityContractRoot, kind: ActivityFileKind, file_name: string, file_path: string, text: string): void {
		const session_id = activitySessionIdFromFileName(file_name);
		if (!session_id) {
			writeToLog('storeSessionFile', `session id is not a safe path segment, refusing ${file_path}`);
			return;
		}
		const files = record.sessions[session_id] ?? {};
		record.sessions[session_id] = files;
		if (kind === 'session') {
			const session = this.takeParsed(record, file_path, parseActivitySession(text));
			// the id inside the file has to be the id the filename carries, or one session's state would be filed under another's
			if (session && session.session_id === session_id) { files.session = session; }
			else if (session) { this.noteRefusal(record, file_path, 'invalid_shape', `session_id ${session.session_id} does not match the file name`); }
			return;
		}
		if (kind === 'events') { this.storeEvents(record, files, session_id, file_path, text); return; }
		const digest = this.takeParsed(record, file_path, parseActivityDigest(text));
		if (digest && digest.session_id === session_id) { files.digest = digest; }
		else if (digest) { this.noteRefusal(record, file_path, 'invalid_shape', `session_id ${digest.session_id} does not match the file name`); }
	}

	/**
	 * Every line carries the session id it belongs to, and the contract requires it to be this
	 * session's, so a line naming another session is dropped rather than credited here. Order is
	 * write order throughout and is never re-sorted by the timestamps, which are display values.
	 */
	private storeEvents(record: ActivityContractRoot, files: ActivitySessionFiles, session_id: string, file_path: string, text: string): void {
		const events = this.takeParsed(record, file_path, parseActivityEvents(text));
		if (!events) { return; }
		const mine = events.filter(event => event.session_id === session_id);
		if (mine.length !== events.length) {
			this.noteRefusal(record, file_path, 'invalid_shape', `dropped ${events.length - mine.length}: lines naming another session`);
			writeToLog('storeEvents', `dropped ${events.length - mine.length} lines from ${file_path} naming another session`);
		}
		files.events = mine;
	}

	private forgetContractFile(file_path: string): void {
		const root_path = activityContractRootFor(file_path);
		const record = root_path ? this.store[root_path] : undefined;
		if (!root_path || !record) { return; }
		const file_name = path.posix.basename(file_path);
		const kind = activityFileKindFromFileName(file_name);
		if (!kind) { return; }
		delete record.refusals[file_path];
		if (kind === 'manifest') { record.manifest = undefined; }
		if (kind === 'tree') { record.tree = undefined; }
		this.forgetSessionFile(record, kind, file_name);
		// a contract directory that has been removed outright leaves nothing to report, and a root with no manifest would otherwise be drawn as a producer that stopped
		const is_empty = !record.manifest && !record.tree && Object.keys(record.sessions).length === 0 && Object.keys(record.refusals).length === 0;
		if (is_empty) { delete this.store[root_path]; }
		this.postSnapshotIfChanged();
	}

	private forgetSessionFile(record: ActivityContractRoot, kind: ActivityFileKind, file_name: string): void {
		if (kind !== 'session' && kind !== 'events' && kind !== 'digest') { return; }
		const session_id = activitySessionIdFromFileName(file_name);
		const files = session_id ? record.sessions[session_id] : undefined;
		if (!session_id || !files) { return; }
		if (kind === 'session') { files.session = undefined; }
		if (kind === 'events') { files.events = undefined; }
		if (kind === 'digest') { files.digest = undefined; }
		if (!files.session && !files.events && !files.digest) { delete record.sessions[session_id]; }
	}

	// --- posting ---

	private postSnapshotIfChanged(): void {
		if (!this.webview_listening) { return; }
		const snapshot = buildActivitySnapshot(this.store, Date.now());
		const serialised = JSON.stringify(snapshot);
		if (serialised === this.last_posted) { return; }
		this.last_posted = serialised;
		this.post({ type: 'activity', activity: snapshot });
	}
}

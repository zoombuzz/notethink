import * as path from 'path';
import * as vscode from 'vscode';
import { MAX_AGGREGATE_FILES, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, NOTETHINK_VIEW_TYPE } from '../constants';
import { generateIdentifier } from '../lib/cryptoops';
import { type TextChange, firstInvalidChange, logEditTextChanges, offsetDeltaBefore } from '../lib/editops';
import { debug, writeToLog, writeToLogAtLevel, writeToErrorLog } from '../lib/errorops';
import { globMatches } from '../lib/globMatch';
import { isPathWithin, isWithinWorkspace } from '../lib/pathops';
import { isSettingKey, readSetting, writeSetting, hasWorkspaceOverride, hasOverride, settingKeys, editTarget, buildSettingsCascadePayload } from '../lib/settings';
import type { HashMapOf, Doc } from '../types/general';
import { ActivityCommands } from './ActivityCommands';
import type { AgentAnalyser } from './AgentAnalyser';
import { isParseStaleError, type ParsePool } from './ParsePool';

// change-debounce floor/cap: a doc scales its delay by its own last parse time, self-throttling large files
const CHANGE_DEBOUNCE_MS = 250;
const CHANGE_DEBOUNCE_CAP_MS = 1000;
const SELECTION_DEBOUNCE_MS = 120;
// discovery-phase merge posts are batched until one of these trips, so a 200-file load ships tens of messages, not 200
const DISCOVERY_BATCH_FLUSH_MS = 100;
const DISCOVERY_BATCH_MAX_DOCS = 20;
const ALLOWED_EXTERNAL_SCHEMES = ['http', 'https', 'mailto'] as const;
// bounds the non-file: scheme readDirectory walk, so a symlink cycle or pathological provider can't loop forever
const MAX_WALK_ENTRIES = 5000;
// asks an exclude glob "would you drop everything inside this directory?"; globs end in /** so they only match a file path
const EXCLUDE_PROBE_FILE = '__probe__.md';
/*
 * Last-resort scheme carrier for a session with neither a document nor a workspace folder.
 * Unreachable through the three real entry points, which always carry one or the other, and
 * inert if ever reached: every base_uri consumer sits behind isWithinWorkspace, which fails
 * closed with no workspace folders.
 */
const INERT_BASE_URI = vscode.Uri.file('/');

/**
 * Applies changes to a document end-to-start so earlier offsets stay valid. Prefers an
 * already-visible editor (never spawns one); otherwise applies a WorkspaceEdit. The caller must
 * validate offsets first. Against a visible editor, the caret is captured before the edit (VS
 * Code would otherwise drop it at the last edited range) and restored after, shifted only by
 * edits that landed before it, so a view-driven edit leaves the caret put.
 */
async function applyEditTextChanges(document: vscode.TextDocument, uri: vscode.Uri, changes: Array<TextChange>): Promise<void> {
	const sorted_changes = [...changes].sort((a, b) => b.from - a.from);
	const existing = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === uri.path);
	if (existing) {
		// preserve the caret across the edit
		const anchor_offset = document.offsetAt(existing.selection.anchor);
		const active_offset = document.offsetAt(existing.selection.active);
		await existing.edit(editBuilder => {
			for (const change of sorted_changes) {
				const from = document.positionAt(change.from);
				const to = change.to !== undefined ? document.positionAt(change.to) : from;
				if (change.to !== undefined) { editBuilder.replace(new vscode.Range(from, to), change.insert); }
				else { editBuilder.insert(from, change.insert); }
			}
		});
		const restored_anchor = document.positionAt(anchor_offset + offsetDeltaBefore(changes, anchor_offset));
		const restored_active = document.positionAt(active_offset + offsetDeltaBefore(changes, active_offset));
		existing.selection = new vscode.Selection(restored_anchor, restored_active);
		return;
	}
	const ws_edit = new vscode.WorkspaceEdit();
	for (const change of sorted_changes) {
		const from = document.positionAt(change.from);
		const to = change.to !== undefined ? document.positionAt(change.to) : from;
		if (change.to !== undefined) { ws_edit.replace(uri, new vscode.Range(from, to), change.insert); }
		else { ws_edit.insert(uri, from, change.insert); }
	}
	await vscode.workspace.applyEdit(ws_edit);
}

/**
 * Owns the lifetime of one NoteThink webview panel. Each mutable piece of session
 * state (active doc/path, folder-integration filters + watcher, the active-file
 * watcher, debounce timers) is a private field, and each unit of behaviour is a
 * method whose dependencies are explicit via `this`. The webview message switch
 * in `start()` delegates each case to a named `handle*` method.
 *
 * Constructed and started by `NotethinkEditorProvider.myWebviewPanel`, which keeps
 * the panel reference for command relay via the `onActivate`/`onDispose` callbacks.
 *
 * initialDocument is optional: a docless session (the openViewer command with no active
 * .md editor) has no file to render and opens folder mode at the workspace root instead,
 * originated from openFolderAtWorkspaceRootIfDocless.
 * - last_parse_duration_ms: last measured background-parse time per doc path, scaling that
 *   doc's own change-debounce instead of one fixed delay for every file size
 * - was_visible: tracks webviewPanel.visible so syncVisibility can tell hidden->visible from a
 *   visible->visible focus-only no-op
 */
export class PanelSession {
	private active_doc: Doc | undefined;
	private active_path: string | undefined;
	private integration_watcher: vscode.FileSystemWatcher | undefined;
	private integration_path: string | undefined;
	// editable folder filters, persisted per-view by the webview and replayed on reload; survive a breadcrumb re-narrow
	private integration_include = DEFAULT_INCLUDE_FILTER;
	private integration_exclude = DEFAULT_EXCLUDE_FILTER;
	private readonly integration_docs: HashMapOf<Doc> = {};
	// ids the discovery fan-out has loaded, held until the flush timer or size cap trips (single-file updates stream apart)
	private readonly discovery_batch = new Set<string>();
	private discovery_batch_timer: ReturnType<typeof setTimeout> | undefined;
	// folder-size metadata for the breadcrumb's "(loaded of discovered)"; incremental updates keep resending it
	private integration_total_discovered = 0;
	private integration_truncated = false;
	private workspace_projects: string[] = [];
	// onDidChangeTextDocument fires only for editor-open docs, so this refreshes an externally-edited but unopened file
	private active_file_watcher: vscode.FileSystemWatcher | undefined;
	private change_timer: ReturnType<typeof setTimeout> | undefined;
	private selection_timer: ReturnType<typeof setTimeout> | undefined;
	private readonly workspace_root: string;
	// scheme+authority carrier for every folder-mode and open-by-path URI, so discovery and opens work on non-file: hosts too
	private readonly base_uri: vscode.Uri;
	private readonly extension_version: string;
	// demand/withdraw track whether this panel is drawing an `agent` card, never whether the shared analyser is running
	private readonly activity_commands: ActivityCommands;
	private readonly post_to_webview: (message: Record<string, unknown>) => void;
	private activity_demanded = false;
	private readonly last_parse_duration_ms = new Map<string, number>();
	private was_visible = true;

	constructor(
		private readonly webviewPanel: vscode.WebviewPanel,
		private readonly initialDocument: vscode.TextDocument | undefined,
		private readonly context: vscode.ExtensionContext,
		private readonly getHtml: (webview: vscode.Webview) => string,
		private readonly onActivate: (panel: vscode.WebviewPanel) => void,
		private readonly onDispose: (panel: vscode.WebviewPanel) => void,
		private readonly activity_analyser: AgentAnalyser,
		private readonly parse_pool: ParsePool,
	) {
		// getWorkspaceFolder handles symlinks for the breadcrumb, but may return undefined in a web host
		const workspace_folder = (initialDocument ? vscode.workspace.getWorkspaceFolder(initialDocument.uri) : undefined)
			|| vscode.workspace.workspaceFolders?.[0];
		this.workspace_root = workspace_folder?.uri.path || '';
		// falls back to the active doc's URI when no folder is open, for a single loose file
		this.base_uri = workspace_folder?.uri ?? initialDocument?.uri ?? INERT_BASE_URI;
		this.extension_version = this.context.extension.packageJSON.version as string || '';
		this.post_to_webview = (message: Record<string, unknown>): void => { this.webviewPanel.webview.postMessage(message); };
		this.activity_commands = new ActivityCommands(this.base_uri, this.activity_analyser, this.post_to_webview);
	}

	// rebuilds an absolute path into a URI carrying the workspace scheme, so discovery and opens never assume file:
	private resolveWorkspaceUri(absolute_path: string): vscode.Uri {
		return this.base_uri.with({ path: absolute_path });
	}

	/**
	 * Wires the panel: install the webview HTML, build the initial doc, arm the
	 * active-file watcher, register every vscode listener, and subscribe to webview
	 * messages. Returns once initial state is built (the doc is pushed lazily on the
	 * webview's requestInitialState).
	 *
	 * A docless session has nothing to build here: it leaves active_doc / active_path unset
	 * and the folder-at-root open runs from requestInitialState, once the webview is listening.
	 */
	public async start(): Promise<void> {
		this.onActivate(this.webviewPanel);
		this.webviewPanel.onDidChangeViewState(() => {
			if (this.webviewPanel.active) { this.onActivate(this.webviewPanel); }
			this.syncVisibility();
		});
		this.webviewPanel.webview.options = { enableScripts: true };
		this.webviewPanel.webview.html = this.getHtml(this.webviewPanel.webview);
		if (this.initialDocument) { await this.buildInitialDoc(this.initialDocument); }
		this.registerListeners();
	}

	// --- doc construction and dispatch ---

	/**
	 * Builds a Doc from a URI + raw text, for disk-change events: the TextDocument cache is not
	 * refreshed for external edits to a file with no visible editor, so reading bytes directly
	 * bypasses the stale cache.
	 *
	 * `skip_parse` true (a folder-mode doc) ships text only, with `content` left undefined; the
	 * webview parses it itself. `hash_sha256` always comes from `text`, unaffected either way.
	 */
	private async buildDocFromUriAndText(uri: vscode.Uri, text: string, created_by: string, skip_parse: boolean): Promise<Doc> {
		const mdast = skip_parse ? undefined : await this.parse_pool.parse(uri.path, text);
		const relative = vscode.workspace.asRelativePath(uri, false);
		// mtime drives the webview's relevance order; a missing stat is tolerated so the Doc still ships
		let mtime: number | undefined;
		try {
			const st = await vscode.workspace.fs.stat(uri);
			mtime = st.mtime;
		} catch (err) {
			debug('buildDocFromUriAndText: stat failed for %s: %O', uri.path, err);
		}
		return {
			path: uri.path,
			relative_path: !relative.startsWith('/') ? relative : undefined,
			id: await generateIdentifier(uri.path),
			content: mdast,
			text,
			hash_sha256: await generateIdentifier(text),
			mtime,
			updatedAt: new Date().toISOString(),
			createdBy: created_by,
		};
	}

	private async buildDoc(document: vscode.TextDocument, skip_parse: boolean): Promise<Doc> {
		return this.buildDocFromUriAndText(document.uri, document.getText(), 'activeEditor', skip_parse);
	}

	/**
	 * True when a doc at this path would be merged into the folder aggregate by `sendDoc` (mirrors
	 * its own admission check), computed BEFORE building so a caller can decide whether to skip
	 * the host-side parse. False whenever `integration_path` is unset.
	 */
	private isFolderScoped(target_path: string): boolean {
		return this.integration_path !== undefined
			&& this.isWithinIntegrationPath(target_path)
			&& this.isAdmittedByIntegrationFilters(target_path);
	}

	// a stale-parse cancellation is expected traffic, not a failure; every other error still logs
	private logUnlessStale(source: string, message: string, err: unknown): void {
		if (isParseStaleError(err)) { debug('%s: %s (superseded by a newer edit, dropping)', source, message); return; }
		writeToErrorLog(source, message, err);
	}

	// this doc's own debounce: the floor until its parse time is measured, then that time (capped)
	private debounceMsFor(doc_path: string): number {
		const measured = this.last_parse_duration_ms.get(doc_path);
		if (measured === undefined) { return CHANGE_DEBOUNCE_MS; }
		return Math.min(CHANGE_DEBOUNCE_CAP_MS, Math.max(CHANGE_DEBOUNCE_MS, measured));
	}

	/**
	 * Watcher-driven work is skipped while the panel is hidden; a hidden->visible transition catches
	 * up that skipped work here in one pass, rather than replaying it tick by tick.
	 */
	private syncVisibility(): void {
		const visible = this.webviewPanel.visible;
		if (visible && !this.was_visible) {
			void this.refreshAfterBecomingVisible().catch(err => this.logUnlessStale('syncVisibility', 'refresh after becoming visible failed', err));
		}
		this.was_visible = visible;
	}

	// current_file re-fetches the active doc; folder mode re-enters, reloading only what changed
	private async refreshAfterBecomingVisible(): Promise<void> {
		if (this.integration_path) {
			await this.enterFolderMode(this.integration_path, {});
			return;
		}
		if (!this.active_path) { return; }
		const current_editor = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === this.active_path);
		if (current_editor) {
			// only reached outside folder mode, since that branch already returned - never folder-scoped
			this.active_doc = await this.buildDoc(current_editor.document, false);
		} else {
			// no visible editor owns this doc, so re-read it from disk the same way the watcher's own onChange does
			const uri = this.resolveWorkspaceUri(this.active_path);
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(bytes);
			this.active_doc = await this.buildDocFromUriAndText(uri, text, 'fsWatcher', false);
		}
		this.sendDoc(this.active_doc);
		this.sendCurrentSelection();
	}

	/**
	 * In folder mode, only docs inside integration_path passing both filters join the merged
	 * view; an active editor's rejected doc still reaches the webview via sendActiveEditorDoc, so
	 * auto-integration reconcile can follow the editor out of the folder. Integration docs merge
	 * into the existing map, since the replace-strategy default would otherwise wipe every other
	 * file.
	 */
	private sendDoc(doc: Doc): void {
		const timestamped = { ...doc, updateSentAt: new Date().toISOString() };
		debug('sendDoc %s', doc.path);
		if (this.integration_path && (!this.isWithinIntegrationPath(doc.path) || !this.isAdmittedByIntegrationFilters(doc.path))) {
			debug('sendDoc: skipping out-of-integration doc %s', doc.path);
			if (doc.path === this.active_path) { this.sendActiveEditorDoc(timestamped); }
			return;
		}
		const merge_strategy = this.integration_path ? 'merge' : undefined;
		if (this.integration_path) {
			this.integration_docs[doc.id] = timestamped;
		}
		this.webviewPanel.webview.postMessage({
			type: 'update',
			partial: { docs: { [doc.id]: timestamped } },
			merge_strategy,
			workspace_root: this.workspace_root,
			extension_version: this.extension_version,
		});
	}

	// surfaces the active editor's doc without merging it into the folder aggregate, for the out-of-scope case sendDoc drops
	private sendActiveEditorDoc(doc: Doc): void {
		this.webviewPanel.webview.postMessage({
			type: 'activeEditorDoc',
			doc,
		});
	}

	private sendSelection(doc_path: string, head: number, anchor: number): void {
		this.webviewPanel.webview.postMessage({
			type: 'selectionChanged',
			docPath: doc_path,
			selection: { head, anchor },
		});
	}

	// clears props.selection so the board's virtual caret drives highlight/select instead of a phantom editor caret
	private sendSelectionCleared(doc_path: string): void {
		this.webviewPanel.webview.postMessage({
			type: 'selectionChanged',
			docPath: doc_path,
			selection: null,
		});
	}

	private sendCurrentSelection(): void {
		if (!this.active_path) { return; }
		const editor = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === this.active_path);
		if (editor) {
			const head = editor.document.offsetAt(editor.selection.active);
			const anchor = editor.document.offsetAt(editor.selection.anchor);
			this.sendSelection(this.active_path, head, anchor);
		} else {
			// no visible editor owns this doc, so the board becomes the caret owner instead of pinning a phantom caret
			this.sendSelectionCleared(this.active_path);
		}
	}

	/**
	 * Builds the initial active doc but defers pushing it to the webview until
	 * requestInitialState arrives - the webview sends setIntegration first on reload,
	 * so by then integration_path is set and the merge path runs instead of wiping the
	 * saved folder docs map.
	 */
	private async buildInitialDoc(initialDocument: vscode.TextDocument): Promise<void> {
		this.active_path = initialDocument.uri.path;
		try {
			// no folder integration exists yet at this point in the panel's lifecycle - never folder-scoped
			this.active_doc = await this.buildDoc(initialDocument, false);
		} catch (err) {
			this.logUnlessStale('buildInitialDoc', `failed to build initial document ${initialDocument.uri.path}`, err);
		}
		this.syncActiveFileWatcher();
	}

	// --- active-file watcher ---

	/**
	 * Idempotent: tears any existing watcher down, then re-arms if the active file
	 * currently needs one. Call whenever the active path, integration mode, setting
	 * value, or visible-editor set changes.
	 */
	private syncActiveFileWatcher(): void {
		if (this.active_file_watcher) {
			this.active_file_watcher.dispose();
			this.active_file_watcher = undefined;
		}
		// folder mode has integration_watcher; double-armed watchers would re-parse the same file twice
		if (this.integration_path) { return; }
		if (!this.active_path) { return; }
		if (!readSetting('watchUnopenedFilesInViewer')) { return; }
		// a visible editor already drives onDidChangeTextDocument; this only fills the gap when there is none
		const visible = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === this.active_path);
		if (visible) { return; }
		this.armActiveFileWatcher();
	}

	private armActiveFileWatcher(): void {
		try {
			// active_path is a uri.path (always POSIX), so path.posix keeps the split scheme-safe on non-file: hosts
			const folder = path.posix.dirname(this.active_path!);
			const filename = path.posix.basename(this.active_path!);
			const pattern = new vscode.RelativePattern(this.resolveWorkspaceUri(folder), filename);
			this.active_file_watcher = vscode.workspace.createFileSystemWatcher(pattern);
			const onChange = async (changed_uri: vscode.Uri): Promise<void> => {
				if (changed_uri.path !== this.active_path) { return; }
				// nothing is rendering this panel; syncVisibility catches this doc up once it's visible again
				if (!this.webviewPanel.visible) { return; }
				try {
					// fs.readFile bypasses the TextDocument cache; openTextDocument would return stale content here
					const bytes = await vscode.workspace.fs.readFile(changed_uri);
					const text = new TextDecoder().decode(bytes);
					// hash-gate: a watcher can fire twice per save; skip the parse+post if content hasn't changed
					if (this.active_doc && this.active_doc.hash_sha256 === await generateIdentifier(text)) { return; }
					// armed only outside folder mode (syncActiveFileWatcher disposes it there) - never folder-scoped
					this.active_doc = await this.buildDocFromUriAndText(changed_uri, text, 'fsWatcher', false);
					this.sendDoc(this.active_doc);
				} catch (err) {
					this.logUnlessStale('armActiveFileWatcher', `re-parse failed for ${changed_uri.path}`, err);
				}
			};
			this.active_file_watcher.onDidChange(onChange);
			this.active_file_watcher.onDidCreate(onChange);
			debug('active-file watcher armed for %s', this.active_path);
		} catch (err) {
			writeToErrorLog('armActiveFileWatcher', `failed to create watcher for ${this.active_path}`, err);
		}
	}

	// --- settings ---

	private sendSettingsCascade(): void {
		this.webviewPanel.webview.postMessage({ type: 'settingsCascade', settings: buildSettingsCascadePayload() });
	}

	// --- vscode listeners ---

	private registerListeners(): void {
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e));
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(editor => this.onDidChangeActiveTextEditor(editor));
		// an editor split opening or closing for the active file flips whether we still need the active-file watcher
		const visibleEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors(() => {
			this.syncActiveFileWatcher();
			// re-evaluate caret ownership when editors open or close: a closed editor hands the caret back to the board
			this.sendCurrentSelection();
		});
		const configSubscription = vscode.workspace.onDidChangeConfiguration(e => this.onDidChangeConfiguration(e));
		this.webviewPanel.webview.onDidReceiveMessage(e => this.handleMessage(e));
		const selectionSubscription = vscode.window.onDidChangeTextEditorSelection(e => this.onDidChangeTextEditorSelection(e));
		this.webviewPanel.onDidDispose(() => {
			this.onDispose(this.webviewPanel);
			if (this.change_timer) { clearTimeout(this.change_timer); }
			if (this.selection_timer) { clearTimeout(this.selection_timer); }
			this.discardDiscoveryBatch();
			if (this.integration_watcher) { this.integration_watcher.dispose(); this.integration_watcher = undefined; }
			if (this.active_file_watcher) { this.active_file_watcher.dispose(); this.active_file_watcher = undefined; }
			if (this.activity_demanded) { this.activity_analyser.withdraw(this.post_to_webview); this.activity_demanded = false; }
			changeDocumentSubscription.dispose();
			activeEditorSubscription.dispose();
			visibleEditorsSubscription.dispose();
			selectionSubscription.dispose();
			configSubscription.dispose();
		});
	}

	// debounce delay is adaptive (debounceMsFor): a slow-parsing doc self-throttles instead of a fixed interval
	private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
		if (e.document.uri.path !== this.active_path) { return; }
		if (this.change_timer) { clearTimeout(this.change_timer); }
		this.change_timer = setTimeout(async () => {
			this.change_timer = undefined;
			const started_ms = Date.now();
			try {
				// the active file can sit inside the folder integration too; sendDoc merges it like any other folder doc
				const skip_parse = this.isFolderScoped(e.document.uri.path);
				this.active_doc = await this.buildDoc(e.document, skip_parse);
				// only a real host-side parse yields a measurement to debounce off; a skipped doc keeps the floor delay
				if (!skip_parse) { this.last_parse_duration_ms.set(e.document.uri.path, Date.now() - started_ms); }
				this.sendDoc(this.active_doc);
				// send selection after doc update so the webview never has stale MDAST with fresh caret
				this.sendCurrentSelection();
			} catch (err) {
				this.logUnlessStale('onDidChangeTextDocument', `failed to process document change for ${e.document.uri.path}`, err);
			}
		}, this.debounceMsFor(e.document.uri.path));
	}

	// switch displayed document when the user switches to a different .md editor
	private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
		if (!editor || !editor.document.uri.path.endsWith('.md')) { return; }
		if (editor.document.uri.path === this.active_path) { return; }
		try {
			// a newly active editor can be inside the folder integration too, rendering through the aggregate
			this.active_doc = await this.buildDoc(editor.document, this.isFolderScoped(editor.document.uri.path));
			this.active_path = editor.document.uri.path;
			this.sendDoc(this.active_doc);
			const head = editor.document.offsetAt(editor.selection.active);
			const anchor = editor.document.offsetAt(editor.selection.anchor);
			this.sendSelection(this.active_path, head, anchor);
			this.syncActiveFileWatcher();
		} catch (err) {
			this.logUnlessStale('onDidChangeActiveTextEditor', `failed to switch active document to ${editor?.document.uri.path}`, err);
		}
	}

	private onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent): void {
		// the active-file watcher is armed off this setting, so a change re-evaluates it
		if (e.affectsConfiguration('notethink.settings.view.generic.watchUnopenedFilesInViewer')) {
			this.syncActiveFileWatcher();
		}
		// one payload carries every setting, so one catch-all covers every key
		if (e.affectsConfiguration('notethink.settings')) {
			this.sendSettingsCascade();
		}
		// a filter edited directly in settings.json re-discovers, since integration_include/exclude otherwise stay stale
		const filter_settings_changed =
			e.affectsConfiguration('notethink.settings.files.includeFilter') ||
			e.affectsConfiguration('notethink.settings.files.excludeFilter');
		if (filter_settings_changed && this.integration_path) {
			void this.enterFolderMode(this.integration_path, {}).catch(err =>
				writeToErrorLog('onDidChangeConfiguration', `re-enter folder mode on filter change failed for ${this.integration_path ?? ''}`, err)
			);
		}
	}

	// track text editor selection changes - debounced to avoid flooding the webview
	private onDidChangeTextEditorSelection(e: vscode.TextEditorSelectionChangeEvent): void {
		if (e.textEditor.document.uri.path !== this.active_path) { return; }
		// the change handler sends selection after re-parse, to keep MDAST and caret in sync
		if (this.change_timer) { return; }
		if (this.selection_timer) { clearTimeout(this.selection_timer); }
		this.selection_timer = setTimeout(() => {
			const selection = e.selections[0];
			const head = e.textEditor.document.offsetAt(selection.active);
			const anchor = e.textEditor.document.offsetAt(selection.anchor);
			this.sendSelection(e.textEditor.document.uri.path, head, anchor);
		}, SELECTION_DEBOUNCE_MS);
	}

	// --- webview message dispatch ---

	// e is the untyped envelope onDidReceiveMessage delivers; each handler narrows the fields it reads
	private async handleMessage(e: Record<string, unknown>): Promise<void> {
		debug('onDidReceiveMessage', e.type);
		try {
			if (await this.activity_commands.handleMessage(e)) { return; }
			switch (e.type) {
				case 'requestInitialState': return this.handleRequestInitialState();
				case 'updateSetting': return this.handleUpdateSetting(e);
				case 'promoteSettingsToUser': return this.handlePromoteSettings();
				case 'resetSettingsToDefault': return this.handleResetSettings();
				case 'restoreSettingsToBuiltinDefault': return this.handleRestoreBuiltinDefaults();
				case 'revealRange':
				case 'selectRange': return this.handleRevealRange(e);
				case 'setIntegration': return this.handleSetIntegration(e);
				case 'requestJumpTargets': return this.handleRequestJumpTargets(e);
				case 'openFile': return this.handleOpenFile(e);
				case 'editText': return this.handleEditText(e);
				case 'openExternal': return this.handleOpenExternal(e);
				case 'openRelative': return this.handleOpenRelative(e);
				case 'activityDemand': return this.handleActivityDemand();
				case 'activityWithdraw': return this.handleActivityWithdraw();
				case 'renderError': {
					// rebuilds an Error from the payload so the client-error report keeps its stack
					const render_error = new Error(e.message as string);
					render_error.stack = e.stack as string;
					writeToErrorLog('handleMessage', 'webview render error', render_error);
					return;
				}
			}
		} catch (err) {
			writeToErrorLog('handleMessage', `dispatch failed for message type ${String(e?.type)}`, err);
		}
	}

	private async handleRequestInitialState(): Promise<void> {
		try {
			// after a window reload VS Code may restore editors in unpredictable order, so re-check the active .md file
			const current_editor = vscode.window.activeTextEditor;
			if (current_editor?.document.uri.path.endsWith('.md') && current_editor.document.uri.path !== this.active_path) {
				// setIntegration arrives before requestInitialState on reload, so integration_path may already be set
				this.active_doc = await this.buildDoc(current_editor.document, this.isFolderScoped(current_editor.document.uri.path));
				this.active_path = current_editor.document.uri.path;
			}
			if (this.active_doc) {
				this.sendDoc(this.active_doc);
				this.sendCurrentSelection();
			}
			this.sendSettingsCascade();
			if (this.activity_demanded) { this.activity_analyser.resendTo(this.post_to_webview); }
			this.syncActiveFileWatcher();
			await this.openFolderAtWorkspaceRootIfDocless();
		} catch (err) {
			this.logUnlessStale('handleRequestInitialState', 'failed to send initial state', err);
		}
	}

	// posted when a note first resolves to the `agent` card type, and again on every reconnect; demand() is idempotent
	private handleActivityDemand(): void {
		this.activity_demanded = true;
		this.activity_analyser.demand(this.post_to_webview);
	}

	// the shared analyser keeps running for any other panel still demanding it
	private handleActivityWithdraw(): void {
		if (!this.activity_demanded) { return; }
		this.activity_demanded = false;
		this.activity_analyser.withdraw(this.post_to_webview);
	}

	/**
	 * A docless session (openViewer with no active .md editor) has no file to render, so the board
	 * opens in folder mode at the workspace root instead. Runs from requestInitialState rather than
	 * start() because that message is the first proof the webview is listening - a seed posted into a
	 * webview whose bundle has not loaded yet is simply dropped.
	 *
	 * Inert whenever anything else already owns the scope: an active doc (single-file mode is
	 * unchanged) or an integration_path the webview restored from persisted state (its setIntegration
	 * is deliberately posted BEFORE requestInitialState, so it has already landed by now).
	 */
	private async openFolderAtWorkspaceRootIfDocless(): Promise<void> {
		if (this.active_doc || this.integration_path) { return; }
		// same first-folder convention the constructor uses to resolve workspace_root; multi-root picks folder [0]
		const root_path = vscode.workspace.workspaceFolders?.[0]?.uri.path;
		if (!root_path) { return; }
		debug('docless open: entering folder mode at workspace root %s', root_path);
		this.sendSeedIntegration(root_path);
		await this.enterFolderMode(root_path, {});
	}

	/**
	 * Tells the webview to scope its own folder view state to this path. The webview decides
	 * folder-vs-file from its `__folder__` view state alone, so a host-side enterFolderMode is
	 * invisible to it: with no seed it resolves current_file and renders an arbitrary file out of
	 * the aggregate the discovery ships. This rides the existing validated command channel rather
	 * than the aggregate `update` payload, which is a hot path and carries no scope today.
	 */
	private sendSeedIntegration(folder_path: string): void {
		this.webviewPanel.webview.postMessage({
			type: 'command',
			command: 'setIntegrationScope',
			mode: INTEGRATION_MODE_FOLDER,
			path: folder_path,
		});
	}

	private async handleUpdateSetting(e: Record<string, unknown>): Promise<void> {
		// scope defaults to the edit target so a change stays local; "Save as default" sends 'global'
		const setting = e.setting as unknown;
		const value = e.value as unknown;
		const scope = (e.scope as 'workspace' | 'global' | undefined) ?? 'workspace';
		try {
			if (!isSettingKey(setting)) {
				writeToLogAtLevel('error', 'handleUpdateSetting', `unknown setting ${String(setting)}`);
				return;
			}
			const target = scope === 'global' ? vscode.ConfigurationTarget.Global : editTarget();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- value's union widens to unknown at the wire boundary
			await writeSetting(setting, value as any, target);
		} catch (err) {
			writeToErrorLog('handleUpdateSetting', `writeSetting failed for ${String(setting)}`, err);
		}
	}

	/**
	 * Promote every resolved setting to the user scope, so this window's choices become the default in
	 * every other one. Snapshot first, because workspace may shadow user; write each to Global; then clear
	 * Workspace, so the user scope is the value's only home rather than one of two agreeing copies.
	 */
	private async handlePromoteSettings(): Promise<void> {
		try {
			const keys = settingKeys();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-key value types are heterogeneous; the snapshot is opaque
			const resolved: Record<string, any> = {};
			for (const key of keys) {
				resolved[key] = readSetting(key);
			}
			for (const key of keys) {
				await writeSetting(key, resolved[key], vscode.ConfigurationTarget.Global);
			}
			// Workspace, not editTarget(): a folderless window has nothing at that scope to clear anyway
			for (const key of keys) {
				if (hasWorkspaceOverride(key)) {
					await writeSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
				}
			}
		} catch (err) {
			writeToErrorLog('handlePromoteSettings', 'failed to promote settings to user scope', err);
		}
	}

	private async handleResetSettings(): Promise<void> {
		// clear every Workspace-scope override so each setting falls back to User then built-in
		try {
			for (const key of settingKeys()) {
				if (hasWorkspaceOverride(key)) {
					await writeSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
				}
			}
		} catch (err) {
			writeToErrorLog('handleResetSettings', 'failed to clear workspace overrides', err);
		}
	}

	/**
	 * Clear both the Workspace- and the User-scope override, so every setting falls back to the built-in
	 * default declared in package.json. This is the recovery path for a user default that has itself been
	 * edited away - a wiped exclude filter, say - where "Revert to defaults" can no longer help, because
	 * the default it reverts to is the broken one.
	 */
	private async handleRestoreBuiltinDefaults(): Promise<void> {
		try {
			for (const key of settingKeys()) {
				if (!hasOverride(key)) { continue; }
				await writeSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
				await writeSetting(key, undefined, vscode.ConfigurationTarget.Global);
			}
		} catch (err) {
			writeToErrorLog('handleRestoreBuiltinDefaults', 'failed to clear workspace and user overrides', err);
		}
	}

	/**
	 * A reveal target is allowed inside an open workspace folder, or as the board's own trusted
	 * current file - the latter covers a folderless window (File > Open a loose .md), where
	 * isWithinWorkspace fails closed and would silently kill every click. active_path is only ever
	 * set from a real opened document, never from a webview message, so this still refuses an
	 * attacker-supplied path that is not the board's own file.
	 */
	private isRevealTargetAllowed(doc_path: string): boolean {
		if (isWithinWorkspace(doc_path, { requireExtension: '.md' })) { return true; }
		return doc_path === this.active_path && doc_path.toLowerCase().endsWith('.md');
	}

	/**
	 * Prefers an already-visible editor (revealInVisibleEditor); otherwise revealByOpening switches
	 * an existing non-board group to the file, or spawns a new beside group when
	 * openNewEditorIfNoneOpen is set or the click forced it (ctrl/cmd-click). switch_editor is
	 * hardcoded true (focus transfers with the caret, under the single-caret model) but stays
	 * plumbed through so a passive-mirror mode is a one-line reintroduction later.
	 */
	private async handleRevealRange(e: Record<string, unknown>): Promise<void> {
		const doc_path = e.docPath as string;
		const from = e.from as number;
		const to = (e.to ?? e.from) as number;
		try {
			if (!doc_path) { return; }
			// gates both the visible-editor and openTextDocument paths, since webview-supplied paths are untrusted
			if (!this.isRevealTargetAllowed(doc_path)) {
				writeToLogAtLevel('error', 'handleRevealRange', `${String(e.type)}: path outside workspace, refusing ${doc_path}`);
				return;
			}
			const switch_editor = true;
			if (this.revealInVisibleEditor(doc_path, from, to, switch_editor)) { return; }
			const force_open = e.forceOpen === true;
			await this.revealByOpening(doc_path, from, to, force_open || readSetting('openNewEditorIfNoneOpen'));
		} catch (err) {
			writeToErrorLog('handleRevealRange', `${String(e.type)} failed for ${doc_path}`, err);
		}
	}

	// reveals/selects in a visible editor without opening anything; returns true if handled
	private revealInVisibleEditor(doc_path: string, from: number, to: number, switch_editor: boolean): boolean {
		const existing = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === doc_path);
		if (!existing) { return false; }
		const document = existing.document;
		const start_pos = document.positionAt(from);
		const end_pos = document.positionAt(to);
		// keeps active at `from` so selectionChanged reports the note's start, not past end_body
		existing.selection = (from === to)
			? new vscode.Selection(start_pos, end_pos)
			: new vscode.Selection(end_pos, start_pos);
		existing.revealRange(new vscode.Range(start_pos, end_pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		// otherwise the caret moves but the view keeps focus
		if (switch_editor) {
			vscode.window.showTextDocument(existing.document, existing.viewColumn, false);
		}
		return true;
	}

	/**
	 * Opens the doc in a column that is not this panel's, preferring a group that already has it
	 * open. Accepts a resolved URI (scheme-preserving) or an absolute path, rebuilt via the
	 * workspace scheme carrier.
	 */
	private async revealByOpening(target: string | vscode.Uri, from: number, to: number, open_new_if_none: boolean): Promise<void> {
		const uri = typeof target === 'string' ? this.resolveWorkspaceUri(target) : target;
		let target_column = this.findColumnWithDoc(uri.path);
		if (target_column === undefined) {
			const notethink_column = this.webviewPanel.viewColumn;
			const other_group = vscode.window.tabGroups?.all?.find(g => g.viewColumn !== notethink_column);
			if (other_group) {
				target_column = other_group.viewColumn;
			} else if (open_new_if_none) {
				target_column = vscode.ViewColumn.Beside;
			} else {
				// the board is the only editor group open, and openNewEditorIfNoneOpen (off by default) is not set
				return;
			}
		}
		const document = await vscode.workspace.openTextDocument(uri);
		const start_pos = document.positionAt(from);
		const end_pos = document.positionAt(to);
		const editor = await vscode.window.showTextDocument(document, {
			viewColumn: target_column,
			preserveFocus: false,
			preview: false,
		});
		editor.selection = (from === to)
			? new vscode.Selection(start_pos, end_pos)
			: new vscode.Selection(end_pos, start_pos);
		editor.revealRange(new vscode.Range(start_pos, end_pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}

	private findColumnWithDoc(doc_path: string): vscode.ViewColumn | undefined {
		try {
			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
					// skips the board's own tab, or a single-file reveal would replace the rendered view with a plain text editor
					if (input?.viewType === NOTETHINK_VIEW_TYPE) { continue; }
					if (input?.uri?.path === doc_path) { return group.viewColumn; }
				}
			}
		} catch (err) {
			// tabGroups API may be unavailable on older hosts - caller falls back to a beside column
			debug('findColumnWithDoc: tabGroups unavailable: %O', err);
		}
		return undefined;
	}

	private async handleSetIntegration(e: Record<string, unknown>): Promise<void> {
		const mode = e.mode as string;
		const folder_path = e.path as string;
		if (mode === INTEGRATION_MODE_FOLDER && folder_path) {
			// validates before any teardown, so a poisoned path can't dismantle a legitimate integration
			if (!isWithinWorkspace(folder_path)) {
				writeToLogAtLevel('error', 'handleSetIntegration', `folder outside workspace, refusing ${folder_path}`);
				return;
			}
			await this.enterFolderMode(folder_path, e);
		} else if (mode === INTEGRATION_MODE_CURRENT_FILE) {
			// optional path targets a specific file (Files-drawer click); undefined keeps the active editor
			await this.enterCurrentFileMode(typeof e.path === 'string' ? e.path : undefined);
		}
		// disposes the active-file watcher in folder mode, or arms one if the active file has no visible editor
		this.syncActiveFileWatcher();
	}

	/**
	 * Snapshots the previous integration_docs before clearing the live cache, since discoverFolderDocs's
	 * fast-path detection compares against it to decide whether to keep or replace each entry.
	 * Filters are resolved before discovery so a wider set than the user wants is never loaded, and
	 * the workspace project universe is recomputed after, so the exclude pattern used is current.
	 */
	private async enterFolderMode(folder_path: string, e: Record<string, unknown>): Promise<void> {
		try {
			if (this.integration_watcher) {
				this.integration_watcher.dispose();
				this.integration_watcher = undefined;
			}
			const previous_docs = { ...this.integration_docs };
			for (const key of Object.keys(this.integration_docs)) { delete this.integration_docs[key]; }
			this.discardDiscoveryBatch();
			this.integration_path = folder_path;
			this.adoptFolderFilters(e);
			await this.computeWorkspaceProjects();
			const pattern = new vscode.RelativePattern(this.resolveWorkspaceUri(folder_path), this.integration_include);
			await this.discoverFolderDocs(pattern, folder_path, previous_docs);
			this.armFolderWatcher(pattern);
		} catch (err) {
			writeToErrorLog('enterFolderMode', `failed to enter folder mode at ${folder_path}`, err);
		}
	}

	// cascade precedence: built-in default -> user -> workspace config -> explicit message override
	private adoptFolderFilters(e: Record<string, unknown>): void {
		// every read funnels through the settings module, so this cannot drift from the webview's view
		this.integration_include = readSetting('includeFilter');
		this.integration_exclude = readSetting('excludeFilter');
		// an empty include is degenerate and falls back to the default; an empty exclude legitimately means "exclude nothing"
		if (typeof e.include === 'string') {
			this.integration_include = e.include.trim() === '' ? DEFAULT_INCLUDE_FILTER : e.include;
		}
		if (typeof e.exclude === 'string') {
			this.integration_exclude = e.exclude;
		}
	}

	// single source of truth for containment; isPathWithin guards `..` traversal and sibling prefixes like /ws vs /ws-evil
	private isWithinIntegrationPath(target_path: string): boolean {
		if (!this.integration_path) { return false; }
		return isPathWithin(target_path, [this.integration_path]);
	}

	/**
	 * The base every exclude glob is matched against: the path relative to the WORKSPACE ROOT,
	 * never relative to the folder the board is currently rooted at.
	 *
	 * This is the same base VS Code uses for `files.exclude`, `search.exclude` and the exclude
	 * argument of `findFiles`, so the host-side post-filter and findFiles agree on one origin.
	 * Matching relative to the integration folder instead silently defeats every MULTI-SEGMENT
	 * exclude entry the moment the board is rooted inside it: with the board on `notegit`, a
	 * `notegit/nodejs/...` file presents as `nodejs/...`, the `notegit/` segment is gone, and the
	 * `notegit/nodejs` brace member stops matching. Single-segment entries (node_modules, dist,
	 * .git) hide the bug, because the pattern's leading globstar matches them at any depth from
	 * any base, so the defect only ever shows on a multi-segment entry.
	 *
	 * Scheme-safe: operates on uri.path (always POSIX), never fsPath which assumes file: + the OS separator.
	 * With no resolvable root the path is returned unchanged, which is inert: every caller below sits
	 * behind a live isWithinWorkspace gate that already refuses when there are no workspace folders.
	 */
	private toWorkspaceRelative(absolute_path: string): string {
		const workspace_root = this.workspaceRootFor(absolute_path);
		if (!workspace_root) { return absolute_path; }
		return path.posix.relative(workspace_root, absolute_path);
	}

	// resolves the containing folder live, since a multi-root workspace has several and the cached workspace_root may be empty
	private workspaceRootFor(absolute_path: string): string {
		const root_paths = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.path);
		return root_paths.find(root_path => isPathWithin(absolute_path, [root_path])) ?? this.workspace_root;
	}

	// empty exclude means never excluded
	private isExcludedByIntegrationFilter(target_path: string): boolean {
		if (this.integration_exclude.trim() === '') { return false; }
		return !globMatches(this.toWorkspaceRelative(target_path), '', this.integration_exclude);
	}

	/**
	 * Whether a path passes both folder-mode filters, and so may join integration_docs. Discovery is
	 * already scoped by the include pattern, but the active editor (sendDoc) and the folder watcher
	 * reach the aggregate by other routes, and each must apply the same two filters, or a file the
	 * user filtered out joins the board the moment it is opened or changed.
	 *
	 * The include glob is matched relative to integration_path, mirroring the RelativePattern that
	 * findFiles and the readDirectory walk use; the exclude is matched workspace-relative.
	 */
	private isAdmittedByIntegrationFilters(target_path: string): boolean {
		if (!this.integration_path) { return false; }
		if (!globMatches(path.posix.relative(this.integration_path, target_path), this.integration_include, '')) { return false; }
		return !this.isExcludedByIntegrationFilter(target_path);
	}

	// whether a directory's whole subtree is excluded, probed via a representative child file against the same gate
	private isExcludedDirectory(absolute_dir_path: string): boolean {
		if (this.integration_exclude.trim() === '') { return false; }
		return !globMatches(`${this.toWorkspaceRelative(absolute_dir_path)}/${EXCLUDE_PROBE_FILE}`, '', this.integration_exclude);
	}

	/**
	 * Enumerates top-level subfolders of the workspace root, filters by exclude, sorts
	 * alphabetically. The webview uses this set as the stable universe for pill labels and hues,
	 * so descending into a sub-project does not re-derive the disambiguation against a smaller
	 * visible set (notethink's label staying "NT" rather than collapsing to "NO" when a
	 * same-initial sibling drops out of view).
	 */
	private async computeWorkspaceProjects(): Promise<void> {
		if (!this.workspace_root) {
			this.workspace_projects = [];
			return;
		}
		try {
			const entries = await vscode.workspace.fs.readDirectory(this.resolveWorkspaceUri(this.workspace_root));
			const dir_names = entries
				.filter(([, type]) => type === vscode.FileType.Directory)
				.map(([name]) => name);
			// the same exclude gate as file discovery, so .git, node_modules, etc. don't consume hue indices
			const filtered = dir_names.filter(name => !this.isExcludedDirectory(path.posix.join(this.workspace_root, name)));
			this.workspace_projects = filtered.sort();
		} catch (err) {
			writeToErrorLog('computeWorkspaceProjects', `failed to read workspace root ${this.workspace_root}`, err);
			this.workspace_projects = [];
		}
	}

	// scheme: file - VS Code's native findFiles honours the RelativePattern and its glob exclude
	private async discoverViaFindFiles(pattern: vscode.RelativePattern): Promise<Array<vscode.Uri>> {
		// an empty exclude becomes null, so findFiles applies no default exclusions either
		const find_exclude = this.integration_exclude.trim() === '' ? null : this.integration_exclude;
		return vscode.workspace.findFiles(pattern, find_exclude);
	}

	/**
	 * Non-file: scheme: findFiles ignores a custom-scheme RelativePattern, so this walks the
	 * folder with the provider's own readDirectory (the API the Explorer uses) and applies the
	 * include glob directly. Excluded directories are pruned so the walk never descends into
	 * node_modules/.git/etc; the surviving list still passes discoverFolderDocs's exclude filter.
	 */
	private async discoverViaReadDirectoryWalk(base_uri: vscode.Uri, folder_path: string): Promise<Array<vscode.Uri>> {
		const results: Array<vscode.Uri> = [];
		const stack: Array<vscode.Uri> = [base_uri];
		let visited = 0;
		while (stack.length > 0 && visited < MAX_WALK_ENTRIES) {
			visited++;
			const dir = stack.pop()!;
			let entries: Array<[string, vscode.FileType]>;
			try {
				entries = await vscode.workspace.fs.readDirectory(dir);
			} catch (err) {
				writeToErrorLog('discoverViaReadDirectoryWalk', `readDirectory failed for ${dir.path}`, err);
				continue;
			}
			for (const [name, type] of entries) {
				const child = vscode.Uri.joinPath(dir, name);
				// the include glob is folder-relative, mirroring findFiles' RelativePattern; the exclude matches workspace-root-relative
				const child_rel = path.posix.relative(folder_path, child.path);
				if (type === vscode.FileType.Directory) {
					// prune dirs whose contents the exclude would drop so the walk never descends into node_modules/.git/etc
					if (!this.isExcludedDirectory(child.path)) { stack.push(child); }
				} else if (type === vscode.FileType.File && globMatches(child_rel, this.integration_include, '')) {
					results.push(child);
				}
			}
		}
		if (visited >= MAX_WALK_ENTRIES) {
			writeToLog('discoverViaReadDirectoryWalk', `walk cap hit: stopped after ${MAX_WALK_ENTRIES} directories under ${folder_path}`);
		}
		return results;
	}

	/**
	 * Phase 1: discover and load in parallel; each file streams its own merge update
	 * as it completes so a slow file never blocks the others. After all settle, a
	 * replace update ships the canonical map, pruning stale docs from a saved session.
	 *
	 * Fast-path detection: stat each discovered URI and compare the {path, mtime} set
	 * against integration_docs. When they match exactly (no new files, no missing files,
	 * no mtime changes - typical for a breadcrumb re-enter, an integration-mode toggle,
	 * or a filter edit that doesn't change the result set), skip the per-file reload
	 * AND skip the pendingChange emit. The aggregated payload still ships so the webview
	 * re-runs its merge with the cached docs.
	 */
	private async discoverFolderDocs(pattern: vscode.RelativePattern, folder_path: string, previous_docs: HashMapOf<Doc>): Promise<void> {
		// findFiles only honours a RelativePattern on the file: scheme; any other scheme falls back to the readDirectory walk
		const base_uri = this.resolveWorkspaceUri(folder_path);
		const discovered = base_uri.scheme === 'file'
			? await this.discoverViaFindFiles(pattern)
			: await this.discoverViaReadDirectoryWalk(base_uri, folder_path);
		// defense in depth: findFiles' brace-expanded exclude has edge cases, and the watcher armed below has no exclude at all
		const filtered = discovered.filter(uri => !this.isExcludedByIntegrationFilter(uri.path));
		// deterministic order so the capped subset is stable across reloads
		const sorted_uris = [...filtered].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
		// stored on the session so later watcher-driven incremental updates re-send the same totals
		this.integration_total_discovered = sorted_uris.length;
		this.integration_truncated = sorted_uris.length > MAX_AGGREGATE_FILES;
		const uris = sorted_uris.slice(0, MAX_AGGREGATE_FILES);
		debug('setIntegration folder: %d discovered, loading %d (cap %d, truncated=%s) in %s', this.integration_total_discovered, uris.length, MAX_AGGREGATE_FILES, this.integration_truncated, folder_path);
		if (this.integration_truncated) {
			writeToLog('discoverFolderDocs', `cap hit: discovered ${this.integration_total_discovered}, loading first ${MAX_AGGREGATE_FILES} of ${folder_path}`);
		}
		const cache_hit = await this.discoveredSetMatchesCache(uris, previous_docs);
		if (cache_hit) {
			debug('setIntegration folder: fast-path - discovered set matches cached docs, skipping reload');
			// restores integration_docs, cleared by enterFolderMode before discovery, so the payload carries the cached map
			for (const [id, doc] of Object.entries(previous_docs)) { this.integration_docs[id] = doc; }
			this.sendAggregatePayload();
			return;
		}
		// only when there is actual loading to do, so the spinner never flashes on a no-op breadcrumb click
		this.sendPendingChange('folderDiscovery', true);
		// the arrow wrapper isolates loadFolderDoc from .map's (value, index, array) trio
		const load_promises = uris.map(uri => this.loadFolderDoc(uri, { batched: true }));
		Promise.allSettled(load_promises).then(() => {
			debug('setIntegration folder: load complete, %d docs', Object.keys(this.integration_docs).length);
			// flushes whatever the last interval left queued before the canonical map lands
			this.flushDiscoveryBatch();
			this.sendAggregatePayload();
			this.sendPendingChange('folderDiscovery', false);
		});
	}

	/**
	 * Stats each discovered URI and checks whether the {path, mtime} set exactly matches
	 * the previous integration_docs snapshot. Returns false on any difference (missing,
	 * new, or mtime-changed file) and on any stat failure (treat as "uncertain - reload").
	 */
	private async discoveredSetMatchesCache(uris: vscode.Uri[], previous_docs: HashMapOf<Doc>): Promise<boolean> {
		const cached_entries = Object.values(previous_docs);
		if (cached_entries.length !== uris.length) { return false; }
		const cached_by_path = new Map<string, number | undefined>();
		for (const doc of cached_entries) { cached_by_path.set(doc.path, doc.mtime); }
		for (const uri of uris) {
			const cached_mtime = cached_by_path.get(uri.path);
			if (cached_mtime === undefined) { return false; }
			try {
				const st = await vscode.workspace.fs.stat(uri);
				if (st.mtime !== cached_mtime) { return false; }
			} catch (err) {
				debug('discoveredSetMatchesCache: stat failed for %s: %O', uri.path, err);
				return false;
			}
		}
		return true;
	}

	private sendAggregatePayload(): void {
		this.webviewPanel.webview.postMessage({
			type: 'update',
			partial: { docs: this.integration_docs },
			workspace_root: this.workspace_root,
			workspace_projects: this.workspace_projects,
			extension_version: this.extension_version,
			aggregate_total_discovered: this.integration_total_discovered,
			aggregate_truncated: this.integration_truncated,
			include_filter: this.integration_include,
			exclude_filter: this.integration_exclude,
		});
	}

	private sendPendingChange(key: string, on: boolean): void {
		this.webviewPanel.webview.postMessage({ type: 'pendingChange', key, on });
	}

	/**
	 * Posts one merge update carrying every doc in the map. The discovery batch and the
	 * watcher's single-file path share it, so both ship the same envelope and only the
	 * number of docs per message differs.
	 */
	private sendFolderDocs(docs: HashMapOf<Doc>): void {
		this.webviewPanel.webview.postMessage({
			type: 'update',
			partial: { docs },
			merge_strategy: 'merge',
			workspace_root: this.workspace_root,
			workspace_projects: this.workspace_projects,
			extension_version: this.extension_version,
			aggregate_total_discovered: this.integration_total_discovered,
			aggregate_truncated: this.integration_truncated,
			include_filter: this.integration_include,
			exclude_filter: this.integration_exclude,
		});
	}

	/**
	 * Holds a freshly loaded discovery doc back until the batch is worth posting: DISCOVERY_BATCH_MAX_DOCS
	 * docs, or DISCOVERY_BATCH_FLUSH_MS after the first doc of the batch, whichever comes first. The timer
	 * bound is what keeps a slow folder filling the board progressively rather than in one final reveal.
	 */
	private queueDiscoveryDoc(doc_id: string): void {
		this.discovery_batch.add(doc_id);
		if (this.discovery_batch.size >= DISCOVERY_BATCH_MAX_DOCS) {
			this.flushDiscoveryBatch();
			return;
		}
		if (this.discovery_batch_timer === undefined) {
			this.discovery_batch_timer = setTimeout(() => this.flushDiscoveryBatch(), DISCOVERY_BATCH_FLUSH_MS);
		}
	}

	/**
	 * Posts everything queued as one merge update. A no-op on an empty batch, so every discovery exit can
	 * call it unconditionally.
	 *
	 * Each id is resolved against integration_docs HERE rather than posted from a snapshot taken when it
	 * was queued, because the batch outlives the load: a watcher re-read of the same file, or a delete,
	 * can land in the window before the flush. Posting the queued copy would send the stale version after
	 * the watcher's fresh one, or resurrect a doc a tombstone has already dropped.
	 */
	private flushDiscoveryBatch(): void {
		const batched_ids = [...this.discovery_batch];
		this.discardDiscoveryBatch();
		const docs: HashMapOf<Doc> = {};
		for (const doc_id of batched_ids) {
			const doc = this.integration_docs[doc_id];
			if (doc) { docs[doc_id] = doc; }
		}
		if (Object.keys(docs).length === 0) { return; }
		debug('flushDiscoveryBatch: posting %d docs', Object.keys(docs).length);
		this.sendFolderDocs(docs);
	}

	// drops anything queued without posting; a stale batch could re-introduce docs the new folder never admitted
	private discardDiscoveryBatch(): void {
		if (this.discovery_batch_timer !== undefined) {
			clearTimeout(this.discovery_batch_timer);
			this.discovery_batch_timer = undefined;
		}
		this.discovery_batch.clear();
	}

	/**
	 * Shared per-file loader for both initial discovery and the folder watcher. The watcher path
	 * passes fromDisk=true to re-read raw bytes, since openTextDocument's cache cannot be trusted
	 * to reflect external on-disk edits, and posts its own update at once; discovery passes
	 * batched=true and joins the batch above, so the view fills in progressively but at a bounded
	 * number of board renders.
	 *
	 * The integration-path containment check runs both before and after the async load: a
	 * concurrent enterFolderMode (a pill click descending into a sub-project) can clear
	 * integration_docs and switch integration_path while this awaits, so a late-arriving load from
	 * the old path must be rejected again on return, or a sibling project's docs mysteriously
	 * reappear after an update. isAdmittedByIntegrationFilters alone cannot substitute for the
	 * path check: a sibling's folder-relative `../` path can still match a globstar include.
	 */
	private async loadFolderDoc(uri: vscode.Uri, opts: { fromDisk?: boolean; batched?: boolean } = {}): Promise<void> {
		try {
			// guards against a late-arriving load from a previous integration_path
			if (!this.isWithinIntegrationPath(uri.path)) {
				return;
			}
			// createFileSystemWatcher has no exclude argument, so every entry is gated against both integration filters here
			if (!this.isAdmittedByIntegrationFilters(uri.path)) {
				return;
			}
			// respects the cap for watcher-driven adds too; a re-parse of an already-loaded path still passes
			const already_loaded = Object.values(this.integration_docs).some(d => d.path === uri.path);
			if (!already_loaded && Object.keys(this.integration_docs).length >= MAX_AGGREGATE_FILES) {
				return;
			}
			let doc: Doc;
			if (opts.fromDisk) {
				// nothing is rendering this panel; syncVisibility catches this folder up once it's visible again
				if (!this.webviewPanel.visible) { return; }
				const bytes = await vscode.workspace.fs.readFile(uri);
				const text = new TextDecoder().decode(bytes);
				// hash-gate: onDidCreate and onDidChange can both fire for one save; skip if content hasn't changed
				const cached = Object.values(this.integration_docs).find(d => d.path === uri.path);
				if (cached && cached.hash_sha256 === await generateIdentifier(text)) { return; }
				// passed both integration-path and filter checks to get here, so it is folder-scoped: text only, no parse
				doc = await this.buildDocFromUriAndText(uri, text, 'fsWatcher', true);
			} else {
				// openTextDocument may return editor-buffer content with unsaved edits, which is right for first load
				const document = await vscode.workspace.openTextDocument(uri);
				doc = await this.buildDoc(document, true);
			}
			// re-checked after the async load, since a concurrent enterFolderMode may have switched integration_path meanwhile
			if (!this.isWithinIntegrationPath(uri.path)) {
				return;
			}
			this.integration_docs[doc.id] = { ...doc, updateSentAt: new Date().toISOString() };
			if (opts.batched) {
				this.queueDiscoveryDoc(doc.id);
				return;
			}
			this.sendFolderDocs({ [doc.id]: this.integration_docs[doc.id] });
		} catch (err) {
			this.logUnlessStale('loadFolderDoc', `failed to load ${uri.path}`, err);
		}
	}

	// phase 2: a watcher failure must not abort folder entry, since discovery already populated the view
	private armFolderWatcher(pattern: vscode.RelativePattern): void {
		try {
			this.integration_watcher = vscode.workspace.createFileSystemWatcher(pattern);
			// fromDisk: true bypasses openTextDocument's stale cache (the entire reason the watcher exists)
			this.integration_watcher.onDidCreate(uri => this.loadFolderDoc(uri, { fromDisk: true }));
			this.integration_watcher.onDidChange(uri => this.loadFolderDoc(uri, { fromDisk: true }));
			this.integration_watcher.onDidDelete(uri => this.handleFolderDocDeleted(uri));
		} catch (err) {
			this.integration_watcher = undefined;
			writeToErrorLog('armFolderWatcher', `watcher unavailable (static provider?), continuing without live updates for ${pattern.pattern}`, err);
		}
	}

	private async handleFolderDocDeleted(uri: vscode.Uri): Promise<void> {
		try {
			const id = await generateIdentifier(uri.path);
			if (this.integration_docs[id]) {
				delete this.integration_docs[id];
				// signal the webview to drop this doc - convention: send tombstone with empty content
				this.webviewPanel.webview.postMessage({ type: 'docDeleted', docId: id, docPath: uri.path });
			}
		} catch (err) {
			writeToErrorLog('handleFolderDocDeleted', `failed to drop deleted doc ${uri.path}`, err);
		}
	}

	private async enterCurrentFileMode(target_path?: string): Promise<void> {
		// switching back to single-file mode - tear down any active watcher
		if (this.integration_watcher) {
			this.integration_watcher.dispose();
			this.integration_watcher = undefined;
		}
		this.integration_path = undefined;
		this.integration_include = DEFAULT_INCLUDE_FILTER;
		this.integration_exclude = DEFAULT_EXCLUDE_FILTER;
		for (const key of Object.keys(this.integration_docs)) { delete this.integration_docs[key]; }
		// a queued flush would post folder docs as a merge after the replace below has already pruned them
		this.discardDiscoveryBatch();
		// re-resolves the active editor, since it may have changed while in folder mode, and re-sends just that file
		try {
			// a Files-drawer click opens and focuses the target file first, so it becomes the active editor this renders
			if (target_path && isWithinWorkspace(target_path, { requireExtension: '.md' })) {
				await this.revealByOpening(target_path, 0, 0, true);
			}
			const current_editor = vscode.window.activeTextEditor;
			if (current_editor?.document.uri.path.endsWith('.md') && current_editor.document.uri.path !== this.active_path) {
				// switching TO current_file mode just cleared integration_path - never folder-scoped
				this.active_doc = await this.buildDoc(current_editor.document, false);
				this.active_path = current_editor.document.uri.path;
			}
			if (this.active_doc) {
				this.sendDoc(this.active_doc);
				this.sendCurrentSelection();
			}
		} catch (err) {
			this.logUnlessStale('enterCurrentFileMode', 'failed to enter current-file mode', err);
		}
	}

	// --- breadcrumb jump drawer ---

	/**
	 * Lists jump targets for the breadcrumb's terminal segment: child folders in folder
	 * mode, sibling .md files in current_file mode. Validates the untrusted path before
	 * touching the filesystem, then posts the sorted entries back to the webview.
	 */
	private async handleRequestJumpTargets(e: Record<string, unknown>): Promise<void> {
		const mode = e.mode as string;
		const jump_path = e.path as string;
		try {
			if (mode === INTEGRATION_MODE_FOLDER) {
				if (!isWithinWorkspace(jump_path)) {
					writeToLogAtLevel('error', 'handleRequestJumpTargets', `folder outside workspace, refusing ${jump_path}`);
					return;
				}
				const entries = await this.listChildFolders(jump_path);
				this.webviewPanel.webview.postMessage({ type: 'jumpTargets', mode, path: jump_path, entries });
			} else if (mode === INTEGRATION_MODE_CURRENT_FILE) {
				if (!isWithinWorkspace(jump_path, { requireExtension: '.md' })) {
					writeToLogAtLevel('error', 'handleRequestJumpTargets', `file outside workspace, refusing ${jump_path}`);
					return;
				}
				const entries = await this.listSiblingMdFiles(jump_path);
				this.webviewPanel.webview.postMessage({ type: 'jumpTargets', mode, path: jump_path, entries });
			}
		} catch (err) {
			writeToErrorLog('handleRequestJumpTargets', `failed to list jump targets for ${jump_path}`, err);
		}
	}

	// immediate child folders of base_path, dropping exclude-filtered ones, sorted by label
	private async listChildFolders(base_path: string): Promise<Array<{ label: string; path: string; kind: 'folder' }>> {
		const dir_entries = await vscode.workspace.fs.readDirectory(this.resolveWorkspaceUri(base_path));
		const dir_names = dir_entries
			.filter(([, type]) => type === vscode.FileType.Directory)
			.map(([name]) => name);
		const filtered = dir_names.filter(name => !this.isExcludedDirectory(path.posix.join(base_path, name)));
		return filtered
			.sort()
			.map(name => ({ label: name, path: path.posix.join(base_path, name), kind: 'folder' as const }));
	}

	// enumerate sibling .md files of file_path (excluding the file itself), sorted by label
	private async listSiblingMdFiles(file_path: string): Promise<Array<{ label: string; path: string; kind: 'file' }>> {
		const dir = path.posix.dirname(file_path);
		const self_name = path.posix.basename(file_path);
		const dir_entries = await vscode.workspace.fs.readDirectory(this.resolveWorkspaceUri(dir));
		const file_names = dir_entries
			.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md') && name !== self_name)
			.map(([name]) => name);
		return file_names
			.sort()
			.map(name => ({ label: name, path: path.posix.join(dir, name), kind: 'file' as const }));
	}

	/**
	 * Opens a sibling .md file picked from the jump drawer. Routes through revealByOpening
	 * (not handleRevealRange, which stays silent in current_file mode) so the file opens in
	 * a column beside the panel and takes focus.
	 */
	private async handleOpenFile(e: Record<string, unknown>): Promise<void> {
		const file_path = e.path as string;
		try {
			if (!isWithinWorkspace(file_path, { requireExtension: '.md' })) {
				writeToLogAtLevel('error', 'handleOpenFile', `path outside workspace, refusing ${file_path}`);
				return;
			}
			await this.revealByOpening(file_path, 0, 0, true);
		} catch (err) {
			writeToErrorLog('handleOpenFile', `failed to open ${file_path}`, err);
		}
	}

	/**
	 * Dispatches on shape: `changes_by_doc` (multi-doc folder-mode batch, one entry
	 * per file) vs `docPath`+`changes` (single-doc back-compat). Both route per-doc
	 * work through `applyEditTextToDoc`; the batch path applies sequentially so
	 * concurrent applyEdit calls do not race on change_timer / active state. A single
	 * bad doc in a batch is logged and skipped - the remaining docs still apply.
	 */
	private async handleEditText(e: Record<string, unknown>): Promise<void> {
		const changes_by_doc = e.changes_by_doc as Record<string, Array<TextChange>> | undefined;
		if (changes_by_doc && typeof changes_by_doc === 'object') {
			for (const [doc_path, changes] of Object.entries(changes_by_doc)) {
				await this.applyEditTextToDoc(doc_path, changes);
			}
		} else {
			await this.applyEditTextToDoc(e.docPath as string, e.changes as Array<TextChange>);
		}
		// clear the debounce timer the edits set, so the batch doesn't re-emit a delayed update
		if (this.change_timer) { clearTimeout(this.change_timer); this.change_timer = undefined; }
	}

	private async applyEditTextToDoc(doc_path: string, changes: Array<TextChange>): Promise<void> {
		try {
			// webview-supplied paths are untrusted: only allow edits to .md files inside the workspace
			if (!doc_path || !isWithinWorkspace(doc_path, { requireExtension: '.md' })) {
				writeToLogAtLevel('error', 'applyEditTextToDoc', `path outside workspace, refusing ${doc_path}`);
				return;
			}
			if (!Array.isArray(changes) || changes.length === 0) {
				writeToLogAtLevel('error', 'applyEditTextToDoc', `no changes supplied for ${doc_path}, skipping`);
				return;
			}
			const uri = this.resolveWorkspaceUri(doc_path);
			const document = await vscode.workspace.openTextDocument(uri);
			const invalid = firstInvalidChange(changes, document.getText().length);
			if (invalid) {
				writeToLogAtLevel('error', 'applyEditTextToDoc',
					`invalid offsets, skipping: from=${invalid.from} to=${invalid.to ?? invalid.from} len=${document.getText().length} insert="${invalid.insert}" doc=${doc_path}`);
				return;
			}
			logEditTextChanges(document, doc_path, changes);
			await applyEditTextChanges(document, uri, changes);
			// a view-driven edit can target a file already inside the folder integration, which takes the same diet
			const edited_doc = await this.buildDoc(document, this.isFolderScoped(document.uri.path));
			if (document.uri.path === this.active_path) {
				this.active_doc = edited_doc;
				this.sendDoc(this.active_doc);
				this.sendCurrentSelection();
			} else {
				// folder/background edit: route through sendDoc so the merge strategy applies
				this.sendDoc(edited_doc);
			}
		} catch (err) {
			this.logUnlessStale('applyEditTextToDoc', `failed to apply changes to ${doc_path}`, err);
		}
	}

	private async handleOpenExternal(e: Record<string, unknown>): Promise<void> {
		const url = e.url as string;
		if (!url) { return; }
		try {
			// host-side scheme allow-list: only open http/https/mailto, refuse everything else (file:, vscode:, etc.)
			const parsed = vscode.Uri.parse(url);
			if (!(ALLOWED_EXTERNAL_SCHEMES as readonly string[]).includes(parsed.scheme.toLowerCase())) {
				writeToLogAtLevel('error', 'handleOpenExternal', `refused scheme for ${url}`);
				return;
			}
			await vscode.env.openExternal(parsed);
		} catch (err) {
			writeToErrorLog('handleOpenExternal', `failed to open ${url}`, err);
		}
	}

	/**
	 * Opens a relative .md link clicked in the rendered view, resolved against the ACTIVE
	 * document's URI so the workspace scheme/authority is preserved (works on non-file:
	 * hosts). The fragment/query is stripped before joining; the resolved target must stay
	 * within the workspace (scheme-safe uri.path containment) and end in .md - `..`-escape
	 * and non-.md links are refused. The viewer auto-follows via onDidChangeActiveTextEditor.
	 */
	private async handleOpenRelative(e: Record<string, unknown>): Promise<void> {
		const href = e.href as string;
		try {
			if (!href || !this.active_path || !this.workspace_root) { return; }
			const target = this.resolveRelativeTarget(href);
			if (!target) { return; }
			if (!isPathWithin(target.path, [this.workspace_root], { requireExtension: '.md' })) {
				writeToLogAtLevel('error', 'handleOpenRelative', `target outside workspace or not .md, refusing ${target.path}`);
				return;
			}
			await this.revealByOpening(target, 0, 0, true);
		} catch (err) {
			writeToErrorLog('handleOpenRelative', `failed to open relative link ${href}`, err);
		}
	}

	/**
	 * Resolves href against the active doc's URI, preserving scheme/authority. Strips any
	 * #fragment / ?query before joining so the on-disk path is clean. Returns undefined when there
	 * is no active doc to anchor against.
	 */
	private resolveRelativeTarget(href: string): vscode.Uri | undefined {
		if (!this.active_path) { return undefined; }
		const clean_href = decodeURIComponent(href.split('#')[0].split('?')[0]);
		if (clean_href === '') { return undefined; }
		const active_uri = this.resolveWorkspaceUri(this.active_path);
		const base = vscode.Uri.joinPath(active_uri, '..');
		return vscode.Uri.joinPath(base, clean_href);
	}
}

import * as path from 'path';
import * as vscode from 'vscode';
import { MAX_AGGREGATE_FILES, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, NOTETHINK_VIEW_TYPE } from '../constants';
import { generateIdentifier } from '../lib/cryptoops';
import { type TextChange, firstInvalidChange, logEditTextChanges, offsetDeltaBefore } from '../lib/editops';
import { debug, writeToLog, writeToErrorLog } from '../lib/errorops';
import { globMatches } from '../lib/globMatch';
import { parse } from '../lib/parseops';
import { isPathWithin, isWithinWorkspace } from '../lib/pathops';
import { SETTINGS, type SettingKey, isSettingKey, readSetting, writeSetting, hasWorkspaceOverride, hasOverride, cascadeKeys, buildSettingsCascadePayload } from '../lib/settings';
import type { HashMapOf, Doc } from '../types/general';

const CHANGE_DEBOUNCE_MS = 250;
const SELECTION_DEBOUNCE_MS = 120;
const ALLOWED_EXTERNAL_SCHEMES = ['http', 'https', 'mailto'] as const;
// upper bound on directories visited by the non-file: scheme readDirectory walk, so a symlink cycle or pathological provider can't loop forever
const MAX_WALK_ENTRIES = 5000;
// synthetic child filename used to ask an exclude glob "would you drop everything inside this directory?"; the globs end in /** so they only ever match a file path, never a bare directory
const EXCLUDE_PROBE_FILE = '__probe__.md';
/*
 * last-resort scheme carrier for a session with neither a document nor a workspace folder to borrow one from
 * unreachable through the three real entry points (the custom editor and the deserializer always carry a document; the openViewer command refuses when there is no document AND no folder), and inert if ever reached: every path that consumes base_uri sits behind isWithinWorkspace, which fails closed with no workspace folders
 */
const INERT_BASE_URI = vscode.Uri.file('/');

/**
 * apply changes to a document end-to-start so earlier offsets stay valid. Prefers an
 * already-visible editor (never spawns one); otherwise applies a WorkspaceEdit. The
 * caller must validate offsets first.
 */
async function applyEditTextChanges(document: vscode.TextDocument, uri: vscode.Uri, changes: Array<TextChange>): Promise<void> {
	const sorted_changes = [...changes].sort((a, b) => b.from - a.from);
	const existing = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === uri.path);
	if (existing) {
		/*
		 * capture the caret before the edit: VS Code drops the cursor at the last edited range, so a multi-edit (a kanban reorder's weight cascade) would yank it onto another note and the view's editor-derived focus would follow
		 * restore it afterwards, shifted only by edits that landed before it, so a view-driven edit leaves the caret put
		 */
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
 */
export class PanelSession {
	private active_doc: Doc | undefined;
	private active_path: string | undefined;
	private integration_watcher: vscode.FileSystemWatcher | undefined;
	private integration_path: string | undefined;
	// editable folder filters, persisted per-view by the webview and replayed on reload; survive a breadcrumb re-narrow (only overwritten when the setIntegration message explicitly carries them)
	private integration_include = DEFAULT_INCLUDE_FILTER;
	private integration_exclude = DEFAULT_EXCLUDE_FILTER;
	private readonly integration_docs: HashMapOf<Doc> = {};
	// folder-size metadata from the latest discovery, surfaced to the webview so the breadcrumb can show "(loaded of discovered)"; watcher-driven incremental updates re-send these so the count doesn't reset to zero
	private integration_total_discovered = 0;
	private integration_truncated = false;
	private workspace_projects: string[] = [];
	// in single-file mode, onDidChangeTextDocument only fires for editor-open docs; this watcher refreshes the viewer when the shown file is edited externally with no visible editor backing it
	private active_file_watcher: vscode.FileSystemWatcher | undefined;
	private change_timer: ReturnType<typeof setTimeout> | undefined;
	private selection_timer: ReturnType<typeof setTimeout> | undefined;
	private readonly workspace_root: string;
	// scheme+authority carrier for every folder-mode and open-by-path URI; preserves the real workspace scheme (file:, vscode-vfs:, notegit:, …) so discovery and opens work on non-file: hosts
	private readonly base_uri: vscode.Uri;
	private readonly extension_version: string;

	constructor(
		private readonly webviewPanel: vscode.WebviewPanel,
		private readonly initialDocument: vscode.TextDocument | undefined,
		private readonly context: vscode.ExtensionContext,
		private readonly getHtml: (webview: vscode.Webview) => string,
		private readonly onActivate: (panel: vscode.WebviewPanel) => void,
		private readonly onDispose: (panel: vscode.WebviewPanel) => void,
	) {
		// resolve workspace root for breadcrumb display; asRelativePath/getWorkspaceFolder handle symlinks and may return undefined in web hosts
		const workspace_folder = (initialDocument ? vscode.workspace.getWorkspaceFolder(initialDocument.uri) : undefined)
			|| vscode.workspace.workspaceFolders?.[0];
		this.workspace_root = workspace_folder?.uri.path || '';
		// prefer the workspace folder's URI as the scheme carrier; fall back to the active doc's URI when no folder is open (single loose file)
		this.base_uri = workspace_folder?.uri ?? initialDocument?.uri ?? INERT_BASE_URI;
		this.extension_version = this.context.extension.packageJSON.version as string || '';
	}

	// rebuild an absolute-path string into a URI that carries the workspace scheme + authority, so folder-mode discovery and opens never assume file:
	private resolveWorkspaceUri(absolute_path: string): vscode.Uri {
		return this.base_uri.with({ path: absolute_path });
	}

	/**
	 * wire the panel: install the webview HTML, build the initial doc, arm the
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
		});
		this.webviewPanel.webview.options = { enableScripts: true };
		this.webviewPanel.webview.html = this.getHtml(this.webviewPanel.webview);
		if (this.initialDocument) { await this.buildInitialDoc(this.initialDocument); }
		this.registerListeners();
	}

	// --- doc construction and dispatch ---

	/**
	 * build a Doc from a URI + raw text. Use when responding to disk-change events:
	 * openTextDocument's TextDocument cache is not refreshed on external on-disk edits
	 * for files not bound to a visible editor, so document.getText() returns stale
	 * content. Reading the bytes directly bypasses the cache.
	 */
	private async buildDocFromUriAndText(uri: vscode.Uri, text: string, created_by: string): Promise<Doc> {
		const mdast = parse(text);
		const relative = vscode.workspace.asRelativePath(uri, false);
		// on-disk mtime drives the in-band relevance order on the webview side; tolerate a missing stat so we still ship a parsed Doc
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

	private async buildDoc(document: vscode.TextDocument): Promise<Doc> {
		return this.buildDocFromUriAndText(document.uri, document.getText(), 'activeEditor');
	}

	private sendDoc(doc: Doc): void {
		const timestamped = { ...doc, updateSentAt: new Date().toISOString() };
		debug('sendDoc %s', doc.path);
		// in folder mode only docs inside integration_path go into the merged view; the active editor's out-of-scope doc is still surfaced via sendActiveEditorDoc so the webview's auto-integration reconcile can follow the editor out of the folder, and selection updates flow through sendSelection separately
		if (this.integration_path && !this.isWithinIntegrationPath(doc.path)) {
			debug('sendDoc: skipping out-of-integration doc %s', doc.path);
			if (doc.path === this.active_path) { this.sendActiveEditorDoc(timestamped); }
			return;
		}
		// in-memory edits to integration docs must merge into the existing map; otherwise the replace-strategy default would wipe every other file
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

	// surface the active editor's doc to the webview WITHOUT merging it into the folder aggregate. in folder mode sendDoc drops out-of-scope docs, which would otherwise leave the webview blind to an active editor outside the folder, so its auto-integration reconcile could never follow the editor out of the folder and exit to current_file. the in-scope active doc still arrives through sendDoc's merge path; this channel carries only the out-of-scope case
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

	// signal the webview that no real editor owns this doc's caret; it clears props.selection so the board's virtual caret drives highlight/select
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
			// no visible editor owns this doc, so there is no real editor caret; clear the selection so the board becomes the caret owner (virtual-caret path) instead of pinning a phantom caret at offset 0
			this.sendSelectionCleared(this.active_path);
		}
	}

	/**
	 * build the initial active doc but defer pushing it to the webview until
	 * requestInitialState arrives - the webview sends setIntegration first on reload,
	 * so by then integration_path is set and the merge path runs instead of wiping the
	 * saved folder docs map.
	 */
	private async buildInitialDoc(initialDocument: vscode.TextDocument): Promise<void> {
		this.active_path = initialDocument.uri.path;
		try {
			this.active_doc = await this.buildDoc(initialDocument);
		} catch (err) {
			writeToErrorLog('failed to build initial document', initialDocument.uri.path, err);
		}
		this.syncActiveFileWatcher();
	}

	// --- active-file watcher ---

	/**
	 * idempotent: tear any existing watcher down, then re-arm if the active file
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
		// a visible text editor already drives onDidChangeTextDocument for on-disk changes; we only fill the gap when there's no editor
		const visible = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === this.active_path);
		if (visible) { return; }
		this.armActiveFileWatcher();
	}

	private armActiveFileWatcher(): void {
		try {
			// active_path is a uri.path (always POSIX); use path.posix so the watcher folder/filename split stays scheme-safe on non-file: hosts
			const folder = path.posix.dirname(this.active_path!);
			const filename = path.posix.basename(this.active_path!);
			const pattern = new vscode.RelativePattern(this.resolveWorkspaceUri(folder), filename);
			this.active_file_watcher = vscode.workspace.createFileSystemWatcher(pattern);
			const onChange = async (changed_uri: vscode.Uri): Promise<void> => {
				if (changed_uri.path !== this.active_path) { return; }
				try {
					// fs.readFile bypasses the TextDocument cache: openTextDocument would return stale content for files not bound to a visible editor
					const bytes = await vscode.workspace.fs.readFile(changed_uri);
					const text = new TextDecoder().decode(bytes);
					this.active_doc = await this.buildDocFromUriAndText(changed_uri, text, 'fsWatcher');
					this.sendDoc(this.active_doc);
				} catch (err) {
					writeToErrorLog('active-file watcher: re-parse failed', changed_uri.path, err);
				}
			};
			this.active_file_watcher.onDidChange(onChange);
			this.active_file_watcher.onDidCreate(onChange);
			debug('active-file watcher armed for %s', this.active_path);
		} catch (err) {
			writeToErrorLog('syncActiveFileWatcher: failed to create watcher', this.active_path, err);
		}
	}

	// --- settings ---

	private readGlobalSettings(): { showLineNumbers: boolean; watchUnopenedFilesInViewer: boolean; kanbanAnimateTransitions: boolean; openNewEditorIfNoneOpen: boolean } {
		return {
			showLineNumbers: readSetting('showLineNumbers'),
			watchUnopenedFilesInViewer: readSetting('watchUnopenedFilesInViewer'),
			kanbanAnimateTransitions: readSetting('kanbanAnimateTransitions'),
			openNewEditorIfNoneOpen: readSetting('openNewEditorIfNoneOpen'),
		};
	}

	private sendGlobalSettings(): void {
		this.webviewPanel.webview.postMessage({ type: 'globalSettings', settings: this.readGlobalSettings() });
	}

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
			if (this.integration_watcher) { this.integration_watcher.dispose(); this.integration_watcher = undefined; }
			if (this.active_file_watcher) { this.active_file_watcher.dispose(); this.active_file_watcher = undefined; }
			changeDocumentSubscription.dispose();
			activeEditorSubscription.dispose();
			visibleEditorsSubscription.dispose();
			selectionSubscription.dispose();
			configSubscription.dispose();
		});
	}

	// debounce change handler - only re-parse the active document
	private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
		if (e.document.uri.path !== this.active_path) { return; }
		if (this.change_timer) { clearTimeout(this.change_timer); }
		this.change_timer = setTimeout(async () => {
			this.change_timer = undefined;
			try {
				this.active_doc = await this.buildDoc(e.document);
				this.sendDoc(this.active_doc);
				// send selection after doc update so the webview never has stale MDAST with fresh caret
				this.sendCurrentSelection();
			} catch (err) {
				writeToErrorLog('failed to process document change', e.document.uri.path, err);
			}
		}, CHANGE_DEBOUNCE_MS);
	}

	// switch displayed document when the user switches to a different .md editor
	private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
		if (!editor || !editor.document.uri.path.endsWith('.md')) { return; }
		if (editor.document.uri.path === this.active_path) { return; }
		try {
			this.active_doc = await this.buildDoc(editor.document);
			this.active_path = editor.document.uri.path;
			this.sendDoc(this.active_doc);
			const head = editor.document.offsetAt(editor.selection.active);
			const anchor = editor.document.offsetAt(editor.selection.anchor);
			this.sendSelection(this.active_path, head, anchor);
			this.syncActiveFileWatcher();
		} catch (err) {
			writeToErrorLog('failed to switch active document', editor?.document.uri.path, err);
		}
	}

	private onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent): void {
		if (e.affectsConfiguration('notethink.settings.view.generic.showLineNumbers')) {
			this.sendGlobalSettings();
		}
		if (e.affectsConfiguration('notethink.settings.view.generic.watchUnopenedFilesInViewer')) {
			this.sendGlobalSettings();
			this.syncActiveFileWatcher();
		}
		if (e.affectsConfiguration('notethink.settings.view.specific.kanban.animateTransitions')) {
			this.sendGlobalSettings();
		}
		if (e.affectsConfiguration('notethink.settings.view.generic.openNewEditorIfNoneOpen')) {
			this.sendGlobalSettings();
		}
		// catch-all for any cascade setting change (covers the two above and the cascade keys)
		if (e.affectsConfiguration('notethink.settings')) {
			this.sendSettingsCascade();
		}
		// folder-mode filter settings changed in workspace/user config (e.g. user edited settings.json directly): re-discover so the new filters take effect immediately. without this the panel's in-memory integration_include / integration_exclude stays at the value set during the last enterFolderMode call, and added exclude tokens like "vendored" silently never apply
		const filter_settings_changed =
			e.affectsConfiguration('notethink.settings.files.includeFilter') ||
			e.affectsConfiguration('notethink.settings.files.excludeFilter');
		if (filter_settings_changed && this.integration_path) {
			void this.enterFolderMode(this.integration_path, {}).catch(err =>
				writeToErrorLog('re-enter folder mode on filter change failed', this.integration_path ?? '', err)
			);
		}
	}

	// track text editor selection changes - debounced to avoid flooding the webview
	private onDidChangeTextEditorSelection(e: vscode.TextEditorSelectionChangeEvent): void {
		if (e.textEditor.document.uri.path !== this.active_path) { return; }
		// suppress selection while a document change is pending - the change handler sends selection after re-parse to keep MDAST and caret in sync
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

	// e is the untyped webview message envelope vscode's onDidReceiveMessage delivers; each handler narrows the fields it reads
	private async handleMessage(e: Record<string, unknown>): Promise<void> {
		debug('onDidReceiveMessage', e.type);
		try {
			switch (e.type) {
				case 'requestInitialState': return this.handleRequestInitialState();
				case 'updateGlobalSetting': return this.handleUpdateGlobalSetting(e);
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
				case 'renderError':
					writeToErrorLog('webview render error', e.message as string, e.stack as string);
					return;
			}
		} catch (err) {
			writeToErrorLog('onDidReceiveMessage failed', e?.type, err);
		}
	}

	private async handleRequestInitialState(): Promise<void> {
		try {
			// after a window reload VS Code may restore editors in unpredictable order, so re-check the active .md file
			const current_editor = vscode.window.activeTextEditor;
			if (current_editor?.document.uri.path.endsWith('.md') && current_editor.document.uri.path !== this.active_path) {
				this.active_doc = await this.buildDoc(current_editor.document);
				this.active_path = current_editor.document.uri.path;
			}
			if (this.active_doc) {
				this.sendDoc(this.active_doc);
				this.sendCurrentSelection();
			}
			this.sendGlobalSettings();
			this.sendSettingsCascade();
			this.syncActiveFileWatcher();
			await this.openFolderAtWorkspaceRootIfDocless();
		} catch (err) {
			writeToErrorLog('requestInitialState failed', '', err);
		}
	}

	/**
	 * a docless session (openViewer with no active .md editor) has no file to render, so the board
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
	 * tell the webview to scope its own folder view state to this path. The webview decides
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

	// per-setting storage target preference for the non-cascade globals: showLineNumbers persists per-workspace; the rest are personal preferences that follow the user across projects (matching each key's window/resource scope in package.json)
	private readonly GLOBAL_SETTING_TARGETS: Partial<Record<SettingKey, vscode.ConfigurationTarget>> = {
		showLineNumbers: vscode.ConfigurationTarget.Workspace,
		watchUnopenedFilesInViewer: vscode.ConfigurationTarget.Global,
		kanbanAnimateTransitions: vscode.ConfigurationTarget.Global,
		openNewEditorIfNoneOpen: vscode.ConfigurationTarget.Global,
	};

	private async handleUpdateGlobalSetting(e: Record<string, unknown>): Promise<void> {
		const setting = e.setting as unknown;
		const value = e.value as unknown;
		try {
			if (!isSettingKey(setting) || SETTINGS[setting].inCascade) {
				writeToErrorLog('updateGlobalSetting: unknown or not-global setting', String(setting));
				return;
			}
			const target = this.GLOBAL_SETTING_TARGETS[setting];
			if (!target) {
				writeToErrorLog('updateGlobalSetting: no per-setting target configured', setting);
				return;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- writeSetting's generic narrows on the key; the value's union widens to unknown at this boundary because e.value is untyped
			await writeSetting(setting, value as any, target);
		} catch (err) {
			writeToErrorLog('updateGlobalSetting failed', String(setting), err);
		}
	}

	private async handleUpdateSetting(e: Record<string, unknown>): Promise<void> {
		// scope defaults to workspace so user edits stay local; promote-to-default uses scope='global'
		const setting = e.setting as unknown;
		const value = e.value as unknown;
		const scope = (e.scope as 'workspace' | 'global' | undefined) ?? 'workspace';
		try {
			if (!isSettingKey(setting) || !SETTINGS[setting].inCascade) {
				writeToErrorLog('updateSetting: unknown or not-cascade setting', String(setting));
				return;
			}
			const target = scope === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- value's union widens to unknown at the wire boundary
			await writeSetting(setting, value as any, target);
		} catch (err) {
			writeToErrorLog('updateSetting failed', String(setting), err);
		}
	}

	private async handlePromoteSettings(): Promise<void> {
		// snapshot every currently-resolved cascade value first (workspace may shadow user), promote each to Global, then clear Workspace so the cascade reads from User next time
		try {
			const keys = cascadeKeys();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-key value types are heterogeneous; the snapshot is opaque
			const resolved: Record<string, any> = {};
			for (const key of keys) {
				resolved[key] = readSetting(key);
			}
			for (const key of keys) {
				await writeSetting(key, resolved[key], vscode.ConfigurationTarget.Global);
			}
			for (const key of keys) {
				if (hasWorkspaceOverride(key)) {
					await writeSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
				}
			}
		} catch (err) {
			writeToErrorLog('promoteSettingsToUser failed', '', err);
		}
	}

	private async handleResetSettings(): Promise<void> {
		// clear every Workspace-scope cascade override so the cascade falls back to User then built-in
		try {
			for (const key of cascadeKeys()) {
				if (hasWorkspaceOverride(key)) {
					await writeSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
				}
			}
		} catch (err) {
			writeToErrorLog('resetSettingsToDefault failed', '', err);
		}
	}

	private async handleRestoreBuiltinDefaults(): Promise<void> {
		// clear both Workspace- and User-scope cascade overrides so every cascade setting falls back to the built-in (package.json) default. The recovery path when even the user default has been edited away (e.g. a wiped exclude filter) - "Reset to user default" cannot help once the user default itself is gone
		try {
			for (const key of cascadeKeys()) {
				if (!hasOverride(key)) { continue; }
				await writeSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
				await writeSetting(key, undefined, vscode.ConfigurationTarget.Global);
			}
		} catch (err) {
			writeToErrorLog('restoreSettingsToBuiltinDefault failed', '', err);
		}
	}

	// a reveal target is allowed if it sits inside an open workspace folder, or it is the board's own trusted current file. the second case covers single-file mode in a folderless window (File > Open a loose .md), where workspaceFolders is empty and isWithinWorkspace fails closed, silently killing every click. active_path is only ever set from real opened documents, never from a webview message, so an attacker-supplied path that is not the board's own file is still refused
	private isRevealTargetAllowed(doc_path: string): boolean {
		if (isWithinWorkspace(doc_path, { requireExtension: '.md' })) { return true; }
		return doc_path === this.active_path && doc_path.toLowerCase().endsWith('.md');
	}

	private async handleRevealRange(e: Record<string, unknown>): Promise<void> {
		const doc_path = e.docPath as string;
		const from = e.from as number;
		const to = (e.to ?? e.from) as number;
		try {
			if (!doc_path) { return; }
			// gate both the visible-editor fast path and the openTextDocument path: webview-supplied paths are untrusted
			if (!this.isRevealTargetAllowed(doc_path)) {
				writeToErrorLog(`${e.type}: path outside workspace, refusing`, doc_path);
				return;
			}
			// switching to the editor on click is hardcoded on: focus transfers with the caret under the single-caret model. the switch_editor parameter stays plumbed through so a passive-mirror mode is a one-line reintroduction later
			const switch_editor = true;
			// an already-visible editor always gets its caret moved and focus transfers to it (folder-mode option (i): file already has a visible editor)
			if (this.revealInVisibleEditor(doc_path, from, to, switch_editor)) { return; }
			// folder-mode option (ii): the file has no visible editor, so revealByOpening switches an existing non-board editor group to it (reusing that group), and spawns a new beside group when openNewEditorIfNoneOpen is set OR the click forced it (ctrl/cmd-click). it never yanks a file that already has a visible editor - revealInVisibleEditor handled that above. findColumnWithDoc skips our own board tab so a single-file reveal never replaces the board with a plain text editor
			const force_open = e.forceOpen === true;
			await this.revealByOpening(doc_path, from, to, force_open || readSetting('openNewEditorIfNoneOpen'));
		} catch (err) {
			writeToErrorLog(`${e.type} failed`, doc_path, err);
		}
	}

	// reveal/select in a visible editor without opening anything; always moves the caret, and steals focus only when switch_editor is set; returns true if handled
	private revealInVisibleEditor(doc_path: string, from: number, to: number, switch_editor: boolean): boolean {
		const existing = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === doc_path);
		if (!existing) { return false; }
		const document = existing.document;
		const start_pos = document.positionAt(from);
		const end_pos = document.positionAt(to);
		// keep active at `from` so the head reported back via selectionChanged stays at the note's start offset rather than overshooting past end_body
		existing.selection = (from === to)
			? new vscode.Selection(start_pos, end_pos)
			: new vscode.Selection(end_pos, start_pos);
		existing.revealRange(new vscode.Range(start_pos, end_pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		// only pull focus into the editor when switching is enabled; otherwise the caret moves but the view keeps focus
		if (switch_editor) {
			vscode.window.showTextDocument(existing.document, existing.viewColumn, false);
		}
		return true;
	}

	// open the doc in a column that isn't this NoteThink panel's, preferring a group that already has it open. When the board is the only group open, a new beside-group is created only if open_new_if_none is set. Accepts a resolved URI (scheme-preserving) or an absolute path (rebuilt via the workspace scheme carrier)
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
				// the board is the only editor group open; only spawn a new beside group when openNewEditorIfNoneOpen is set (off by default)
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
					// skip our own NoteThink board tabs: in single-file mode the clicked note's doc_path equals the board's file, and revealing into the board's own column would replace the rendered view with a plain text editor
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
			// validate before any teardown so a poisoned path can't dismantle a legitimate integration (folder, so no extension requirement)
			if (!isWithinWorkspace(folder_path)) {
				writeToErrorLog('setIntegration: folder outside workspace, refusing', folder_path);
				return;
			}
			await this.enterFolderMode(folder_path, e);
		} else if (mode === INTEGRATION_MODE_CURRENT_FILE) {
			// optional path targets a specific file (Files-drawer click); undefined keeps the active editor
			await this.enterCurrentFileMode(typeof e.path === 'string' ? e.path : undefined);
		}
		// folder mode: integration_path is now set so this disposes any active-file watcher; current_file mode: it arms one if the active file has no visible editor
		this.syncActiveFileWatcher();
	}

	private async enterFolderMode(folder_path: string, e: Record<string, unknown>): Promise<void> {
		try {
			if (this.integration_watcher) {
				this.integration_watcher.dispose();
				this.integration_watcher = undefined;
			}
			/*
			 * snapshot the previous integration_docs so the fast-path detection in discoverFolderDocs can compare against it
			 * clearing the live cache up front would break that check - preserve the entries until discoverFolderDocs decides whether to keep or replace them
			 */
			const previous_docs = { ...this.integration_docs };
			for (const key of Object.keys(this.integration_docs)) { delete this.integration_docs[key]; }
			this.integration_path = folder_path;
			// resolve filters BEFORE discovery so we never load a wider set than the user actually wants - the workspace cascade is the source of truth, and an explicit message field overrides on top
			this.adoptFolderFilters(e);
			// recompute the workspace project universe AFTER filters are resolved so the exclude pattern is current; webview uses this list to stabilise pill labels + hues across folder descents
			await this.computeWorkspaceProjects();
			const pattern = new vscode.RelativePattern(this.resolveWorkspaceUri(folder_path), this.integration_include);
			await this.discoverFolderDocs(pattern, folder_path, previous_docs);
			this.armFolderWatcher(pattern);
		} catch (err) {
			writeToErrorLog('setIntegration folder failed', folder_path, err);
		}
	}

	// resolve folder-mode filters with cascade precedence: built-in default → User config → Workspace config → explicit message override. The previous behaviour (only adopt explicit fields) left stale defaults in place when transitioning from current_file mode via a breadcrumb click, loading the whole workspace before the user's saved filter was applied
	private adoptFolderFilters(e: Record<string, unknown>): void {
		// cascade as the base; the settings module funnels every read through one place so this cannot drift from readSettingsCascade
		this.integration_include = readSetting('includeFilter');
		this.integration_exclude = readSetting('excludeFilter');
		// explicit message override wins so the Files drawer's Apply can re-narrow without round-tripping through config first; empty include is degenerate so falls back to the default, empty exclude legitimately means "exclude nothing"
		if (typeof e.include === 'string') {
			this.integration_include = e.include.trim() === '' ? DEFAULT_INCLUDE_FILTER : e.include;
		}
		if (typeof e.exclude === 'string') {
			this.integration_exclude = e.exclude;
		}
	}

	// single source of truth for "is this path inside the current folder integration?". Reused by sendDoc, loadFolderDoc (and any future caller) so the containment semantics never diverge between code paths. Uses isPathWithin (rigorous against `..` traversal and sibling-prefix matches like /ws vs /ws-evil) rather than a naive startsWith
	private isWithinIntegrationPath(target_path: string): boolean {
		if (!this.integration_path) { return false; }
		return isPathWithin(target_path, [this.integration_path]);
	}

	/**
	 * the base every exclude glob is matched against: the path relative to the WORKSPACE ROOT,
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

	// resolve the workspace folder CONTAINING this path, read live: a multi-root workspace has several (VS Code matches excludes against the containing one), and workspaceFolders can still be unresolved when the panel is constructed, leaving the cached workspace_root empty while folder mode - gated by the live isWithinWorkspace - runs anyway
	private workspaceRootFor(absolute_path: string): string {
		const root_paths = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.path);
		return root_paths.find(root_path => isPathWithin(absolute_path, [root_path])) ?? this.workspace_root;
	}

	// check whether a discovered or watcher-delivered URI is excluded by the current integration_exclude. Empty exclude => never excluded
	private isExcludedByIntegrationFilter(uri: vscode.Uri): boolean {
		if (this.integration_exclude.trim() === '') { return false; }
		return !globMatches(this.toWorkspaceRelative(uri.path), '', this.integration_exclude);
	}

	// check whether a directory's whole subtree is excluded, by probing a representative child file against the same workspace-relative gate
	private isExcludedDirectory(absolute_dir_path: string): boolean {
		if (this.integration_exclude.trim() === '') { return false; }
		return !globMatches(`${this.toWorkspaceRelative(absolute_dir_path)}/${EXCLUDE_PROBE_FILE}`, '', this.integration_exclude);
	}

	// enumerate top-level subfolders of the VS Code workspace root, filter by exclude, sort alphabetically. The webview uses this set as the stable universe for pill labels + hues so descending into a sub-project doesn't re-derive the disambiguation against a smaller visible set (e.g. notethink's label staying "NT" instead of collapsing to "NO" when a same-initial sibling project drops out of the visible set)
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
			// run each candidate through the same exclude gate used for file discovery so .git, node_modules, .claude, vendored, etc. don't consume hue indices
			const filtered = dir_names.filter(name => !this.isExcludedDirectory(path.posix.join(this.workspace_root, name)));
			this.workspace_projects = filtered.sort();
		} catch (err) {
			writeToErrorLog('computeWorkspaceProjects failed', this.workspace_root, err);
			this.workspace_projects = [];
		}
	}

	// scheme: file - VS Code's native findFiles honours the RelativePattern and its glob exclude
	private async discoverViaFindFiles(pattern: vscode.RelativePattern): Promise<Array<vscode.Uri>> {
		// an empty exclude becomes null so findFiles applies no exclusions at all; the default skips derived/dependency dirs and overrides files.exclude/search.exclude
		const find_exclude = this.integration_exclude.trim() === '' ? null : this.integration_exclude;
		return vscode.workspace.findFiles(pattern, find_exclude);
	}

	// non-file: scheme - findFiles ignores a custom-scheme RelativePattern, so recursively walk the folder with the provider's own readDirectory (the API the Explorer uses) and apply the include glob ourselves. Excluded directories are pruned so the walk never descends into node_modules/.git/etc; the surviving file list still passes through the shared exclude post-filter in discoverFolderDocs
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
				writeToErrorLog('folder walk: readDirectory failed', dir.path, err);
				continue;
			}
			for (const [name, type] of entries) {
				const child = vscode.Uri.joinPath(dir, name);
				// the include glob is folder-relative (it mirrors the RelativePattern findFiles gets on the file: scheme), while the exclude is matched against the workspace-root-relative path
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
			writeToLog('folder walk cap hit', `stopped after ${MAX_WALK_ENTRIES} directories under ${folder_path}`);
		}
		return results;
	}

	/**
	 * phase 1: discover and load in parallel; each file streams its own merge update
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
		// findFiles only honours a RelativePattern on the file: scheme; a custom FileSystemProvider (vscode-vfs:, notegit:, …) returns nothing for it, so on any other scheme fall back to a scheme-native readDirectory walk the provider does support (it's how the Explorer renders the same tree)
		const base_uri = this.resolveWorkspaceUri(folder_path);
		const discovered = base_uri.scheme === 'file'
			? await this.discoverViaFindFiles(pattern)
			: await this.discoverViaReadDirectoryWalk(base_uri, folder_path);
		// defense in depth: post-filter against the same exclude using the host-side globMatches helper. findFiles' brace-expanded exclude has had edge cases bite us in practice (a "vendored" segment leaking through despite **/{...,vendored}/**), and the file-system watcher armed below has no exclude at all - applying the filter here AND in loadFolderDoc gives both paths one deterministic gate
		const filtered = discovered.filter(uri => !this.isExcludedByIntegrationFilter(uri));
		// deterministic order so the capped subset is stable across reloads
		const sorted_uris = [...filtered].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
		// store on the session so later watcher-driven incremental updates re-send the same totals (reproduces the original closure-capture behaviour)
		this.integration_total_discovered = sorted_uris.length;
		this.integration_truncated = sorted_uris.length > MAX_AGGREGATE_FILES;
		const uris = sorted_uris.slice(0, MAX_AGGREGATE_FILES);
		debug('setIntegration folder: %d discovered, loading %d (cap %d, truncated=%s) in %s', this.integration_total_discovered, uris.length, MAX_AGGREGATE_FILES, this.integration_truncated, folder_path);
		if (this.integration_truncated) {
			writeToLog('setIntegration folder cap hit', `discovered ${this.integration_total_discovered}, loading first ${MAX_AGGREGATE_FILES} of ${folder_path}`);
		}
		const cache_hit = await this.discoveredSetMatchesCache(uris, previous_docs);
		if (cache_hit) {
			debug('setIntegration folder: fast-path - discovered set matches cached docs, skipping reload');
			// restore the previous integration_docs so the aggregate payload below carries the cached map (enterFolderMode cleared the live cache before discovery)
			for (const [id, doc] of Object.entries(previous_docs)) { this.integration_docs[id] = doc; }
			this.sendAggregatePayload();
			return;
		}
		// signal the webview that real work has started - only when there's actual loading to do; the fast path above skips this so the spinner never flashes on a no-op breadcrumb click
		this.sendPendingChange('folderDiscovery', true);
		// arrow wrapper isolates loadFolderDoc from .map's (value, index, array) trio so the index does not collide with the opts argument
		const load_promises = uris.map(uri => this.loadFolderDoc(uri));
		Promise.allSettled(load_promises).then(() => {
			debug('setIntegration folder: load complete, %d docs', Object.keys(this.integration_docs).length);
			this.sendAggregatePayload();
			this.sendPendingChange('folderDiscovery', false);
		});
	}

	/**
	 * stat each discovered URI and check whether the {path, mtime} set exactly matches
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
	 * shared per-file loader for both initial discovery and the folder watcher. The
	 * watcher path passes fromDisk=true to re-read raw bytes (openTextDocument's cache
	 * can't be trusted to reflect external on-disk edits). Posts a merge update so the
	 * view fills in progressively.
	 */
	private async loadFolderDoc(uri: vscode.Uri, opts: { fromDisk?: boolean } = {}): Promise<void> {
		try {
			// guard against late-arriving loads from a previous integration_path. discoverFolderDocs fires its per-file loaders via Promise.allSettled WITHOUT awaiting them - when the user descends folders (e.g. pill click from active_development → calfam), the old loaders can still resolve after the new enterFolderMode cleared integration_docs and changed integration_path, then write sibling-project docs into integration_docs and post merge updates that re-introduce already-cleared files. A positive path-containment check is the only correct gate here: the isExcludedByIntegrationFilter check below never rejects a sibling project (nothing in the exclude list names it, so its path passes the filter cleanly)
			if (!this.isWithinIntegrationPath(uri.path)) {
				return;
			}
			// the file system watcher armed in armFolderWatcher takes only an include pattern - createFileSystemWatcher has no exclude argument - so a vendored or otherwise-excluded path inside integration_path can fire onDidCreate/onDidChange and reach this loader. Gate every entry here against integration_exclude so the watcher cannot leak excluded files into integration_docs
			if (this.isExcludedByIntegrationFilter(uri)) {
				return;
			}
			// respect the cap for watcher-driven adds too: never grow a new path past MAX_AGGREGATE_FILES (re-parses of already-loaded paths still pass)
			const already_loaded = Object.values(this.integration_docs).some(d => d.path === uri.path);
			if (!already_loaded && Object.keys(this.integration_docs).length >= MAX_AGGREGATE_FILES) {
				return;
			}
			let doc: Doc;
			if (opts.fromDisk) {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const text = new TextDecoder().decode(bytes);
				doc = await this.buildDocFromUriAndText(uri, text, 'fsWatcher');
			} else {
				// initial-discovery path: openTextDocument may return editor-buffer content with unsaved edits, which is the right thing to show on first load
				const document = await vscode.workspace.openTextDocument(uri);
				doc = await this.buildDoc(document);
			}
			// re-check the integration-path containment AFTER the async load - between the guard at the top and now, the awaits above gave other handlers a chance to run, and a concurrent enterFolderMode (e.g. pill click descending into a sub-project) can clear integration_docs and switch integration_path. Without this re-check, a watcher event for a sibling project that started loading under the old integration_path can land in the new integration_path's integration_docs after the switch, surfacing as "stories from another project mysteriously appearing after an update" (clears on window reload because reload re-enters folder mode and re-runs discovery)
			if (!this.isWithinIntegrationPath(uri.path)) {
				return;
			}
			this.integration_docs[doc.id] = { ...doc, updateSentAt: new Date().toISOString() };
			this.webviewPanel.webview.postMessage({
				type: 'update',
				partial: { docs: { [doc.id]: this.integration_docs[doc.id] } },
				merge_strategy: 'merge',
				workspace_root: this.workspace_root,
				workspace_projects: this.workspace_projects,
				extension_version: this.extension_version,
				aggregate_total_discovered: this.integration_total_discovered,
				aggregate_truncated: this.integration_truncated,
				include_filter: this.integration_include,
				exclude_filter: this.integration_exclude,
			});
		} catch (err) {
			writeToErrorLog('setIntegration: failed to load doc', uri.path, err);
		}
	}

	// phase 2: watch the folder for incremental adds/edits/deletes. A custom FileSystemProvider may make watch() a no-op or throw (static/read-only content on a web host); a watcher failure must not abort folder entry - discovery already ran, so the view is populated, it just won't see live edits
	private armFolderWatcher(pattern: vscode.RelativePattern): void {
		try {
			this.integration_watcher = vscode.workspace.createFileSystemWatcher(pattern);
			// fromDisk: true bypasses openTextDocument's stale cache (the entire reason the watcher exists)
			this.integration_watcher.onDidCreate(uri => this.loadFolderDoc(uri, { fromDisk: true }));
			this.integration_watcher.onDidChange(uri => this.loadFolderDoc(uri, { fromDisk: true }));
			this.integration_watcher.onDidDelete(uri => this.handleFolderDocDeleted(uri));
		} catch (err) {
			this.integration_watcher = undefined;
			writeToErrorLog('armFolderWatcher: watcher unavailable (static provider?), continuing without live updates', pattern.pattern, err);
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
			writeToErrorLog('setIntegration watcher: delete failed', uri.path, err);
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
		// re-resolve the active editor (it may have changed while in folder mode) and re-send just that file; integration_path is now unset so sendDoc replaces, pruning stale folder docs
		try {
			// a Files-drawer file click targets a specific file: open + focus it first so it becomes the active editor this mode renders (doing it here, in one handler, avoids the race a separate openFile message would have)
			if (target_path && isWithinWorkspace(target_path, { requireExtension: '.md' })) {
				await this.revealByOpening(target_path, 0, 0, true);
			}
			const current_editor = vscode.window.activeTextEditor;
			if (current_editor?.document.uri.path.endsWith('.md') && current_editor.document.uri.path !== this.active_path) {
				this.active_doc = await this.buildDoc(current_editor.document);
				this.active_path = current_editor.document.uri.path;
			}
			if (this.active_doc) {
				this.sendDoc(this.active_doc);
				this.sendCurrentSelection();
			}
		} catch (err) {
			writeToErrorLog('setIntegration current_file failed', '', err);
		}
	}

	// --- breadcrumb jump drawer ---

	/**
	 * list jump targets for the breadcrumb's terminal segment: child folders in folder
	 * mode, sibling .md files in current_file mode. Validates the untrusted path before
	 * touching the filesystem, then posts the sorted entries back to the webview.
	 */
	private async handleRequestJumpTargets(e: Record<string, unknown>): Promise<void> {
		const mode = e.mode as string;
		const jump_path = e.path as string;
		try {
			if (mode === INTEGRATION_MODE_FOLDER) {
				if (!isWithinWorkspace(jump_path)) {
					writeToErrorLog('requestJumpTargets: folder outside workspace, refusing', jump_path);
					return;
				}
				const entries = await this.listChildFolders(jump_path);
				this.webviewPanel.webview.postMessage({ type: 'jumpTargets', mode, path: jump_path, entries });
			} else if (mode === INTEGRATION_MODE_CURRENT_FILE) {
				if (!isWithinWorkspace(jump_path, { requireExtension: '.md' })) {
					writeToErrorLog('requestJumpTargets: file outside workspace, refusing', jump_path);
					return;
				}
				const entries = await this.listSiblingMdFiles(jump_path);
				this.webviewPanel.webview.postMessage({ type: 'jumpTargets', mode, path: jump_path, entries });
			}
		} catch (err) {
			writeToErrorLog('requestJumpTargets failed', jump_path, err);
		}
	}

	// enumerate immediate child folders of base_path, dropping exclude-filtered ones with the same recipe computeWorkspaceProjects uses, sorted by label
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
	 * open a sibling .md file picked from the jump drawer. Routes through revealByOpening
	 * (not handleRevealRange, which stays silent in current_file mode) so the file opens in
	 * a column beside the panel and takes focus.
	 */
	private async handleOpenFile(e: Record<string, unknown>): Promise<void> {
		const file_path = e.path as string;
		try {
			if (!isWithinWorkspace(file_path, { requireExtension: '.md' })) {
				writeToErrorLog('openFile: path outside workspace, refusing', file_path);
				return;
			}
			await this.revealByOpening(file_path, 0, 0, true);
		} catch (err) {
			writeToErrorLog('openFile failed', file_path, err);
		}
	}

	/**
	 * dispatches on shape: `changes_by_doc` (multi-doc folder-mode batch, one entry
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
				writeToErrorLog('editText: path outside workspace, refusing', doc_path);
				return;
			}
			if (!Array.isArray(changes) || changes.length === 0) {
				writeToErrorLog('editText: no changes supplied for doc, skipping', doc_path);
				return;
			}
			const uri = this.resolveWorkspaceUri(doc_path);
			const document = await vscode.workspace.openTextDocument(uri);
			const invalid = firstInvalidChange(changes, document.getText().length);
			if (invalid) {
				writeToErrorLog('editText: invalid offsets, skipping',
					`from=${invalid.from} to=${invalid.to ?? invalid.from} len=${document.getText().length} insert="${invalid.insert}" doc=${doc_path}`);
				return;
			}
			logEditTextChanges(document, doc_path, changes);
			await applyEditTextChanges(document, uri, changes);
			const edited_doc = await this.buildDoc(document);
			if (document.uri.path === this.active_path) {
				this.active_doc = edited_doc;
				this.sendDoc(this.active_doc);
				this.sendCurrentSelection();
			} else {
				// folder/background edit: route through sendDoc so the merge strategy applies
				this.sendDoc(edited_doc);
			}
		} catch (err) {
			writeToErrorLog('editText failed', doc_path, err);
		}
	}

	private async handleOpenExternal(e: Record<string, unknown>): Promise<void> {
		const url = e.url as string;
		if (!url) { return; }
		try {
			// host-side scheme allow-list: only open http/https/mailto, refuse everything else (file:, vscode:, etc.)
			const parsed = vscode.Uri.parse(url);
			if (!(ALLOWED_EXTERNAL_SCHEMES as readonly string[]).includes(parsed.scheme.toLowerCase())) {
				writeToErrorLog('openExternal: refused scheme', url);
				return;
			}
			await vscode.env.openExternal(parsed);
		} catch (err) {
			writeToErrorLog('openExternal failed', url, err);
		}
	}

	/**
	 * open a relative .md link clicked in the rendered view, resolved against the ACTIVE
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
				writeToErrorLog('openRelative: target outside workspace or not .md, refusing', target.path);
				return;
			}
			await this.revealByOpening(target, 0, 0, true);
		} catch (err) {
			writeToErrorLog('openRelative failed', href, err);
		}
	}

	/**
	 * resolve href against the active doc's URI, preserving scheme/authority. Strips any #fragment / ?query before joining so the on-disk path is clean. Returns undefined when there is no active doc to anchor against
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

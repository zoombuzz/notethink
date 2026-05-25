import * as path from 'path';
import * as vscode from 'vscode';
import { MAX_AGGREGATE_FILES, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, DEFAULT_FOLDER_VIEW_COLUMN_ORDER } from '../constants';
import { generateIdentifier } from '../lib/crypto';
import { debug, writeToLog, writeToErrorLog } from '../lib/errorops';
import { parse } from '../lib/parseops';
import { isPathWithin } from '../lib/pathsafe';
import type { HashMapOf, Doc } from '../types/general';

const CHANGE_DEBOUNCE_MS = 250;
const SELECTION_DEBOUNCE_MS = 120;
const ALLOWED_EXTERNAL_SCHEMES = ['http', 'https', 'mailto'] as const;

// folder view settings — built-in default → User → Workspace cascade
// keys map between the webview payload (snake_case) and the VS Code config keys (camelCase under notethink.folderView.*)
const FOLDER_VIEW_KEYS = [
	'view_type',
	'column_order',
	'include_filter',
	'exclude_filter',
	'max_notes_per_file',
	'show_context_bars',
] as const;
type FolderViewKey = typeof FOLDER_VIEW_KEYS[number];

const FOLDER_VIEW_CONFIG_MAP: Record<FolderViewKey, string> = {
	view_type: 'viewType',
	column_order: 'columnOrder',
	include_filter: 'includeFilter',
	exclude_filter: 'excludeFilter',
	max_notes_per_file: 'maxNotesPerFile',
	show_context_bars: 'showContextBars',
};

// one-shot rename of legacy `notethink.folderView.aggregate*` keys (any scope) to their new names
const LEGACY_KEY_MIGRATIONS: Array<[string, string]> = [
	['aggregateInclude', 'includeFilter'],
	['aggregateExclude', 'excludeFilter'],
	['aggregateMaxNotesPerFile', 'maxNotesPerFile'],
];

interface TextChange {
	from: number;
	to?: number;
	insert: string;
}

// bridge isPathWithin to the live workspace: roots come from vscode.workspace.workspaceFolders so the pure helper stays vscode-free and unit-testable
function isWithinWorkspace(target_path: string, options?: { requireExtension?: string }): boolean {
	const root_paths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
	return isPathWithin(target_path, root_paths, options);
}

/**
 * find the first change whose offsets fall outside [0, doc_length] or have from > to.
 * Returns that change for logging, or null when every change is valid.
 */
function firstInvalidChange(changes: Array<TextChange>, doc_length: number): TextChange | null {
	for (const change of changes) {
		const to = change.to ?? change.from;
		if (change.from < 0 || to < 0 || change.from > doc_length || to > doc_length || change.from > to) {
			return change;
		}
	}
	return null;
}

/**
 * audit-log each pending change with ±10 chars of surrounding context before it is applied.
 */
function logEditTextChanges(document: vscode.TextDocument, doc_path: string, changes: Array<TextChange>): void {
	writeToLog('editText', `${changes.length} changes on ${doc_path} (len=${document.getText().length})`);
	for (const change of changes) {
		const ctx = document.getText().slice(Math.max(0, change.from - 10), (change.to ?? change.from) + 10);
		writeToLog('editText', `from=${change.from} to=${change.to} insert="${change.insert}" ctx="${ctx}"`);
	}
}

/**
 * apply changes to a document end-to-start so earlier offsets stay valid. Prefers an
 * already-visible editor (never spawns one); otherwise applies a WorkspaceEdit. The
 * caller must validate offsets first.
 */
async function applyEditTextChanges(document: vscode.TextDocument, uri: vscode.Uri, changes: Array<TextChange>): Promise<void> {
	const sorted_changes = [...changes].sort((a, b) => b.from - a.from);
	const existing = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === uri.path);
	if (existing) {
		await existing.edit(editBuilder => {
			for (const change of sorted_changes) {
				const from = document.positionAt(change.from);
				const to = change.to !== undefined ? document.positionAt(change.to) : from;
				if (change.to !== undefined) { editBuilder.replace(new vscode.Range(from, to), change.insert); }
				else { editBuilder.insert(from, change.insert); }
			}
		});
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
	// in single-file mode, onDidChangeTextDocument only fires for editor-open docs; this watcher refreshes the viewer when the shown file is edited externally with no visible editor backing it
	private active_file_watcher: vscode.FileSystemWatcher | undefined;
	private change_timer: ReturnType<typeof setTimeout> | undefined;
	private selection_timer: ReturnType<typeof setTimeout> | undefined;
	private readonly workspace_root: string;
	private readonly extension_version: string;

	constructor(
		private readonly webviewPanel: vscode.WebviewPanel,
		private readonly initialDocument: vscode.TextDocument,
		private readonly context: vscode.ExtensionContext,
		private readonly getHtml: (webview: vscode.Webview) => string,
		private readonly onActivate: (panel: vscode.WebviewPanel) => void,
		private readonly onDispose: (panel: vscode.WebviewPanel) => void,
	) {
		// resolve workspace root for breadcrumb display; asRelativePath/getWorkspaceFolder handle symlinks and may return undefined in web hosts
		const workspace_folder = vscode.workspace.getWorkspaceFolder(initialDocument.uri)
			|| vscode.workspace.workspaceFolders?.[0];
		this.workspace_root = workspace_folder?.uri.path || '';
		this.extension_version = this.context.extension.packageJSON.version as string || '';
	}

	/**
	 * wire the panel: install the webview HTML, build the initial doc, arm the
	 * active-file watcher, register every vscode listener, and subscribe to webview
	 * messages. Returns once initial state is built (the doc is pushed lazily on the
	 * webview's requestInitialState).
	 */
	public async start(): Promise<void> {
		this.onActivate(this.webviewPanel);
		this.webviewPanel.onDidChangeViewState(() => {
			if (this.webviewPanel.active) { this.onActivate(this.webviewPanel); }
		});
		this.webviewPanel.webview.options = { enableScripts: true };
		this.webviewPanel.webview.html = this.getHtml(this.webviewPanel.webview);
		await this.buildInitialDoc();
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
		// in folder mode only docs inside integration_path go into the merged view; selection updates for out-of-integration docs still flow through sendSelection separately
		if (this.integration_path && !doc.path.startsWith(this.integration_path)) {
			debug('sendDoc: skipping out-of-integration doc %s', doc.path);
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

	private sendSelection(doc_path: string, head: number, anchor: number): void {
		this.webviewPanel.webview.postMessage({
			type: 'selectionChanged',
			docPath: doc_path,
			selection: { head, anchor },
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
			this.sendSelection(this.active_path, 0, 0);
		}
	}

	/**
	 * build the initial active doc but defer pushing it to the webview until
	 * requestInitialState arrives — the webview sends setIntegration first on reload,
	 * so by then integration_path is set and the merge path runs instead of wiping the
	 * saved folder docs map.
	 */
	private async buildInitialDoc(): Promise<void> {
		this.active_path = this.initialDocument.uri.path;
		try {
			this.active_doc = await this.buildDoc(this.initialDocument);
		} catch (err) {
			writeToErrorLog('failed to build initial document', this.initialDocument.uri.path, err);
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
		const config = vscode.workspace.getConfiguration('notethink');
		if (!config.get<boolean>('watchUnopenedFilesInViewer', true)) { return; }
		// a visible text editor already drives onDidChangeTextDocument for on-disk changes; we only fill the gap when there's no editor
		const visible = vscode.window.visibleTextEditors.find(ed => ed.document.uri.path === this.active_path);
		if (visible) { return; }
		this.armActiveFileWatcher();
	}

	private armActiveFileWatcher(): void {
		try {
			const folder = path.dirname(this.active_path!);
			const filename = path.basename(this.active_path!);
			const pattern = new vscode.RelativePattern(vscode.Uri.file(folder), filename);
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

	private readGlobalSettings(): { show_line_numbers: boolean; watch_unopened_files_in_viewer: boolean } {
		const config = vscode.workspace.getConfiguration('notethink');
		return {
			show_line_numbers: config.get<boolean>('showLineNumbers', false),
			watch_unopened_files_in_viewer: config.get<boolean>('watchUnopenedFilesInViewer', true),
		};
	}

	private sendGlobalSettings(): void {
		this.webviewPanel.webview.postMessage({ type: 'globalSettings', settings: this.readGlobalSettings() });
	}

	private readFolderViewSettings(): Record<string, unknown> {
		const config = vscode.workspace.getConfiguration('notethink.folderView');
		// true iff any of the six folder-view keys has a Workspace-scope value; the webview uses it to enable the Reset button
		let has_workspace_overrides = false;
		for (const key of FOLDER_VIEW_KEYS) {
			const inspected = config.inspect(FOLDER_VIEW_CONFIG_MAP[key]);
			if (inspected?.workspaceValue !== undefined) {
				has_workspace_overrides = true;
				break;
			}
		}
		return {
			view_type: config.get<'auto' | 'document' | 'kanban'>('viewType', 'auto'),
			column_order: config.get<string[]>('columnOrder', DEFAULT_FOLDER_VIEW_COLUMN_ORDER),
			include_filter: config.get<string>('includeFilter', DEFAULT_INCLUDE_FILTER),
			exclude_filter: config.get<string>('excludeFilter', DEFAULT_EXCLUDE_FILTER),
			max_notes_per_file: config.get<number>('maxNotesPerFile', 10),
			show_context_bars: config.get<boolean>('showContextBars', true),
			has_workspace_overrides,
		};
	}

	private sendFolderViewSettings(): void {
		this.webviewPanel.webview.postMessage({ type: 'folderViewSettings', settings: this.readFolderViewSettings() });
	}

	/**
	 * one-shot rename of legacy aggregate* keys (any scope) to their new names; runs
	 * before the first read so the cascade reflects the migrated values.
	 */
	private async migrateLegacyFolderViewKeys(): Promise<void> {
		const config = vscode.workspace.getConfiguration('notethink.folderView');
		for (const [old_key, new_key] of LEGACY_KEY_MIGRATIONS) {
			const inspected = config.inspect(old_key);
			if (!inspected) { continue; }
			for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace] as const) {
				const value = target === vscode.ConfigurationTarget.Global ? inspected.globalValue : inspected.workspaceValue;
				if (value === undefined) { continue; }
				try {
					await config.update(new_key, value, target);
					await config.update(old_key, undefined, target);
				} catch (err) {
					writeToErrorLog('migrateLegacyFolderViewKeys failed', `${old_key} → ${new_key}`, err);
				}
			}
		}
	}

	// --- vscode listeners ---

	private registerListeners(): void {
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e));
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(editor => this.onDidChangeActiveTextEditor(editor));
		// an editor split opening or closing for the active file flips whether we still need the active-file watcher
		const visibleEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors(() => this.syncActiveFileWatcher());
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

	// debounce change handler — only re-parse the active document
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
		if (e.affectsConfiguration('notethink.showLineNumbers')) {
			this.sendGlobalSettings();
		}
		if (e.affectsConfiguration('notethink.watchUnopenedFilesInViewer')) {
			this.sendGlobalSettings();
			this.syncActiveFileWatcher();
		}
		if (e.affectsConfiguration('notethink.folderView')) {
			this.sendFolderViewSettings();
		}
	}

	// track text editor selection changes — debounced to avoid flooding the webview
	private onDidChangeTextEditorSelection(e: vscode.TextEditorSelectionChangeEvent): void {
		if (e.textEditor.document.uri.path !== this.active_path) { return; }
		// suppress selection while a document change is pending — the change handler sends selection after re-parse to keep MDAST and caret in sync
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
				case 'updateFolderViewSetting': return this.handleUpdateFolderViewSetting(e);
				case 'promoteFolderViewSettingsToUser': return this.handlePromoteFolderViewSettings();
				case 'resetFolderViewSettingsToDefault': return this.handleResetFolderViewSettings();
				case 'revealRange':
				case 'selectRange': return this.handleRevealRange(e);
				case 'setIntegration': return this.handleSetIntegration(e);
				case 'editText': return this.handleEditText(e);
				case 'openExternal': return this.handleOpenExternal(e);
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
			await this.migrateLegacyFolderViewKeys();
			this.sendFolderViewSettings();
			this.syncActiveFileWatcher();
		} catch (err) {
			writeToErrorLog('requestInitialState failed', '', err);
		}
	}

	private async handleUpdateGlobalSetting(e: Record<string, unknown>): Promise<void> {
		const setting = e.setting as string;
		const value = e.value as unknown;
		try {
			const config = vscode.workspace.getConfiguration('notethink');
			// per-setting storage target: showLineNumbers persists per-workspace; watchUnopenedFilesInViewer is a personal preference that follows the user across projects
			const setting_map: Record<string, { configKey: string; target: vscode.ConfigurationTarget }> = {
				show_line_numbers: { configKey: 'showLineNumbers', target: vscode.ConfigurationTarget.Workspace },
				watch_unopened_files_in_viewer: { configKey: 'watchUnopenedFilesInViewer', target: vscode.ConfigurationTarget.Global },
			};
			const entry = setting_map[setting];
			if (entry) {
				await config.update(entry.configKey, value, entry.target);
			}
		} catch (err) {
			writeToErrorLog('updateGlobalSetting failed', setting, err);
		}
	}

	private async handleUpdateFolderViewSetting(e: Record<string, unknown>): Promise<void> {
		// scope defaults to workspace so user edits stay local; promote-to-default uses scope='global'
		const setting = e.setting as FolderViewKey;
		const value = e.value as unknown;
		const scope = (e.scope as 'workspace' | 'global' | undefined) ?? 'workspace';
		try {
			if (!FOLDER_VIEW_KEYS.includes(setting)) {
				writeToErrorLog('updateFolderViewSetting: unknown setting', setting);
				return;
			}
			const config = vscode.workspace.getConfiguration('notethink.folderView');
			const target = scope === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
			await config.update(FOLDER_VIEW_CONFIG_MAP[setting], value, target);
		} catch (err) {
			writeToErrorLog('updateFolderViewSetting failed', setting, err);
		}
	}

	private async handlePromoteFolderViewSettings(): Promise<void> {
		// copy every currently-resolved value to User scope, then clear Workspace so the cascade reads from User next time
		try {
			const config = vscode.workspace.getConfiguration('notethink.folderView');
			const resolved = this.readFolderViewSettings();
			for (const key of FOLDER_VIEW_KEYS) {
				await config.update(FOLDER_VIEW_CONFIG_MAP[key], resolved[key], vscode.ConfigurationTarget.Global);
			}
			// second pass clears Workspace overrides so they don't shadow the freshly-promoted User values
			for (const key of FOLDER_VIEW_KEYS) {
				const config_key = FOLDER_VIEW_CONFIG_MAP[key];
				const inspected = config.inspect(config_key);
				if (inspected?.workspaceValue !== undefined) {
					await config.update(config_key, undefined, vscode.ConfigurationTarget.Workspace);
				}
			}
		} catch (err) {
			writeToErrorLog('promoteFolderViewSettingsToUser failed', '', err);
		}
	}

	private async handleResetFolderViewSettings(): Promise<void> {
		// clear every Workspace-scope override so the cascade falls back to User then built-in
		try {
			const config = vscode.workspace.getConfiguration('notethink.folderView');
			for (const key of FOLDER_VIEW_KEYS) {
				const config_key = FOLDER_VIEW_CONFIG_MAP[key];
				const inspected = config.inspect(config_key);
				if (inspected?.workspaceValue !== undefined) {
					await config.update(config_key, undefined, vscode.ConfigurationTarget.Workspace);
				}
			}
		} catch (err) {
			writeToErrorLog('resetFolderViewSettingsToDefault failed', '', err);
		}
	}

	private async handleRevealRange(e: Record<string, unknown>): Promise<void> {
		const doc_path = e.docPath as string;
		const from = e.from as number;
		const to = (e.to ?? e.from) as number;
		try {
			if (!doc_path) { return; }
			// gate both the visible-editor fast path and the openTextDocument path: webview-supplied paths are untrusted
			if (!isWithinWorkspace(doc_path, { requireExtension: '.md' })) {
				writeToErrorLog(`${e.type}: path outside workspace, refusing`, doc_path);
				return;
			}
			if (this.revealInVisibleEditor(doc_path, from, to)) { return; }
			// in folder mode the view is a set of signposts — jump to the file even when no editor shows it; in single-file mode stay silent to avoid spawning editors on stray clicks
			if (!this.integration_path) { return; }
			await this.revealByOpening(doc_path, from, to);
		} catch (err) {
			writeToErrorLog(`${e.type} failed`, doc_path, err);
		}
	}

	// reveal/select in a visible editor without opening anything; returns true if handled
	private revealInVisibleEditor(doc_path: string, from: number, to: number): boolean {
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
		vscode.window.showTextDocument(existing.document, existing.viewColumn, false);
		return true;
	}

	// open the doc in a column that isn't this NoteThink panel's, preferring a group that already has it open
	private async revealByOpening(doc_path: string, from: number, to: number): Promise<void> {
		let target_column = this.findColumnWithDoc(doc_path);
		if (target_column === undefined) {
			const notethink_column = this.webviewPanel.viewColumn;
			const other_group = vscode.window.tabGroups?.all?.find(g => g.viewColumn !== notethink_column);
			target_column = other_group?.viewColumn ?? vscode.ViewColumn.Beside;
		}
		const uri = vscode.Uri.file(doc_path);
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
					const input = tab.input as { uri?: vscode.Uri } | undefined;
					if (input?.uri?.path === doc_path) { return group.viewColumn; }
				}
			}
		} catch (err) {
			// tabGroups API may be unavailable on older hosts — caller falls back to a beside column
			debug('findColumnWithDoc: tabGroups unavailable: %O', err);
		}
		return undefined;
	}

	private async handleSetIntegration(e: Record<string, unknown>): Promise<void> {
		const mode = e.mode as string;
		const folder_path = e.path as string;
		if (mode === 'folder' && folder_path) {
			// validate before any teardown so a poisoned path can't dismantle a legitimate integration (folder, so no extension requirement)
			if (!isWithinWorkspace(folder_path)) {
				writeToErrorLog('setIntegration: folder outside workspace, refusing', folder_path);
				return;
			}
			await this.enterFolderMode(folder_path, e);
		} else if (mode === 'current_file') {
			await this.enterCurrentFileMode();
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
			for (const key of Object.keys(this.integration_docs)) { delete this.integration_docs[key]; }
			this.integration_path = folder_path;
			this.adoptFolderFilters(e);
			const pattern = new vscode.RelativePattern(vscode.Uri.file(folder_path), this.integration_include);
			await this.discoverFolderDocs(pattern, folder_path);
			this.armFolderWatcher(pattern);
		} catch (err) {
			writeToErrorLog('setIntegration folder failed', folder_path, err);
		}
	}

	// only adopt filters the message explicitly carries so a breadcrumb re-narrow keeps the user's current filters; an empty include is degenerate so falls back to the default, an empty exclude legitimately means "exclude nothing"
	private adoptFolderFilters(e: Record<string, unknown>): void {
		if (typeof e.include === 'string') {
			this.integration_include = e.include.trim() === '' ? DEFAULT_INCLUDE_FILTER : e.include;
		}
		if (typeof e.exclude === 'string') {
			this.integration_exclude = e.exclude;
		}
	}

	/**
	 * phase 1: discover and load in parallel; each file streams its own merge update
	 * as it completes so a slow file never blocks the others. After all settle, a
	 * replace update ships the canonical map, pruning stale docs from a saved session.
	 */
	private async discoverFolderDocs(pattern: vscode.RelativePattern, folder_path: string): Promise<void> {
		// an empty exclude becomes null so findFiles applies no exclusions at all; the default skips derived/dependency dirs and overrides files.exclude/search.exclude
		const find_exclude = this.integration_exclude.trim() === '' ? null : this.integration_exclude;
		const discovered = await vscode.workspace.findFiles(pattern, find_exclude);
		// deterministic order so the capped subset is stable across reloads
		const sorted_uris = [...discovered].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
		// store on the session so later watcher-driven incremental updates re-send the same totals (reproduces the original closure-capture behaviour)
		this.integration_total_discovered = sorted_uris.length;
		this.integration_truncated = sorted_uris.length > MAX_AGGREGATE_FILES;
		const uris = sorted_uris.slice(0, MAX_AGGREGATE_FILES);
		debug('setIntegration folder: %d discovered, loading %d (cap %d, truncated=%s) in %s', this.integration_total_discovered, uris.length, MAX_AGGREGATE_FILES, this.integration_truncated, folder_path);
		if (this.integration_truncated) {
			writeToLog('setIntegration folder cap hit', `discovered ${this.integration_total_discovered}, loading first ${MAX_AGGREGATE_FILES} of ${folder_path}`);
		}
		// arrow wrapper isolates loadFolderDoc from .map's (value, index, array) trio so the index does not collide with the opts argument
		const load_promises = uris.map(uri => this.loadFolderDoc(uri));
		Promise.allSettled(load_promises).then(() => {
			debug('setIntegration folder: load complete, %d docs', Object.keys(this.integration_docs).length);
			this.webviewPanel.webview.postMessage({
				type: 'update',
				partial: { docs: this.integration_docs },
				workspace_root: this.workspace_root,
				extension_version: this.extension_version,
				aggregate_total_discovered: this.integration_total_discovered,
				aggregate_truncated: this.integration_truncated,
				include_filter: this.integration_include,
				exclude_filter: this.integration_exclude,
			});
		});
	}

	/**
	 * shared per-file loader for both initial discovery and the folder watcher. The
	 * watcher path passes fromDisk=true to re-read raw bytes (openTextDocument's cache
	 * can't be trusted to reflect external on-disk edits). Posts a merge update so the
	 * view fills in progressively.
	 */
	private async loadFolderDoc(uri: vscode.Uri, opts: { fromDisk?: boolean } = {}): Promise<void> {
		try {
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
			this.integration_docs[doc.id] = { ...doc, updateSentAt: new Date().toISOString() };
			this.webviewPanel.webview.postMessage({
				type: 'update',
				partial: { docs: { [doc.id]: this.integration_docs[doc.id] } },
				merge_strategy: 'merge',
				workspace_root: this.workspace_root,
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

	// phase 2: watch the folder for incremental adds/edits/deletes
	private armFolderWatcher(pattern: vscode.RelativePattern): void {
		this.integration_watcher = vscode.workspace.createFileSystemWatcher(pattern);
		// fromDisk: true bypasses openTextDocument's stale cache (the entire reason the watcher exists)
		this.integration_watcher.onDidCreate(uri => this.loadFolderDoc(uri, { fromDisk: true }));
		this.integration_watcher.onDidChange(uri => this.loadFolderDoc(uri, { fromDisk: true }));
		this.integration_watcher.onDidDelete(uri => this.handleFolderDocDeleted(uri));
	}

	private async handleFolderDocDeleted(uri: vscode.Uri): Promise<void> {
		try {
			const id = await generateIdentifier(uri.path);
			if (this.integration_docs[id]) {
				delete this.integration_docs[id];
				// signal the webview to drop this doc — convention: send tombstone with empty content
				this.webviewPanel.webview.postMessage({ type: 'docDeleted', docId: id, docPath: uri.path });
			}
		} catch (err) {
			writeToErrorLog('setIntegration watcher: delete failed', uri.path, err);
		}
	}

	private async enterCurrentFileMode(): Promise<void> {
		// switching back to single-file mode — tear down any active watcher
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

	/**
	 * dispatches on shape: `changes_by_doc` (multi-doc folder-mode batch, one entry
	 * per file) vs `docPath`+`changes` (single-doc back-compat). Both route per-doc
	 * work through `applyEditTextToDoc`; the batch path applies sequentially so
	 * concurrent applyEdit calls do not race on change_timer / active state. A single
	 * bad doc in a batch is logged and skipped — the remaining docs still apply.
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
			const uri = vscode.Uri.file(doc_path);
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
}

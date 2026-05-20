import * as vscode from 'vscode';
import * as path from 'path';
import { generateIdentifier } from '../lib/crypto';
import type { HashMapOf, Doc } from '../types/general';
import { abbrevDoc, getNonce } from '../lib/utils';
import { debug, writeToLog, writeToErrorLog } from "../lib/errorops";
import { parse } from '../lib/parseops';
import { isPathWithin } from '../lib/pathsafe';

const CHANGE_DEBOUNCE_MS = 250;
const SELECTION_DEBOUNCE_MS = 120;
const BACKGROUND_BATCH_SIZE = 20;
// hard cap on files loaded+parsed into a single folder aggregate
// without it, selecting a large root (~600+ .md files) fans out one openTextDocument+parse+postMessage per file and re-runs mergeAggregateRoot on every message, saturating IPC and pinning the renderer ("window not responding")
const MAX_AGGREGATE_FILES = 200;
// default aggregate filters; overridable per-view from the Files drawer (setIntegration include/exclude)
const DEFAULT_AGGREGATE_INCLUDE = '**/*.md';
// skip standard derived/dependency directories whose .md files (readmes, changelogs) would otherwise flood the aggregate view; the user may override or clear this from the Files drawer
const DEFAULT_AGGREGATE_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,dist,build,out,.next,.cache,coverage}/**';
const ALLOWED_EXTERNAL_SCHEMES = ['http', 'https', 'mailto'] as const;

// bridge isPathWithin to the live workspace: roots come from vscode.workspace.workspaceFolders so the pure helper stays vscode-free and unit-testable
function isWithinWorkspace(target_path: string, options?: { requireExtension?: string }): boolean {
	const root_paths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
	return isPathWithin(target_path, root_paths, options);
}

export class NotethinkEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'notethink.viewer';
	private activePanel: vscode.WebviewPanel | undefined;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new NotethinkEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(
			NotethinkEditorProvider.viewType,
			provider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		);
		return providerRegistration;
	}

	constructor(private readonly context: vscode.ExtensionContext) {
		// no action
	}

	public sendCommandToActiveWebview(command: string, payload?: Record<string, unknown>): void {
		if (!this.activePanel) { return; }
		this.activePanel.webview.postMessage({
			type: 'command',
			command,
			...payload,
		});
	}

	public async myWebviewPanel(
		webviewPanel: vscode.WebviewPanel,
		initialDocument: vscode.TextDocument,
	): Promise<void> {
		// track active panel for command relay
		this.activePanel = webviewPanel;
		webviewPanel.onDidChangeViewState(() => {
			if (webviewPanel.active) {
				this.activePanel = webviewPanel;
			}
		});

		// setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		// --- helpers ---

		async function buildDoc(document: vscode.TextDocument): Promise<Doc> {
			const text = document.getText();
			const mdast = parse(text);
			// asRelativePath handles symlinks - returns path relative to workspace root
			const relative = vscode.workspace.asRelativePath(document.uri, false);
			return {
				path: document.uri.path,
				relative_path: !relative.startsWith('/') ? relative : undefined,
				id: await generateIdentifier(document.uri.path),
				content: mdast,
				text,
				hash_sha256: await generateIdentifier(text),
				updatedAt: new Date().toISOString(),
				createdBy: "activeEditor",
			};
		}

		function sendDoc(doc: Doc) {
			const timestamped = { ...doc, updateSentAt: new Date().toISOString() };
			debug('sendDoc %s', doc.path);
			// in aggregate (folder) mode only docs inside integration_path go into the merged view; docs outside should not pollute the aggregated map
			// selection updates for out-of-integration docs still flow through sendSelection separately
			if (integration_path && !doc.path.startsWith(integration_path)) {
				debug('sendDoc: skipping out-of-integration doc %s', doc.path);
				return;
			}
			// in-memory edits to integration docs must merge into the existing map; otherwise the replace-strategy default would wipe every other file
			const merge_strategy = integration_path ? 'merge' : undefined;
			if (integration_path) {
				// keep our local cache in sync so the watcher's later events build on the same content
				integration_docs[doc.id] = timestamped;
			}
			webviewPanel.webview.postMessage({
				type: 'update',
				partial: { docs: { [doc.id]: timestamped } },
				merge_strategy,
				workspace_root,
				extension_version,
			});
		}

		function sendSelection(doc_path: string, head: number, anchor: number) {
			webviewPanel.webview.postMessage({
				type: 'selectionChanged',
				docPath: doc_path,
				selection: { head, anchor },
			});
		}

		// --- single-file view: show only the active document ---

		let active_doc: Doc | undefined;
		let active_path: string | undefined;

		// --- aggregate (folder) integration state ---
		let integration_watcher: vscode.FileSystemWatcher | undefined;
		let integration_path: string | undefined;
		// editable aggregate filters, persisted per-view by the webview and replayed on reload; survive a breadcrumb re-narrow (only overwritten when the setIntegration message explicitly carries them)
		let integration_include = DEFAULT_AGGREGATE_INCLUDE;
		let integration_exclude = DEFAULT_AGGREGATE_EXCLUDE;
		const integration_docs: HashMapOf<Doc> = {};

		// --- single-file external-change watcher ---
		// in single-file mode, onDidChangeTextDocument only fires for editor-open docs; when the viewer shows a file that isn't open in any text editor (custom editor + external edit by another tool, e.g. Claude's Write), the viewer would never refresh. This watcher closes that gap. Folder mode already has integration_watcher covering its tree.
		let active_file_watcher: vscode.FileSystemWatcher | undefined;

		function sendCurrentSelection() {
			if (!active_path) { return; }
			const editor = vscode.window.visibleTextEditors.find(
				ed => ed.document.uri.path === active_path
			);
			if (editor) {
				const head = editor.document.offsetAt(editor.selection.active);
				const anchor = editor.document.offsetAt(editor.selection.anchor);
				sendSelection(active_path, head, anchor);
			} else {
				sendSelection(active_path, 0, 0);
			}
		}

		// idempotent: tear any existing watcher down, then re-arm if the active file currently needs one. Call this whenever the active path, integration mode, setting value, or visible-editor set changes.
		function syncActiveFileWatcher() {
			if (active_file_watcher) {
				active_file_watcher.dispose();
				active_file_watcher = undefined;
			}
			// folder mode has integration_watcher; double-armed watchers would re-parse the same file twice
			if (integration_path) { return; }
			if (!active_path) { return; }
			const config = vscode.workspace.getConfiguration('notethink');
			if (!config.get<boolean>('watchUnopenedFilesInViewer', true)) { return; }
			// a visible text editor will already drive onDidChangeTextDocument for on-disk changes; we only fill the gap when there's no editor
			const visible = vscode.window.visibleTextEditors.find(
				ed => ed.document.uri.path === active_path
			);
			if (visible) { return; }
			try {
				const folder = path.dirname(active_path);
				const filename = path.basename(active_path);
				const pattern = new vscode.RelativePattern(vscode.Uri.file(folder), filename);
				active_file_watcher = vscode.workspace.createFileSystemWatcher(pattern);
				const onChange = async (changed_uri: vscode.Uri) => {
					if (changed_uri.path !== active_path) { return; }
					try {
						const document = await vscode.workspace.openTextDocument(changed_uri);
						active_doc = await buildDoc(document);
						sendDoc(active_doc);
					} catch (err) {
						writeToErrorLog('active-file watcher: re-parse failed', changed_uri.path, err);
					}
				};
				active_file_watcher.onDidChange(onChange);
				active_file_watcher.onDidCreate(onChange);
				debug('active-file watcher armed for %s', active_path);
			} catch (err) {
				writeToErrorLog('syncActiveFileWatcher: failed to create watcher', active_path, err);
			}
		}

		// resolve workspace root for breadcrumb display
		// Use asRelativePath to handle symlinks correctly - it returns a path relative
		// to the workspace folder regardless of how the folder was opened (symlink or real path).
		// getWorkspaceFolder may also return undefined in web extension hosts.
		const workspace_folder = vscode.workspace.getWorkspaceFolder(initialDocument.uri)
			|| vscode.workspace.workspaceFolders?.[0];
		const workspace_root = workspace_folder?.uri.path || '';
		const extension_version = this.context.extension.packageJSON.version as string || '';

		// global settings helpers
		function readGlobalSettings() {
			const config = vscode.workspace.getConfiguration('notethink');
			return {
				show_line_numbers: config.get<boolean>('showLineNumbers', false),
				watch_unopened_files_in_viewer: config.get<boolean>('watchUnopenedFilesInViewer', true),
			};
		}

		function sendGlobalSettings() {
			webviewPanel.webview.postMessage({
				type: 'globalSettings',
				settings: readGlobalSettings(),
			});
		}

		// build the initial active doc but defer pushing it to the webview until requestInitialState arrives - the webview sends setIntegration first on reload so by the time we sendDoc here integration_path is set and the merge_strategy='merge' path runs instead of wiping the saved aggregate map
		active_path = initialDocument.uri.path;
		try {
			active_doc = await buildDoc(initialDocument);
		} catch (err) {
			writeToErrorLog('failed to build initial document', initialDocument.uri.path, err);
		}
		syncActiveFileWatcher();

		const filter_criterion = '**/*.md';
		const docs: HashMapOf<Doc> = {};

		/**
		 * @todo multi-file view: load all workspace docs and watch for new ones.
		 * Call this when multi-file view context is mature enough.
		 */
		async function discoverAllWorkspaceDocs() {
			// phase 1: load docs from visible text editors for fast first paint
			const load_time = new Date().toISOString();
			const visible_md_editors = vscode.window.visibleTextEditors.filter(
				ed => ed.document.uri.path.endsWith('.md')
			);
			for (const editor of visible_md_editors) {
				try {
					const uri = editor.document.uri;
					const text = editor.document.getText();
					const mdast = parse(text);
					const doc: Doc = {
						path: uri.path,
						id: await generateIdentifier(uri.path),
						content: mdast,
						text,
						hash_sha256: await generateIdentifier(text),
						updatedAt: load_time,
						createdBy: "visibleTextEditor",
					};
					docs[doc.id] = doc;
					debug('loaded visible editor document', abbrevDoc(doc));
				} catch (err) {
					writeToErrorLog('failed to load visible editor document', editor.document.uri.path, err);
				}
			}
			debug('phase 1: loaded %d visible editor docs', Object.keys(docs).length);
			updateWebview();

			// listen for new documents being created that match the glob
			const watcher = vscode.workspace.createFileSystemWatcher(filter_criterion);
			watcher.onDidCreate(async (uri) => {
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					const text = document.getText();
					const mdast = parse(text);
					const doc: Doc = {
						path: uri.path,
						createdBy: "onDidCreate",
						id: await generateIdentifier(uri.path),
						content: mdast,
						text,
						hash_sha256: await generateIdentifier(text),
					};
					docs[doc.id] = doc;
					writeToLog('new matching document added in the background', abbrevDoc(doc));
					updateWebview({ [doc.id]: doc });
				} catch (err) {
					writeToErrorLog('failed to load new document', uri.path, err);
				}
			});

			// phase 2: discover remaining *.md files in the background
			const loaded_paths = new Set(Object.values(docs).map(d => d.path));
			const all_uris = await vscode.workspace.findFiles(filter_criterion);
			const remaining = all_uris.filter(uri => !loaded_paths.has(uri.path));
			debug('phase 2: discovering %d remaining docs (%d already loaded)', remaining.length, loaded_paths.size);
			let batch: HashMapOf<Doc> = {};
			let batch_count = 0;
			for (const uri of remaining) {
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					const text = document.getText();
					const mdast = parse(text);
					const doc: Doc = {
						path: uri.path,
						id: await generateIdentifier(uri.path),
						content: mdast,
						text,
						hash_sha256: await generateIdentifier(text),
						updatedAt: new Date().toISOString(),
						createdBy: "backgroundDiscovery",
					};
					docs[doc.id] = doc;
					batch[doc.id] = doc;
					batch_count++;
					if (batch_count >= BACKGROUND_BATCH_SIZE) {
						updateWebview(batch);
						batch = {};
						batch_count = 0;
					}
				} catch (err) {
					writeToErrorLog('failed to load background document', uri.path, err);
				}
			}
			if (batch_count > 0) {
				updateWebview(batch);
			}
			debug('phase 2: background discovery complete, %d total docs', Object.keys(docs).length);

			return watcher;
		}

		/**
		 * Update the webview content (used by multi-file discovery)
		 * @param partial_docs optional subset of docs to send; defaults to all docs
		 */
		function updateWebview(partial_docs?: HashMapOf<Doc>) {
			const send_docs = partial_docs ?? docs;
			const timestamped: HashMapOf<Doc> = {};
			const now = new Date().toISOString();
			for (const [id, doc] of Object.entries(send_docs)) {
				timestamped[id] = { ...doc, updateSentAt: now };
			}
			const message = {
				type: 'update',
				partial: { docs: timestamped },
				workspace_root,
				extension_version,
			};
			debug('updateWebview (%d docs)', Object.keys(send_docs).length);
			webviewPanel.webview.postMessage(message);
		}

		// debounce change handler - only re-parse the active document
		let change_timer: ReturnType<typeof setTimeout> | undefined;
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.path !== active_path) { return; }
			if (change_timer) { clearTimeout(change_timer); }
			change_timer = setTimeout(async () => {
				change_timer = undefined;
				try {
					active_doc = await buildDoc(e.document);
					sendDoc(active_doc);
					// send selection after doc update so webview never has stale MDAST with fresh caret
					sendCurrentSelection();
				} catch (err) {
					writeToErrorLog('failed to process document change', e.document.uri.path, err);
				}
			}, CHANGE_DEBOUNCE_MS);
		});

		// switch displayed document when the user switches to a different .md editor
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (!editor || !editor.document.uri.path.endsWith('.md')) { return; }
			if (editor.document.uri.path === active_path) { return; }
			try {
				active_doc = await buildDoc(editor.document);
				active_path = editor.document.uri.path;
				sendDoc(active_doc);
				const head = editor.document.offsetAt(editor.selection.active);
				const anchor = editor.document.offsetAt(editor.selection.anchor);
				sendSelection(active_path, head, anchor);
				syncActiveFileWatcher();
			} catch (err) {
				writeToErrorLog('failed to switch active document', editor?.document.uri.path, err);
			}
		});

		// re-evaluate the active-file watcher when the visible editor set changes (an editor split opening or closing for the active file flips whether we still need the watcher)
		const visibleEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors(() => {
			syncActiveFileWatcher();
		});

		// re-send global settings when workspace configuration changes
		const configSubscription = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('notethink.showLineNumbers')) {
				sendGlobalSettings();
			}
			if (e.affectsConfiguration('notethink.watchUnopenedFilesInViewer')) {
				sendGlobalSettings();
				syncActiveFileWatcher();
			}
		});

		// receive message back from the webview.
		webviewPanel.webview.onDidReceiveMessage(async (e) => {
			debug('onDidReceiveMessage', e.type);
			try { switch (e.type) {
				case 'requestInitialState':
					try {
						// check if a different .md file is now active in the editor
						// (e.g. after window reload, VS Code may restore editors in unpredictable order)
						const current_editor = vscode.window.activeTextEditor;
						if (current_editor?.document.uri.path.endsWith('.md')
							&& current_editor.document.uri.path !== active_path) {
							active_doc = await buildDoc(current_editor.document);
							active_path = current_editor.document.uri.path;
						}
						if (active_doc) {
							sendDoc(active_doc);
							sendCurrentSelection();
						}
						sendGlobalSettings();
						syncActiveFileWatcher();
					} catch (err) {
						writeToErrorLog('requestInitialState failed', '', err);
					}
					return;
				case 'updateGlobalSetting': {
					const setting = e.setting as string;
					const value = e.value as unknown;
					try {
						const config = vscode.workspace.getConfiguration('notethink');
						// per-setting storage target: showLineNumbers persists per-workspace (existing behaviour); watchUnopenedFilesInViewer is a personal viewer-behaviour preference that should follow the user across every project
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
					return;
				}
				case 'revealRange':
				case 'selectRange': {
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

						// first: if the doc already lives in a visible editor we just reveal/select in place without opening anything
						const existing = vscode.window.visibleTextEditors.find(
							ed => ed.document.uri.path === doc_path
						);
						if (existing) {
							const document = existing.document;
							const start_pos = document.positionAt(from);
							const end_pos = document.positionAt(to);
							// Selection(anchor, active): keep active at `from` so the head reported back via selectionChanged stays at the note's start offset rather than overshooting past end_body
							existing.selection = (from === to)
								? new vscode.Selection(start_pos, end_pos)
								: new vscode.Selection(end_pos, start_pos);
							existing.revealRange(new vscode.Range(start_pos, end_pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
							// focus the text editor so the user can immediately type
							vscode.window.showTextDocument(existing.document, existing.viewColumn, false);
							return;
						}

						// in aggregate (folder) mode the NoteThink view is a set of signposts — clicking a story should jump to the file even when no editor is currently showing it
						// in single-file mode we deliberately stay silent to avoid spawning editors on stray clicks
						if (!integration_path) { return; }

						// find a tab anywhere in the workbench that already has the file open and switch to that group rather than opening a fresh editor
						let target_column: vscode.ViewColumn | undefined;
						try {
							for (const group of vscode.window.tabGroups.all) {
								for (const tab of group.tabs) {
									const input = tab.input as { uri?: vscode.Uri } | undefined;
									if (input?.uri?.path === doc_path) {
										target_column = group.viewColumn;
										break;
									}
								}
								if (target_column !== undefined) { break; }
							}
						} catch {
							// tabGroups API may be unavailable on older hosts — fall through
						}

						// not open anywhere — pick a column that isn't this NoteThink panel's, preferring an existing group, otherwise open beside (creates a new group)
						if (target_column === undefined) {
							const notethink_column = webviewPanel.viewColumn;
							const other_group = vscode.window.tabGroups?.all?.find(
								g => g.viewColumn !== notethink_column
							);
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
					} catch (err) {
						writeToErrorLog(`${e.type} failed`, doc_path, err);
					}
					return;
				}
				case 'setIntegration': {
					const mode = e.mode as string;
					const folder_path = e.path as string;
					if (mode === 'folder' && folder_path) {
						// validate before any teardown so a poisoned path can't dismantle a legitimate integration (folder, so no extension requirement)
						if (!isWithinWorkspace(folder_path)) {
							writeToErrorLog('setIntegration: folder outside workspace, refusing', folder_path);
							return;
						}
						try {
							// tear down any previous watcher and reset the doc cache
							if (integration_watcher) {
								integration_watcher.dispose();
								integration_watcher = undefined;
							}
							for (const key of Object.keys(integration_docs)) { delete integration_docs[key]; }
							integration_path = folder_path;

							// only adopt filters the message explicitly carries so a breadcrumb re-narrow keeps the user's current filters; an empty include is degenerate (matches nothing) so fall back to the default, an empty exclude legitimately means "exclude nothing"
							if (typeof e.include === 'string') {
								integration_include = e.include.trim() === '' ? DEFAULT_AGGREGATE_INCLUDE : e.include;
							}
							if (typeof e.exclude === 'string') {
								integration_exclude = e.exclude;
							}

							const pattern = new vscode.RelativePattern(vscode.Uri.file(folder_path), integration_include);

							// aggregate-size metadata, surfaced to the webview so the breadcrumb can show "(loaded of discovered)" when the cap truncates
							let aggregate_total_discovered = 0;
							let aggregate_truncated = false;

							// shared per-file loader: parse the doc and post a merge update so the view fills in progressively
							// used by both the initial discovery and the file watcher
							const loadOne = async (uri: vscode.Uri) => {
								try {
									// respect the cap for watcher-driven adds too: never grow a new path past MAX_AGGREGATE_FILES (re-parses of already-loaded paths still pass)
									const already_loaded = Object.values(integration_docs).some(d => d.path === uri.path);
									if (!already_loaded && Object.keys(integration_docs).length >= MAX_AGGREGATE_FILES) {
										return;
									}
									const document = await vscode.workspace.openTextDocument(uri);
									const doc = await buildDoc(document);
									integration_docs[doc.id] = { ...doc, updateSentAt: new Date().toISOString() };
									webviewPanel.webview.postMessage({
										type: 'update',
										partial: { docs: { [doc.id]: integration_docs[doc.id] } },
										merge_strategy: 'merge',
										workspace_root,
										extension_version,
										aggregate_total_discovered,
										aggregate_truncated,
										aggregate_include: integration_include,
										aggregate_exclude: integration_exclude,
									});
								} catch (err) {
									writeToErrorLog('setIntegration: failed to load doc', uri.path, err);
								}
							};

							// phase 1: discover and load in parallel; each file streams its own merge update as it completes so a slow file never blocks the others - the view fills in over a few seconds rather than waiting on the whole batch
							// pass an explicit exclude (default skips derived/dependency dirs and overrides the user's files.exclude/search.exclude); an empty exclude becomes null so findFiles applies no exclusions at all
							const find_exclude = integration_exclude.trim() === '' ? null : integration_exclude;
							const discovered = await vscode.workspace.findFiles(pattern, find_exclude);
							// deterministic order so the capped subset (and what the user sees) is stable across reloads
							const sorted_uris = [...discovered].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
							aggregate_total_discovered = sorted_uris.length;
							aggregate_truncated = sorted_uris.length > MAX_AGGREGATE_FILES;
							const uris = sorted_uris.slice(0, MAX_AGGREGATE_FILES);
							debug('setIntegration folder: %d discovered, loading %d (cap %d, truncated=%s) in %s', aggregate_total_discovered, uris.length, MAX_AGGREGATE_FILES, aggregate_truncated, folder_path);
							if (aggregate_truncated) {
								writeToLog('setIntegration folder cap hit', `discovered ${aggregate_total_discovered}, loading first ${MAX_AGGREGATE_FILES} of ${folder_path}`);
							}
							const load_promises = uris.map(loadOne);
							// once every load has settled, send a replace update with the canonical map
							// this prunes stale docs left over from a previous session's saved state that no longer exist in the folder
							Promise.allSettled(load_promises).then(() => {
								debug('setIntegration folder: load complete, %d docs', Object.keys(integration_docs).length);
								webviewPanel.webview.postMessage({
									type: 'update',
									partial: { docs: integration_docs },
									workspace_root,
									extension_version,
									aggregate_total_discovered,
									aggregate_truncated,
									aggregate_include: integration_include,
									aggregate_exclude: integration_exclude,
								});
							});

							// phase 2: watch the folder for incremental adds/edits/deletes
							integration_watcher = vscode.workspace.createFileSystemWatcher(pattern);
							integration_watcher.onDidCreate(loadOne);
							integration_watcher.onDidChange(loadOne);
							integration_watcher.onDidDelete(async (uri) => {
								try {
									// find the doc id for this path and drop it
									const id = await generateIdentifier(uri.path);
									if (integration_docs[id]) {
										delete integration_docs[id];
										// signal the webview to drop this doc — convention: send tombstone with empty content
										webviewPanel.webview.postMessage({
											type: 'docDeleted',
											docId: id,
											docPath: uri.path,
										});
									}
								} catch (err) {
									writeToErrorLog('setIntegration watcher: delete failed', uri.path, err);
								}
							});
						} catch (err) {
							writeToErrorLog('setIntegration folder failed', folder_path, err);
						}
					} else if (mode === 'current_file') {
						// switching back to single-file mode — tear down any active watcher
						if (integration_watcher) {
							integration_watcher.dispose();
							integration_watcher = undefined;
						}
						integration_path = undefined;
						integration_include = DEFAULT_AGGREGATE_INCLUDE;
						integration_exclude = DEFAULT_AGGREGATE_EXCLUDE;
						for (const key of Object.keys(integration_docs)) { delete integration_docs[key]; }
						// re-resolve the active editor (it may have changed while in folder mode) and re-send just that file
						// integration_path is now unset so sendDoc posts merge_strategy=undefined (replace), pruning the stale aggregate docs
						try {
							const current_editor = vscode.window.activeTextEditor;
							if (current_editor?.document.uri.path.endsWith('.md')
								&& current_editor.document.uri.path !== active_path) {
								active_doc = await buildDoc(current_editor.document);
								active_path = current_editor.document.uri.path;
							}
							if (active_doc) {
								sendDoc(active_doc);
								sendCurrentSelection();
							}
						} catch (err) {
							writeToErrorLog('setIntegration current_file failed', '', err);
						}
					}
					// folder mode: integration_path is now set so this disposes any active-file watcher; current_file mode: integration_path is now undefined so this arms one if the active file has no visible editor
					syncActiveFileWatcher();
					return;
				}
				case 'editText': {
					const doc_path = e.docPath as string;
					const changes = e.changes as Array<{from: number; to?: number; insert: string}>;
					try {
						// webview-supplied paths are untrusted: only allow edits to .md files inside the workspace
						if (!doc_path || !isWithinWorkspace(doc_path, { requireExtension: '.md' })) {
							writeToErrorLog('editText: path outside workspace, refusing', doc_path);
							return;
						}
						const uri = vscode.Uri.file(doc_path);
						const document = await vscode.workspace.openTextDocument(uri);
						const doc_length = document.getText().length;

						// validate all change offsets before applying
						for (const change of changes) {
							const to = change.to ?? change.from;
							if (change.from < 0 || to < 0 || change.from > doc_length || to > doc_length || change.from > to) {
								writeToErrorLog('editText: invalid offsets, skipping',
									`from=${change.from} to=${to} len=${doc_length} insert="${change.insert}"`);
								return;
							}
						}

						writeToLog('editText', `${changes.length} changes on ${doc_path} (len=${doc_length})`);
						for (const change of changes) {
							const ctx = document.getText().slice(Math.max(0, change.from - 10), (change.to ?? change.from) + 10);
							writeToLog('editText', `from=${change.from} to=${change.to} insert="${change.insert}" ctx="${ctx}"`);
						}

						// apply changes end-to-start to preserve offsets
						const sorted_changes = [...changes].sort((a, b) => (b.from) - (a.from));

						// Prefer editing through an existing visible editor (never spawn a new one)
						const existing = vscode.window.visibleTextEditors.find(
							ed => ed.document.uri.path === doc_path
						);
						if (existing) {
							await existing.edit(editBuilder => {
								for (const change of sorted_changes) {
									const from = document.positionAt(change.from);
									const to = change.to !== undefined ? document.positionAt(change.to) : from;
									if (change.to !== undefined) {
										editBuilder.replace(new vscode.Range(from, to), change.insert);
									} else {
										editBuilder.insert(from, change.insert);
									}
								}
							});
						} else {
							// No visible editor - apply edits via WorkspaceEdit (never opens a new editor)
							const wsEdit = new vscode.WorkspaceEdit();
							for (const change of sorted_changes) {
								const from = document.positionAt(change.from);
								const to = change.to !== undefined ? document.positionAt(change.to) : from;
								if (change.to !== undefined) {
									wsEdit.replace(uri, new vscode.Range(from, to), change.insert);
								} else {
									wsEdit.insert(uri, from, change.insert);
								}
							}
							await vscode.workspace.applyEdit(wsEdit);
						}
						// bypass debounce: immediately re-parse and send the updated doc
						// (the edit above already fired onDidChangeTextDocument which set a
						// debounce timer - clear it to avoid a redundant delayed update)
						if (change_timer) { clearTimeout(change_timer); change_timer = undefined; }
						const edited_document = existing?.document ?? document;
						const edited_doc = await buildDoc(edited_document);
						if (edited_document.uri.path === active_path) {
							active_doc = edited_doc;
							sendDoc(active_doc);
							sendCurrentSelection();
						} else {
							// aggregate mode (or background) edit: route the updated doc through sendDoc so the merge strategy is applied correctly
							sendDoc(edited_doc);
						}
					} catch (err) {
						writeToErrorLog('editText failed', doc_path, err);
					}
					return;
				}
				case 'openExternal': {
					const url = e.url as string;
					if (url) {
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
					return;
				}
				case 'renderError': {
					writeToErrorLog('webview render error', e.message as string, e.stack as string);
					return;
				}
			} } catch (err) {
				writeToErrorLog('onDidReceiveMessage failed', e?.type, err);
			}
		});

		// track text editor selection changes - debounced to avoid flooding the webview
		let selection_timer: ReturnType<typeof setTimeout> | undefined;
		const selectionSubscription = vscode.window.onDidChangeTextEditorSelection(e => {
			if (e.textEditor.document.uri.path !== active_path) { return; }
			// suppress selection while a document change is pending - the change
			// handler sends selection after re-parse to keep MDAST and caret in sync
			if (change_timer) { return; }
			if (selection_timer) { clearTimeout(selection_timer); }
			selection_timer = setTimeout(() => {
				const selection = e.selections[0];
				const head = e.textEditor.document.offsetAt(selection.active);
				const anchor = e.textEditor.document.offsetAt(selection.anchor);
				sendSelection(e.textEditor.document.uri.path, head, anchor);
			}, SELECTION_DEBOUNCE_MS);
		});

		// clean up all listeners when the editor is closed
		webviewPanel.onDidDispose(() => {
			if (this.activePanel === webviewPanel) {
				this.activePanel = undefined;
			}
			if (change_timer) { clearTimeout(change_timer); }
			if (selection_timer) { clearTimeout(selection_timer); }
			if (integration_watcher) { integration_watcher.dispose(); integration_watcher = undefined; }
			if (active_file_watcher) { active_file_watcher.dispose(); active_file_watcher = undefined; }
			changeDocumentSubscription.dispose();
			activeEditorSubscription.dispose();
			visibleEditorsSubscription.dispose();
			selectionSubscription.dispose();
			configSubscription.dispose();
		});
	}

	/**
	 * resolveCustomTextEditor
	 * called when file is right clicked, then "Open With..." NoteThink
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		return this.myWebviewPanel(webviewPanel, document);
	}

	/**
	 * getHtmlForWebview
	 * get the static HTML used for the editor webviews
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		const clientDistDirectory = 'client/webview/dist';
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, clientDistDirectory, 'index.js'));

		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>NoteThink</title>
			</head>
			<body>
				<div id="root"></div>
				<script nonce="${nonce}">
					(function() {
						// Disable React 19's component Performance Track by removing performance.measure
						// BEFORE the webview bundle loads. React's supportsUserTiming flag is evaluated
						// once at module-load time via "typeof performance.measure === 'function'"; when
						// that is false, React skips the entire per-fiber instrumentation path - no
						// addObjectDiffToProperties props-diff build, no reusable-options allocation, no
						// measure() call. Without this, a large document (e.g. a 5000+ list-item kanban
						// → 50000+ fibers per commit) fills the browser's performance entry buffer within
						// a single commit, and either throws DataCloneError mid-commit or drives the
						// renderer into OOM. A previous attempt wrapped measure() with catch+retry, but
						// React's diff-build ran anyway and the renderer still crashed with the same
						// heap-saturated content from oma's done.md. The only effective fix is to turn
						// the feature off at source. reportWebVitals() in this webview is a no-op (no
						// callback is passed from index.tsx) and no other bundle code depends on
						// performance.measure for correctness.
						try {
							if (typeof performance !== 'undefined') {
								performance.measure = undefined;
							}
						} catch (e) {
							// performance.measure non-writable - leave it alone
						}
						// early-acquire API and expose on window so ExtensionReceiver.tsx can reuse it;
						// guard with try/catch in case the webview is restored from cache (acquireVsCodeApi throws on second call)
						try {
							if (!window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi = acquireVsCodeApi();
							}
						} catch(e) {
							// already acquired - reuse existing instance
						}
						// capture uncaught errors that escape React ErrorBoundary
						window.onerror = function(msg, source, line, col, error) {
							if (window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi.postMessage({ type: 'renderError', message: String(msg), stack: error ? error.stack : source + ':' + line });
							}
							console.error('[NoteThink] uncaught error:', msg, source, line);
						};
						window.onunhandledrejection = function(event) {
							var reason = event.reason;
							if (window.__notethinkVscodeApi) {
								window.__notethinkVscodeApi.postMessage({ type: 'renderError', message: String(reason), stack: reason && reason.stack ? reason.stack : '' });
							}
							console.error('[NoteThink] unhandled rejection:', reason);
						};
					})();
					var exports = {};
				</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

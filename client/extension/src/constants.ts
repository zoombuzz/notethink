/*
 * hard cap on files loaded+parsed into a single folder view
 * without it, selecting a large root (~600+ .md files) fans out one openTextDocument+parse+postMessage per file and re-runs mergeAggregateRoot on every message, saturating IPC and pinning the renderer ("window not responding")
 */
export const MAX_AGGREGATE_FILES = 200;

// default folder-mode filters; overridable per-view from the Files drawer (setIntegration include/exclude)
export const DEFAULT_INCLUDE_FILTER = '**/*.md';

/*
 * skip standard derived/dependency directories whose .md files (readmes, changelogs) would otherwise flood the folder view; the user may override or clear this from the Files drawer
 * .claude is in here because agent worktrees under .claude/worktrees/ mirror the repo tree and would otherwise duplicate every story
 * notegit/nodejs is the only multi-segment entry - it's notegit's bundled Node runtime, matched as a literal path inside the brace alternation
 * every entry is anchored at the WORKSPACE ROOT: excludes are matched against the workspace-root-relative path (PanelSession.toWorkspaceRelative), which is what keeps a multi-segment entry matching when the board is rooted on notegit itself
 */
export const DEFAULT_EXCLUDE_FILTER = '**/{node_modules,notegit/nodejs,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage,vendored}/**';

// default kanban column order; columns not in the user's data are culled, so the list is just an ordering hint. Keep in lockstep with package.json's notethink.settings.view.specific.kanban.columnOrder default
export const DEFAULT_COLUMN_ORDER: string[] = ['untagged', 'doing', 'code-review', 'testing', 'done'];

// mirror of the IntegrationMode values from notethink-views (client/webview/src/notethink-views/src/components/views/ViewIntegrationSelector.tsx); these are wire-format strings on the `setIntegration` message and must stay byte-identical with the webview side
export const INTEGRATION_MODE_CURRENT_FILE = 'current_file';
export const INTEGRATION_MODE_FOLDER = 'folder';

// custom-editor viewType registered for the NoteThink board; the single source of truth so the reveal path can tell our own board tabs apart from real text-editor tabs sharing the same file uri
export const NOTETHINK_VIEW_TYPE = 'notethink.viewer';

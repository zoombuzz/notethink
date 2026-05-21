// hard cap on files loaded+parsed into a single folder view
// without it, selecting a large root (~600+ .md files) fans out one openTextDocument+parse+postMessage per file and re-runs mergeAggregateRoot on every message, saturating IPC and pinning the renderer ("window not responding")
export const MAX_AGGREGATE_FILES = 200;

// default folder-mode filters; overridable per-view from the Files drawer (setIntegration include/exclude)
export const DEFAULT_INCLUDE_FILTER = '**/*.md';

// skip standard derived/dependency directories whose .md files (readmes, changelogs) would otherwise flood the folder view; the user may override or clear this from the Files drawer. .claude is in here because agent worktrees under .claude/worktrees/ mirror the repo tree and would otherwise duplicate every story
export const DEFAULT_EXCLUDE_FILTER = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';

// default kanban column order for folder mode; columns not in the user's data are culled, so the list is just an ordering hint. Keep in lockstep with package.json's notethink.folderView.columnOrder default
export const DEFAULT_FOLDER_VIEW_COLUMN_ORDER: string[] = ['untagged', 'doing', 'code-review', 'testing', 'done'];

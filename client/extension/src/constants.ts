// hard cap on files loaded+parsed into a single folder aggregate
// without it, selecting a large root (~600+ .md files) fans out one openTextDocument+parse+postMessage per file and re-runs mergeAggregateRoot on every message, saturating IPC and pinning the renderer ("window not responding")
export const MAX_AGGREGATE_FILES = 200;

// default aggregate filters; overridable per-view from the Files drawer (setIntegration include/exclude)
export const DEFAULT_AGGREGATE_INCLUDE = '**/*.md';

// skip standard derived/dependency directories whose .md files (readmes, changelogs) would otherwise flood the aggregate view; the user may override or clear this from the Files drawer. .claude is in here because agent worktrees under .claude/worktrees/ mirror the repo tree and would otherwise duplicate every story
export const DEFAULT_AGGREGATE_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';

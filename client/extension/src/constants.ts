import type { GroupDisplayEntry } from './lib/settings';

/*
 * Hard cap on files loaded and parsed into one folder view. Past it, a large root fans out one
 * open+parse+postMessage cycle per file and re-runs mergeAggregateRoot on every message, saturating
 * IPC and pinning the renderer.
 */
export const MAX_AGGREGATE_FILES = 200;

// default folder-mode filters; overridable per-view from the Files drawer (setIntegration include/exclude)
export const DEFAULT_INCLUDE_FILTER = '**/*.md';

/*
 * Skip standard derived/dependency directories whose markdown files would flood the folder view,
 * overridable per-view from the Files drawer. `.claude` is included because agent worktrees mirror
 * the repo tree and would otherwise duplicate every story. `notegit/nodejs`, notegit's bundled Node
 * runtime, is the only multi-segment entry, matched literally. Every entry is anchored at the
 * workspace root (PanelSession.toWorkspaceRelative), so it still matches when rooted on notegit itself.
 */
export const DEFAULT_EXCLUDE_FILTER = '**/{node_modules,notegit/nodejs,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage,vendored}/**';

// ordering and visibility hint only: lanes absent from the data are culled; mirrors package.json's kanban groupDisplay
export const DEFAULT_GROUP_DISPLAY: GroupDisplayEntry[] = [
    { value: 'untagged', shown: true },
    { value: 'doing', shown: true },
    { value: 'code-review', shown: true },
    { value: 'testing', shown: true },
    { value: 'done', shown: true },
];

// wire-format strings for the `setIntegration` message; mirrored byte-identical with notethink-views' IntegrationMode
export const INTEGRATION_MODE_CURRENT_FILE = 'current_file';
export const INTEGRATION_MODE_FOLDER = 'folder';

// viewType for the NoteThink board; lets the reveal path tell our board tabs from text-editor tabs on the same uri
export const NOTETHINK_VIEW_TYPE = 'notethink.viewer';

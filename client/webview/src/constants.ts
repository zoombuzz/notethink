// webview-side mirror of the extension's folder-mode filter defaults (see client/extension/src/constants.ts); used until the extension echoes the effective globs back through the first update message
export const DEFAULT_INCLUDE_FILTER = '**/*.md';
export const DEFAULT_EXCLUDE_FILTER = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';

// webview-only cap on top-level stories taken per source file when merging; not round-tripped to the extension
export const DEFAULT_MAX_NOTES_PER_FILE = 10;

// mirror of client/extension/src/constants.ts; the cascade and the package.json default must match this
export const DEFAULT_FOLDER_VIEW_COLUMN_ORDER: string[] = ['untagged', 'doing', 'code-review', 'testing', 'done'];

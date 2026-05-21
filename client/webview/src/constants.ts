// webview-side mirror of the extension's aggregate-filter defaults (see client/extension/src/constants.ts); used until the extension echoes the effective globs back through the first update message
export const DEFAULT_AGGREGATE_INCLUDE = '**/*.md';
export const DEFAULT_AGGREGATE_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';

// webview-only cap on top-level stories taken per source file when merging the aggregate; not round-tripped to the extension
export const DEFAULT_AGGREGATE_MAX_NOTES_PER_FILE = 10;

import { DEFAULT_CARD_RATIO } from './notethink-views/src/components/views/kanban/columnwidthops';
import type { SettingsCascadePayload } from './notethink-views/src/types/Messages';

// webview-side mirror of the extension's folder-mode filter defaults (see client/extension/src/constants.ts); used until the extension echoes the effective globs back through the first update message
export const DEFAULT_INCLUDE_FILTER = '**/*.md';
export const DEFAULT_EXCLUDE_FILTER = '**/{node_modules,notegit/nodejs,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage,vendored}/**';

// webview-only cap on top-level stories taken per source file when merging; not round-tripped to the extension
export const DEFAULT_MAX_NOTES_PER_FILE = 10;

// mirror of client/extension/src/constants.ts; the cascade and the package.json default must match this
export const DEFAULT_COLUMN_ORDER: string[] = ['untagged', 'doing', 'code-review', 'testing', 'done'];

/**
 * The settings the webview renders from until the extension's first settingsCascade arrives.
 *
 * Every value mirrors the built-in default of the matching SETTINGS entry in
 * client/extension/src/lib/settings.ts, which is the single source of truth. The extension and the
 * webview are separate webpack bundles with no shared module graph, so this copy is the wire
 * contract rather than a second opinion - keep it in lockstep with SETTINGS and with the
 * package.json contributions those defaults are declared in.
 *
 * The three aggregates describe an untouched workspace: nothing diverges from its saved default and
 * nothing sits at either configuration scope, so both reset actions render disabled until the real
 * cascade lands.
 */
export const DEFAULT_SETTINGS_CASCADE: SettingsCascadePayload = {
    viewType: 'auto',
    cardType: 'auto',
    viewUserTypes: [],
    showLinetagsInHeadlines: false,
    scrollNoteIntoView: true,
    autoExpandFocusedNote: false,
    showLineNumbers: false,
    groupBy: 'auto',
    orientation: 'columns',
    kanbanGroupBy: 'auto',
    columnOrder: DEFAULT_COLUMN_ORDER,
    kanbanCardRatio: DEFAULT_CARD_RATIO,
    kanbanAnimateTransitions: true,
    watchUnopenedFilesInViewer: true,
    openNewEditorIfNoneOpen: false,
    includeFilter: DEFAULT_INCLUDE_FILTER,
    excludeFilter: DEFAULT_EXCLUDE_FILTER,
    maxNotesPerFile: DEFAULT_MAX_NOTES_PER_FILE,
    diverged: [],
    hasWorkspaceOverrides: false,
    hasAnyOverrides: false,
};

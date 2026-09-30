/**
 * Message types for extension <-> webview communication.
 *
 * postMessage carries view→host dispatches; selectionChanged carries the host's editor selection into ViewContext.
 */

import type { IntegrationMode } from './IntegrationMode';

// webview -> Extension messages

export interface RevealRangeMessage {
    type: 'revealRange';
    docId: string;
    docPath: string;
    from: number;
    to?: number;
    forceOpen?: boolean;
}

export interface SelectRangeMessage {
    type: 'selectRange';
    docId: string;
    docPath: string;
    from: number;
    to: number;
    forceOpen?: boolean;
}

export interface EditTextChange {
    from: number;
    to?: number;
    insert: string;
}

/**
 * Webview -> extension request to apply text changes to one or more docs; exactly one of `changes`
 * (paired with `docPath`) or `changes_by_doc` is set.
 * - single-doc: `docPath` + `changes` set. The legacy shape, used for kanban reorders within one file.
 * - multi-doc: `changes_by_doc` set (keyed by `docPath`). Used for folder-mode reorders spanning files;
 *   each entry applies independently, so a failure on one doc does not abort the batch.
 */
export interface EditTextMessage {
    type: 'editText';
    docId?: string;
    docPath?: string;
    changes?: EditTextChange[];
    changes_by_doc?: Record<string, EditTextChange[]>;
}

export interface OpenExternalMessage {
    type: 'openExternal';
    url: string;
}

/**
 * Webview -> extension request to open a relative .md link. The extension resolves `href` against
 * the active document's URI, validates workspace containment and the .md extension, then opens the
 * target beside the panel.
 */
export interface OpenRelativeMessage {
    type: 'openRelative';
    href: string;
}

/**
 * Per-key write to a setting. Scope defaults to 'workspace' on the extension side when omitted,
 * falling back to the user scope in a folderless window where a workspace write throws; 'global'
 * is the promote path. This is the only message that writes a setting; there is no second
 * channel for a subset of keys.
 */
export interface UpdateSettingMessage {
    type: 'updateSetting';
    setting: SettingsCascadeKey;
    value: unknown;
    scope?: 'workspace' | 'global';
}

/**
 * Promotes every currently-resolved cascade setting into User scope, then clears the Workspace
 * overrides so the cascade reads from User next time.
 */
export interface PromoteSettingsToUserMessage {
    type: 'promoteSettingsToUser';
}

/**
 * Clears every Workspace-scope cascade override so the cascade falls back to User (or the built-in
 * default if no User override exists).
 */
export interface ResetSettingsToDefaultMessage {
    type: 'resetSettingsToDefault';
}

/**
 * Clears every Workspace- and User-scope cascade override so the cascade falls back to the built-in
 * (package.json) defaults; the recovery path when both have been edited away (e.g. a wiped exclude
 * filter the user can't reconstruct by hand).
 */
export interface RestoreSettingsToBuiltinDefaultMessage {
    type: 'restoreSettingsToBuiltinDefault';
}

/**
 * Webview -> extension request for the jump targets (folders/files) reachable from the breadcrumb
 * terminal leaf. The extension replies asynchronously with a JumpTargetsMessage carrying the same
 * mode/path so the webview can correlate the response.
 */
export interface RequestJumpTargetsMessage {
    type: 'requestJumpTargets';
    mode: IntegrationMode;
    path: string;
}

/**
 * Webview -> extension request to open a file in the editor (e.g. a chosen jump target of kind 'file').
 */
export interface OpenFileMessage {
    type: 'openFile';
    path: string;
}

export type WebviewToExtensionMessage =
    | RevealRangeMessage
    | SelectRangeMessage
    | EditTextMessage
    | OpenExternalMessage
    | OpenRelativeMessage
    | UpdateSettingMessage
    | PromoteSettingsToUserMessage
    | ResetSettingsToDefaultMessage
    | RestoreSettingsToBuiltinDefaultMessage
    | RequestJumpTargetsMessage
    | OpenFileMessage;

// extension -> Webview messages

export interface UpdateMessage {
    type: 'update';
    partial: {
        docs: Record<string, unknown>;
    };
}

export interface SelectionChangedMessage {
    type: 'selectionChanged';
    docPath: string;
    selection: {
        head: number;
        anchor: number;
    };
}

export interface CommandMessage {
    type: 'command';
    command: 'setViewType' | 'navigate';
    viewType?: string;
    direction?: 'up' | 'down' | 'drillIn' | 'drillOut' | 'clearFocus';
}

/**
 * A view type the user minted by saving a change to a setting an ancestor owns. Mirrored from
 * UserViewTypeDef in client/extension/src/lib/settings.ts, which the webview cannot import - the two are
 * separate webpack bundles with no shared module graph, so this duplication is the wire contract.
 * - id: the registry node id, frozen once written
 * - label: what the tree shows
 * - parent: the built-in node it was saved from and inherits from
 * - overrides: the setting keys and values that distinguish it from that parent
 */
export interface UserViewType {
    id: string;
    label: string;
    parent: string;
    overrides: Record<string, unknown>;
}

/**
 * Resolved values for every notethink setting, sent on requestInitialState and whenever any underlying
 * key changes. It is the only channel carrying a setting into the webview, with no per-session tier
 * layered over it.
 * - diverged: keys whose resolved value differs from their saved default; drives the drawer's M markers
 *   and diverged count, emptying when the user saves or reverts the defaults
 * - hasWorkspaceOverrides: true iff a key has a Workspace-scope value; drives "Revert to defaults"
 * - hasAnyOverrides: true iff a key has a Workspace- or User-scope value; drives whether the built-in
 *   restore is enabled, since there is nothing to restore when everything is already at built-in defaults
 *
 * Settings identifiers stay camelCase end-to-end (TS keys, wire IDs, payload fields, VS Code config
 * paths), unlike the project-wide snake_case wire convention, since bridging the two cases would mean
 * every setting carries two names.
 */
export interface SettingsCascadePayload {
    viewType: string;
    cardType: string;
    viewUserTypes: UserViewType[];
    showLinetagsInHeadlines: boolean;
    scrollNoteIntoView: boolean;
    autoExpandFocusedNote: boolean;
    showLineNumbers: boolean;
    groupBy: string;
    orientation: 'columns' | 'rows';
    lineBreadth: number;
    kanbanGroupBy: string;
    columnOrder: string[];
    kanbanCardRatio: number;
    kanbanAnimateTransitions: boolean;
    kanbanDefaultCardType: string;
    watchUnopenedFilesInViewer: boolean;
    openNewEditorIfNoneOpen: boolean;
    includeFilter: string;
    excludeFilter: string;
    maxNotesPerFile: number;
    diverged: string[];
    hasWorkspaceOverrides: boolean;
    hasAnyOverrides: boolean;
}

export type SettingsCascadeKey = Exclude<keyof SettingsCascadePayload, 'diverged' | 'hasWorkspaceOverrides' | 'hasAnyOverrides'>;

export interface SettingsCascadeMessage {
    type: 'settingsCascade';
    settings: SettingsCascadePayload;
}

/**
 * Extension-driven signal that a unit of work the user is waiting on has started or finished.
 * Routed into the pending-work hook keyed by `key` (opaque; 'folderDiscovery' is a well-known
 * value), whose delay-then-show policy keeps a fast operation from visibly flashing. `on` marks
 * pending (`true`) or clears it (`false`); fields stay camelCase, matching the other
 * extension-to-webview message types.
 */
export interface PendingChangeMessage {
    type: 'pendingChange';
    key: string;
    on: boolean;
}

/**
 * One reachable jump target from the breadcrumb terminal leaf.
 * - kind discriminates a directory ('folder') from a leaf file ('file'); the webview opens a file target via OpenFileMessage and descends a folder target via setIntegration
 */
export interface JumpTarget {
    label: string;
    path: string;
    kind: 'folder' | 'file';
}

/**
 * Extension -> webview async reply to RequestJumpTargetsMessage, carrying the originating mode/path
 * back so the webview can match the response to the request that triggered it.
 */
export interface JumpTargetsMessage {
    type: 'jumpTargets';
    mode: IntegrationMode;
    path: string;
    entries: JumpTarget[];
}

export type ExtensionToWebviewMessage =
    | UpdateMessage
    | SelectionChangedMessage
    | CommandMessage
    | SettingsCascadeMessage
    | PendingChangeMessage
    | JumpTargetsMessage;

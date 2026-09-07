/**
 * Message types for extension <-> webview communication.
 *
 * postMessage carries view→host dispatches; selectionChanged carries the host's editor selection into ViewContext.
 */

import type { IntegrationMode } from './IntegrationMode';

// Webview -> Extension messages

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
 * webview -> extension request to apply text changes to one or more docs.
 *
 * Two shapes are supported via a discriminator on the presence of `changes_by_doc`:
 * - single-doc: `docPath` + `changes` set, `changes_by_doc` omitted. The legacy shape used for kanban reorders that stay within a single file.
 * - multi-doc: `changes_by_doc` set (keyed by `docPath`), `docPath` + `changes` omitted. Used for folder-mode reorders that span multiple files; each entry is validated and applied independently and a failure on one doc does not abort the batch.
 *
 * exactly one of `changes` (paired with `docPath`) or `changes_by_doc` is set on any given message.
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
 * webview -> extension request to open a relative .md link clicked in the rendered view. The extension resolves `href` against the active document's URI (scheme-preserving), validates workspace containment + the .md extension, and opens the target beside the panel.
 */
export interface OpenRelativeMessage {
    type: 'openRelative';
    href: string;
}

/**
 * per-key write to a setting. Scope defaults to 'workspace' on the extension side when omitted (and falls back to the user scope in a folderless window, where a workspace write throws); 'global' is the promote path. This is the ONLY message that writes a setting - there is no second channel for a subset of keys.
 */
export interface UpdateSettingMessage {
    type: 'updateSetting';
    setting: SettingsCascadeKey;
    value: unknown;
    scope?: 'workspace' | 'global';
}

/**
 * promote every currently-resolved cascade setting into User scope, then clear the Workspace overrides so the cascade reads from User next time.
 */
export interface PromoteSettingsToUserMessage {
    type: 'promoteSettingsToUser';
}

/**
 * clear every Workspace-scope cascade override so the cascade falls back to User (or built-in default if no User override exists).
 */
export interface ResetSettingsToDefaultMessage {
    type: 'resetSettingsToDefault';
}

/**
 * clear every Workspace- AND User-scope cascade override so the cascade falls back to the extension's built-in (package.json) defaults. The recovery path when both the workspace and the user default have been edited away (e.g. a wiped exclude filter the user can't reconstruct by hand).
 */
export interface RestoreSettingsToBuiltinDefaultMessage {
    type: 'restoreSettingsToBuiltinDefault';
}

/**
 * webview -> extension request for the list of jump targets (folders/files) reachable from the breadcrumb terminal leaf. The extension replies asynchronously with a JumpTargetsMessage carrying the same mode/path so the webview can correlate the response.
 */
export interface RequestJumpTargetsMessage {
    type: 'requestJumpTargets';
    mode: IntegrationMode;
    path: string;
}

/**
 * webview -> extension request to open a file in the editor (e.g. a chosen jump target of kind 'file').
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

// Extension -> Webview messages

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
 * resolved values for every notethink setting. The extension reads each key via vscode.workspace.getConfiguration() (built-in default → User → Workspace) under `notethink.settings.*` and sends this payload on requestInitialState and whenever onDidChangeConfiguration fires for any of the underlying keys. It is the ONLY channel carrying a setting into the webview - the value the webview renders is this one, with no per-session tier layered over it.
 * - diverged: the keys whose resolved value differs from their saved default (the user-scope value when one is set, else the built-in default); drives the drawer's M markers and its diverged count, and empties when the user saves or reverts the defaults
 * - hasWorkspaceOverrides: true iff at least one key has a value at ConfigurationTarget.Workspace; drives whether "Revert to defaults" is enabled
 * - hasAnyOverrides: true iff at least one key has a value at ConfigurationTarget.Workspace OR ConfigurationTarget.Global (User); drives whether the Files drawer's built-in restore is enabled (nothing to restore when everything is already at built-in defaults)
 *
 * Settings identifiers are camelCase end-to-end (TS keys, wire IDs, payload field names, VS Code config paths) - see client/extension/src/lib/settings.ts. This deviates from the project-wide snake_case-for-wire-data-fields convention because settings have a unique cross-boundary identity, and bridging two cases would mean every setting carries two names.
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
    kanbanGroupBy: string;
    columnOrder: string[];
    kanbanCardRatio: number;
    kanbanAnimateTransitions: boolean;
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
 * extension-driven signal that some unit of work the user is waiting on has started or finished. Routed by the webview into the pending-work hook keyed by `key`; the spinner appears via the hook's delay-then-show policy after a short threshold so fast operations don't visibly flash. `key` is opaque (well-known values: 'folderDiscovery'); `on=true` marks pending, `on=false` clears it. Snake_case fields would be consistent with the rest of the wire format but `key`/`on` are short enough (and the camel-case message-type name `pendingChange` matches the existing extension-to-webview message naming convention) that this stays camelCase end-to-end like the settings messages
 */
export interface PendingChangeMessage {
    type: 'pendingChange';
    key: string;
    on: boolean;
}

/**
 * one reachable jump target from the breadcrumb terminal leaf.
 * - kind discriminates a directory ('folder') from a leaf file ('file'); the webview opens a file target via OpenFileMessage and descends a folder target via setIntegration
 */
export interface JumpTarget {
    label: string;
    path: string;
    kind: 'folder' | 'file';
}

/**
 * extension -> webview async reply to RequestJumpTargetsMessage. Carries the originating mode/path back so the webview can match the response to the request that triggered it.
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

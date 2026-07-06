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

export interface UpdateGlobalSettingMessage {
    type: 'updateGlobalSetting';
    setting: string;
    value: unknown;
}

/**
 * per-key write to a cascade setting. Scope defaults to 'workspace' on the extension side when omitted; 'global' is the promote path.
 */
export interface UpdateSettingMessage {
    type: 'updateSetting';
    setting: keyof SettingsCascadePayload;
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
    | UpdateGlobalSettingMessage
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
    command: 'setViewType' | 'toggleSetting' | 'navigate';
    viewType?: string;
    setting?: string;
    direction?: 'up' | 'down' | 'drillIn' | 'drillOut' | 'clearFocus';
}

// settings identifiers are camelCase end-to-end (TS keys, wire IDs, payload field names, VS Code config paths) - see client/extension/src/lib/settings.ts. This deviates from the project-wide snake_case-for-wire-data-fields convention because settings have a unique cross-boundary identity, and bridging two cases would mean every setting carries two names
export interface GlobalSettingsPayload {
    showLineNumbers: boolean;
    watchUnopenedFilesInViewer: boolean;
    kanbanAnimateTransitions: boolean;
    openNewEditorIfNoneOpen: boolean;
}

export type GlobalSettingKey = keyof GlobalSettingsPayload;

export interface GlobalSettingsMessage {
    type: 'globalSettings';
    settings: GlobalSettingsPayload;
}

/**
 * resolved values for the settings cascade. The extension reads each key via vscode.workspace.getConfiguration() (built-in default → User → Workspace) under `notethink.settings.*` and sends this payload on requestInitialState and whenever onDidChangeConfiguration fires for any of the underlying keys.
 * - hasWorkspaceOverrides: true iff at least one key has a value at ConfigurationTarget.Workspace; drives whether the "Reset to user default" button is enabled in the UI
 * - hasAnyOverrides: true iff at least one key has a value at ConfigurationTarget.Workspace OR ConfigurationTarget.Global (User); drives whether the "Reset to built-in default" button is enabled (nothing to restore when the cascade is already at built-in defaults)
 *
 * Settings identifiers are camelCase end-to-end (see client/extension/src/lib/settings.ts).
 */
export interface SettingsCascadePayload {
    viewType: 'auto' | 'document' | 'kanban';
    columnOrder: string[];
    includeFilter: string;
    excludeFilter: string;
    maxNotesPerFile: number;
    showContextBars: boolean;
    hasWorkspaceOverrides: boolean;
    hasAnyOverrides: boolean;
}

export type SettingsCascadeKey = Exclude<keyof SettingsCascadePayload, 'hasWorkspaceOverrides' | 'hasAnyOverrides'>;

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
    | GlobalSettingsMessage
    | SettingsCascadeMessage
    | PendingChangeMessage
    | JumpTargetsMessage;

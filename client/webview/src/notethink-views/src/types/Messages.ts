/**
 * Message types for extension <-> webview communication.
 *
 * postMessage replaces notegit's sync_view.dispatch().
 * selectionChanged replaces notegit's EditorSelection in ViewContext.
 */

// Webview -> Extension messages

export interface RevealRangeMessage {
    type: 'revealRange';
    docId: string;
    docPath: string;
    from: number;
    to?: number;
}

export interface SelectRangeMessage {
    type: 'selectRange';
    docId: string;
    docPath: string;
    from: number;
    to: number;
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

export interface UpdateGlobalSettingMessage {
    type: 'updateGlobalSetting';
    setting: string;
    value: unknown;
}

/**
 * per-key write to a folder-view setting. Scope defaults to 'workspace' on the extension side when omitted; 'global' is the promote path.
 */
export interface UpdateFolderViewSettingMessage {
    type: 'updateFolderViewSetting';
    setting: keyof FolderViewSettingsPayload;
    value: unknown;
    scope?: 'workspace' | 'global';
}

/**
 * promote every currently-resolved folder-view setting into User scope, then clear the Workspace overrides so the cascade reads from User next time.
 */
export interface PromoteFolderViewSettingsToUserMessage {
    type: 'promoteFolderViewSettingsToUser';
}

/**
 * clear every Workspace-scope folder-view override so the cascade falls back to User (or built-in default if no User override exists).
 */
export interface ResetFolderViewSettingsToDefaultMessage {
    type: 'resetFolderViewSettingsToDefault';
}

export type WebviewToExtensionMessage =
    | RevealRangeMessage
    | SelectRangeMessage
    | EditTextMessage
    | OpenExternalMessage
    | UpdateGlobalSettingMessage
    | UpdateFolderViewSettingMessage
    | PromoteFolderViewSettingsToUserMessage
    | ResetFolderViewSettingsToDefaultMessage;

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

export interface GlobalSettingsPayload {
    show_line_numbers: boolean;
    watch_unopened_files_in_viewer: boolean;
}

export type GlobalSettingKey = keyof GlobalSettingsPayload;

export interface GlobalSettingsMessage {
    type: 'globalSettings';
    settings: GlobalSettingsPayload;
}

/**
 * resolved cascade values for the folder-view settings. The extension reads each key via vscode.workspace.getConfiguration() (built-in default → User → Workspace) and sends this payload on requestInitialState and whenever onDidChangeConfiguration fires for any of the underlying keys.
 * - has_workspace_overrides: true iff at least one key has a value at ConfigurationTarget.Workspace; drives whether the Reset button is enabled in the UI
 */
export interface FolderViewSettingsPayload {
    view_type: 'auto' | 'document' | 'kanban';
    column_order: string[];
    include_filter: string;
    exclude_filter: string;
    max_notes_per_file: number;
    show_context_bars: boolean;
    has_workspace_overrides: boolean;
}

export type FolderViewSettingKey = Exclude<keyof FolderViewSettingsPayload, 'has_workspace_overrides'>;

export interface FolderViewSettingsMessage {
    type: 'folderViewSettings';
    settings: FolderViewSettingsPayload;
}

export type ExtensionToWebviewMessage =
    | UpdateMessage
    | SelectionChangedMessage
    | CommandMessage
    | GlobalSettingsMessage
    | FolderViewSettingsMessage;

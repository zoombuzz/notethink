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

export interface EditTextMessage {
    type: 'editText';
    docId: string;
    docPath: string;
    changes: EditTextChange[];
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

export type WebviewToExtensionMessage =
    | RevealRangeMessage
    | SelectRangeMessage
    | EditTextMessage
    | OpenExternalMessage
    | UpdateGlobalSettingMessage;

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
}

export interface GlobalSettingsMessage {
    type: 'globalSettings';
    settings: GlobalSettingsPayload;
}

export type ExtensionToWebviewMessage =
    | UpdateMessage
    | SelectionChangedMessage
    | CommandMessage
    | GlobalSettingsMessage;

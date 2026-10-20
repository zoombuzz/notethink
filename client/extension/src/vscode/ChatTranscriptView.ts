import * as vscode from 'vscode';
import { ACTIVITY_VENDOR_CLAUDE_CODE, ACTIVITY_VENDOR_CODEX, ACTIVITY_VENDOR_GROK } from '../types/AgentActivity';
import {
    chatTitle,
    chatVendorSupported,
    parseTranscriptTail,
    renderChatHtml,
    type ChatLabels,
    type ChatMessage,
} from '../lib/chatviewops';
import { getNonce } from '../lib/cryptoops';
import { writeToErrorLog } from '../lib/errorops';

const CHAT_VIEW_TYPE = 'notethink.agentChat';
const CHAT_VENDOR_LABELS: Record<string, string> = {
    [ACTIVITY_VENDOR_CLAUDE_CODE]: 'Claude Code',
    [ACTIVITY_VENDOR_CODEX]: 'Codex',
    [ACTIVITY_VENDOR_GROK]: 'Grok',
};

interface OpenChat {
    panel: vscode.WebviewPanel;
    transcript_uri: vscode.Uri;
    vendor: string;
}

/**
 * Read-only chat views for sessions with no vendor chat panel to open. One panel per session: opening
 * the same session again reveals and refreshes it. The transcript URI is handed in by the caller from
 * the analyser's scan, never from a webview message, and is read through `vscode.workspace.fs` so a
 * Remote-SSH window reads on the remote host.
 *
 * `vscode.workspace.fs` has no ranged read, so the whole file is read and only its tail is decoded
 * and parsed; the transfer is the cost the analyser's own scan already pays for the same file.
 */
export class ChatTranscriptViews {
    private readonly open_chats: Map<string, OpenChat> = new Map();

    constructor(private readonly openRaw: (session_id: string) => Promise<void>) {}

    /** opens or reveals the session's chat view in `column`, then (re)loads it; throws when the transcript cannot be read */
    public async show(session_id: string, vendor: string, transcript_uri: vscode.Uri, column: vscode.ViewColumn): Promise<void> {
        const messages = await this.load(vendor, transcript_uri);
        let chat = this.open_chats.get(session_id);
        if (chat) {
            chat.transcript_uri = transcript_uri;
            chat.panel.reveal(column, false);
        } else {
            const panel = vscode.window.createWebviewPanel(CHAT_VIEW_TYPE, session_id, { viewColumn: column, preserveFocus: false }, { enableScripts: true, enableCommandUris: false });
            chat = { panel, transcript_uri, vendor };
            this.open_chats.set(session_id, chat);
            panel.onDidDispose(() => { this.open_chats.delete(session_id); });
            panel.webview.onDidReceiveMessage((e: Record<string, unknown>) => { void this.handleMessage(session_id, e); });
        }
        this.render(session_id, chat, messages);
    }

    private async load(vendor: string, transcript_uri: vscode.Uri): Promise<ChatMessage[]> {
        if (!chatVendorSupported(vendor)) { return []; }
        const bytes = await vscode.workspace.fs.readFile(transcript_uri);
        return parseTranscriptTail(vendor, bytes);
    }

    private async handleMessage(session_id: string, e: Record<string, unknown>): Promise<void> {
        const chat = this.open_chats.get(session_id);
        if (!chat) { return; }
        try {
            if (e.type === 'openRaw') { await this.openRaw(session_id); }
            if (e.type === 'refresh') { this.render(session_id, chat, await this.load(chat.vendor, chat.transcript_uri)); }
        } catch (err) {
            writeToErrorLog('ChatTranscriptViews', `failed to handle ${String(e.type)} for session ${session_id}`, err);
        }
    }

    private render(session_id: string, chat: OpenChat, messages: ChatMessage[]): void {
        const title = chatTitle(messages, session_id);
        chat.panel.title = title;
        chat.panel.webview.html = renderChatHtml({
            nonce: getNonce(),
            title,
            vendor_label: CHAT_VENDOR_LABELS[chat.vendor] ?? chat.vendor,
            messages,
            supported: chatVendorSupported(chat.vendor),
            labels: chatLabels(),
        });
    }
}

function chatLabels(): ChatLabels {
    return {
        showing_last: vscode.l10n.t('Showing the last {0} messages', '{0}'),
        open_raw: vscode.l10n.t('Open raw transcript'),
        refresh: vscode.l10n.t('Refresh'),
        unsupported: vscode.l10n.t('This vendor\'s transcript cannot be rendered as a chat.'),
        empty: vscode.l10n.t('No conversation messages found in this transcript.'),
        tool_calls: vscode.l10n.t('{0} tool calls', '{0}'),
        no_result: vscode.l10n.t('No result in view'),
    };
}

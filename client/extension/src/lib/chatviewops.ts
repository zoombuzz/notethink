import {
    ACTIVITY_VENDOR_CLAUDE_CODE,
    ACTIVITY_VENDOR_CODEX,
} from '../types/AgentActivity';

/*
 * Pure helpers behind the read-only chat view that opens a session whose vendor has no chat panel of
 * its own to hand it to: decode only the tail of a transcript, parse that tail into a vendor-neutral
 * message list, and render the list as a self-contained HTML document. No vscode API, no I/O.
 * Every character of transcript content reaches the page through escapeHtml.
 */

export const CHAT_VIEW_MESSAGE_LIMIT = 50;
export const CHAT_VIEW_TAIL_START_BYTES = 512 * 1024;
export const CHAT_VIEW_TAIL_MAX_BYTES = 2 * 1024 * 1024;
const CHAT_TOOL_SUMMARY_MAX_CHARS = 120;
const CHAT_TOOL_RESULT_MAX_CHARS = 4000;
const CHAT_TITLE_MAX_CHARS = 60;
// a run of this many tool entries or more folds into one group
const CHAT_TOOL_GROUP_MIN = 3;
// inputs worth showing as the one-line summary of a tool call, in order of preference
const CHAT_TOOL_SUMMARY_KEYS = ['file_path', 'path', 'command', 'cmd', 'pattern', 'query', 'url', 'description', 'prompt'];
// user text that is the harness talking, not the person
const CHAT_NOISE_PREFIXES = ['<local-command', '<command-', '<system-reminder', '<environment_context', '<user_instructions', '<ide_'];

export type ChatMessageKind = 'user' | 'assistant' | 'tool';

/**
 * One displayable entry of a conversation.
 * - text: the prose of a user or assistant message; empty for a tool entry
 * - tool_name: the tool a tool entry called; empty when only its result was in view
 * - tool_summary: a short one-line description of the call's input
 * - tool_result: the call's output as text, once paired; undefined when no result was in view
 * - tool_is_error: true when the result was marked as an error
 * - timestamp: the record's own ISO timestamp, when it carried one
 */
export interface ChatMessage {
    kind: ChatMessageKind;
    text: string;
    tool_name?: string;
    tool_summary?: string;
    tool_result?: string;
    tool_is_error?: boolean;
    timestamp?: string;
}

export interface ChatLabels {
    showing_last: string;
    open_raw: string;
    refresh: string;
    unsupported: string;
    empty: string;
    tool_calls: string;
    no_result: string;
}

export function chatVendorSupported(vendor: string): boolean {
    return vendor === ACTIVITY_VENDOR_CLAUDE_CODE || vendor === ACTIVITY_VENDOR_CODEX;
}

/**
 * Decodes the tail of a transcript's bytes: at most `max_bytes` from the end, with the partial first
 * line of a chunk that does not start at the file's start dropped, since it was cut mid-record.
 */
export function decodeTranscriptTail(bytes: Uint8Array, max_bytes: number): string {
    if (bytes.length <= max_bytes) { return new TextDecoder().decode(bytes); }
    const start = bytes.length - max_bytes;
    let first_line_start = start;
    // a chunk starting exactly after a newline begins on a whole line already
    if (bytes[start - 1] !== 0x0a) {
        const newline_at = bytes.indexOf(0x0a, start);
        first_line_start = newline_at === -1 ? bytes.length : newline_at + 1;
    }
    return new TextDecoder().decode(bytes.subarray(first_line_start));
}

/**
 * Widens the tail window from the start size up to the cap until `limit` messages are found or the
 * whole file has been decoded, and returns the messages of the narrowest window that sufficed.
 */
export function parseTranscriptTail(vendor: string, bytes: Uint8Array, limit: number = CHAT_VIEW_MESSAGE_LIMIT): ChatMessage[] {
    let window_bytes = CHAT_VIEW_TAIL_START_BYTES;
    for (;;) {
        const messages = parseChatMessages(vendor, decodeTranscriptTail(bytes, window_bytes), limit);
        const whole_file = window_bytes >= bytes.length;
        if (messages.length >= limit || whole_file || window_bytes >= CHAT_VIEW_TAIL_MAX_BYTES) { return messages; }
        window_bytes = Math.min(window_bytes * 2, CHAT_VIEW_TAIL_MAX_BYTES);
    }
}

function parseJsonLines(text: string): Array<Record<string, unknown>> {
    const records: Array<Record<string, unknown>> = [];
    for (const line of text.split('\n')) {
        if (line.trim().length === 0) { continue; }
        try {
            const value: unknown = JSON.parse(line);
            if (value && typeof value === 'object' && !Array.isArray(value)) { records.push(value as Record<string, unknown>); }
        } catch {
            // a torn or foreign line is skipped, never fatal
        }
    }
    return records;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function isNoiseText(text: string): boolean {
    const trimmed = text.trimStart();
    return CHAT_NOISE_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

function truncate(text: string, max_chars: number): string {
    return text.length > max_chars ? `${text.slice(0, max_chars - 1)}…` : text;
}

/** a one-line summary of a tool call's input: the first well-known key present, else the input as compact JSON */
export function summariseToolInput(input: unknown): string {
    if (typeof input === 'string') { return truncate(input.replace(/\s+/g, ' ').trim(), CHAT_TOOL_SUMMARY_MAX_CHARS); }
    const record = asRecord(input);
    if (!record) { return ''; }
    for (const key of CHAT_TOOL_SUMMARY_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) { return truncate(value.replace(/\s+/g, ' ').trim(), CHAT_TOOL_SUMMARY_MAX_CHARS); }
    }
    const json = JSON.stringify(record);
    return json === '{}' ? '' : truncate(json, CHAT_TOOL_SUMMARY_MAX_CHARS);
}

// a tool result's content is a string, or an array of blocks of which only the text ones are shown
function resultText(content: unknown): string {
    if (typeof content === 'string') { return content; }
    if (!Array.isArray(content)) { return ''; }
    const parts: string[] = [];
    for (const block of content) {
        const record = asRecord(block);
        if (record && typeof record.text === 'string') { parts.push(record.text); }
    }
    return parts.join('\n');
}

/**
 * Parses transcript text into the last `limit` conversation entries. Claude Code and Codex are
 * supported; any other vendor yields an empty list. Torn lines and harness noise records are skipped,
 * and a tool call is paired with its result by id so the two read as one entry.
 */
export function parseChatMessages(vendor: string, text: string, limit: number = CHAT_VIEW_MESSAGE_LIMIT): ChatMessage[] {
    const records = parseJsonLines(text);
    let messages: ChatMessage[] = [];
    if (vendor === ACTIVITY_VENDOR_CLAUDE_CODE) { messages = claudeMessages(records); }
    if (vendor === ACTIVITY_VENDOR_CODEX) { messages = codexMessages(records); }
    return messages.slice(-limit);
}

function claudeMessages(records: Array<Record<string, unknown>>): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const pending: Map<string, ChatMessage> = new Map();
    for (const record of records) {
        const type = asString(record.type);
        if ((type !== 'user' && type !== 'assistant') || record.isSidechain === true || record.isMeta === true) { continue; }
        const message = asRecord(record.message);
        if (!message) { continue; }
        const timestamp = asString(record.timestamp) || undefined;
        const content = message.content;
        const blocks: unknown[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
        for (const raw_block of blocks) {
            const block = asRecord(raw_block);
            if (!block) { continue; }
            const block_type = asString(block.type);
            if (block_type === 'text') {
                const block_text = asString(block.text);
                if (block_text.trim().length === 0 || (type === 'user' && isNoiseText(block_text))) { continue; }
                messages.push({ kind: type, text: block_text, timestamp });
            } else if (block_type === 'tool_use' && type === 'assistant') {
                const entry: ChatMessage = { kind: 'tool', text: '', tool_name: asString(block.name), tool_summary: summariseToolInput(block.input), timestamp };
                messages.push(entry);
                const id = asString(block.id);
                if (id) { pending.set(id, entry); }
            } else if (block_type === 'tool_result' && type === 'user') {
                const result = resultText(block.content);
                const entry = pending.get(asString(block.tool_use_id));
                if (entry) {
                    entry.tool_result = result;
                    entry.tool_is_error = block.is_error === true;
                } else {
                    messages.push({ kind: 'tool', text: '', tool_name: '', tool_result: result, tool_is_error: block.is_error === true, timestamp });
                }
            }
        }
    }
    return messages;
}

// codex wraps message text in typed content parts; only the text-bearing ones are read
function codexContentText(content: unknown): string {
    if (typeof content === 'string') { return content; }
    if (!Array.isArray(content)) { return ''; }
    const parts: string[] = [];
    for (const part of content) {
        const record = asRecord(part);
        if (record && typeof record.text === 'string') { parts.push(record.text); }
    }
    return parts.join('\n');
}

function codexMessages(records: Array<Record<string, unknown>>): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const pending: Map<string, ChatMessage> = new Map();
    for (const record of records) {
        if (asString(record.type) !== 'response_item') { continue; }
        const payload = asRecord(record.payload);
        if (!payload) { continue; }
        const timestamp = asString(record.timestamp) || undefined;
        const payload_type = asString(payload.type);
        if (payload_type === 'message') {
            const role = asString(payload.role);
            const message_text = codexContentText(payload.content);
            if ((role !== 'user' && role !== 'assistant') || message_text.trim().length === 0) { continue; }
            if (role === 'user' && isNoiseText(message_text)) { continue; }
            messages.push({ kind: role, text: message_text, timestamp });
        } else if (payload_type === 'function_call' || payload_type === 'custom_tool_call') {
            let input: unknown = payload.input ?? payload.arguments;
            if (typeof input === 'string' && payload_type === 'function_call') {
                try { input = JSON.parse(input); } catch { /* an unparseable argument string is summarised as the string it is */ }
            }
            const entry: ChatMessage = { kind: 'tool', text: '', tool_name: asString(payload.name), tool_summary: summariseToolInput(input), timestamp };
            messages.push(entry);
            const call_id = asString(payload.call_id);
            if (call_id) { pending.set(call_id, entry); }
        } else if (payload_type === 'function_call_output' || payload_type === 'custom_tool_call_output') {
            const output = payload.output;
            const result = typeof output === 'string' ? output : resultText(output);
            const entry = pending.get(asString(payload.call_id));
            if (entry) { entry.tool_result = result; } else { messages.push({ kind: 'tool', text: '', tool_name: '', tool_result: result, timestamp }); }
        }
    }
    return messages;
}

/** the title a session's view carries: its first user prompt, trimmed to one short line, else the fallback */
export function chatTitle(messages: ChatMessage[], fallback: string): string {
    const first_user = messages.find(message => message.kind === 'user');
    if (!first_user) { return fallback; }
    const one_line = first_user.text.replace(/\s+/g, ' ').trim();
    return one_line.length > 0 ? truncate(one_line, CHAT_TITLE_MAX_CHARS) : fallback;
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// inline code and bold over text that is already escaped; links stay as visible text
function renderInline(escaped: string): string {
    const parts = escaped.split('`');
    return parts.map((part, index) => {
        if (index % 2 === 1 && index < parts.length - 1) { return `<code>${part}</code>`; }
        // an unclosed backtick is literal text, restored here
        const literal = index % 2 === 1 ? `\`${part}` : part;
        return literal.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
    }).join('');
}

/**
 * A deliberately small markdown renderer: escapes everything first, then recognises code fences,
 * headings, bullet and numbered lists, paragraphs, inline code and bold. No raw HTML survives.
 */
export function renderMarkdownSafe(markdown: string): string {
    const out: string[] = [];
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let paragraph: string[] = [];
    let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;
    const flushParagraph = (): void => {
        if (paragraph.length > 0) { out.push(`<p>${paragraph.map(line => renderInline(escapeHtml(line))).join('<br>')}</p>`); }
        paragraph = [];
    };
    const flushList = (): void => {
        if (list) { out.push(`<${list.tag}>${list.items.map(item => `<li>${renderInline(escapeHtml(item))}</li>`).join('')}</${list.tag}>`); }
        list = undefined;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('```')) {
            flushParagraph();
            flushList();
            const code: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith('```')) { code.push(lines[i]); i++; }
            out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            out.push(`<p class="heading">${renderInline(escapeHtml(heading[2]))}</p>`);
        } else if (bullet || numbered) {
            flushParagraph();
            const tag = bullet ? 'ul' : 'ol';
            if (list && list.tag !== tag) { flushList(); }
            list = list ?? { tag, items: [] };
            list.items.push((bullet ?? numbered)![1]);
        } else if (line.trim().length === 0) {
            flushParagraph();
            flushList();
        } else {
            flushList();
            paragraph.push(line);
        }
    }
    flushParagraph();
    flushList();
    return out.join('');
}

// the date and minute of an ISO timestamp, as written, so the output does not depend on the machine's locale or zone
function shortTime(timestamp: string | undefined): string {
    if (!timestamp) { return ''; }
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(timestamp);
    return match ? `${match[1]} ${match[2]}` : '';
}

function renderToolEntry(message: ChatMessage, labels: ChatLabels): string {
    const name = escapeHtml(message.tool_name ?? '');
    const summary = escapeHtml(message.tool_summary ?? '');
    const head = `<span class="tool-name">${name}</span><span class="tool-summary">${summary}</span>`;
    const error_class = message.tool_is_error ? ' error' : '';
    if (message.tool_result === undefined) {
        return `<div class="tool${error_class}"><div class="tool-head">${head}<span class="tool-none">${escapeHtml(labels.no_result)}</span></div></div>`;
    }
    const result = truncate(message.tool_result, CHAT_TOOL_RESULT_MAX_CHARS);
    return `<details class="tool${error_class}"><summary>${head}</summary><pre>${escapeHtml(result)}</pre></details>`;
}

function renderMessages(messages: ChatMessage[], labels: ChatLabels): string {
    const html: string[] = [];
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.kind === 'tool') {
            let end = i;
            while (end < messages.length && messages[end].kind === 'tool') { end++; }
            const run = messages.slice(i, end);
            const entries = run.map(entry => renderToolEntry(entry, labels)).join('');
            html.push(run.length >= CHAT_TOOL_GROUP_MIN
                ? `<details class="toolgroup"><summary>${escapeHtml(labels.tool_calls.replace('{0}', String(run.length)))}</summary>${entries}</details>`
                : entries);
            i = end - 1;
            continue;
        }
        const time = shortTime(message.timestamp);
        const time_html = time ? `<div class="time">${escapeHtml(time)}</div>` : '';
        const body = message.kind === 'user'
            ? `<div class="body plain">${escapeHtml(message.text)}</div>`
            : `<div class="body">${renderMarkdownSafe(message.text)}</div>`;
        html.push(`<div class="msg ${message.kind}">${body}${time_html}</div>`);
    }
    return html.join('');
}

const CHAT_STYLE = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0 16px 24px; }
header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
header .title { font-weight: 600; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header .sub { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 4px 10px; border-radius: 2px; cursor: pointer; font: inherit; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
main { max-width: 900px; margin: 12px auto 0; }
.msg { margin: 10px 0; }
.msg.user .body { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; padding: 8px 12px; }
.msg .plain { white-space: pre-wrap; word-break: break-word; }
.msg .body p { margin: 0 0 8px; }
.msg .body p.heading { font-weight: 600; }
.msg .body ul, .msg .body ol { margin: 0 0 8px; padding-left: 22px; }
.msg .time { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 2px; opacity: 0.8; }
pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; margin: 6px 0; }
code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
pre code { padding: 0; background: none; }
.tool, .toolgroup { margin: 4px 0; font-size: 0.92em; color: var(--vscode-descriptionForeground); }
.tool summary, .toolgroup summary, .tool-head { cursor: pointer; display: flex; gap: 8px; overflow: hidden; white-space: nowrap; }
.tool-name { font-weight: 600; color: var(--vscode-foreground); }
.tool-summary { overflow: hidden; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family); }
.tool.error .tool-name { color: var(--vscode-errorForeground); }
.tool-name::before { content: '\\25CF'; margin-right: 6px; font-size: 0.75em; vertical-align: 1px; color: var(--vscode-charts-green, #89d185); }
.tool.error .tool-name::before { color: var(--vscode-errorForeground); }
.toolgroup > summary::before { content: '\\25B8'; }
.toolgroup[open] > summary::before { content: '\\25BE'; }
.toolgroup > .tool { margin-left: 16px; }
.notice { margin: 24px 0; color: var(--vscode-descriptionForeground); }
`;

/**
 * Builds the whole page. `nonce` gates the one inline script (two buttons posting to the extension,
 * and a scroll to the newest message, since the agents' own chats open at the bottom) and the style
 * block under a CSP that otherwise admits nothing.
 */
export function renderChatHtml(input: {
    nonce: string;
    title: string;
    vendor_label: string;
    messages: ChatMessage[];
    supported: boolean;
    labels: ChatLabels;
}): string {
    const { nonce, title, vendor_label, messages, supported, labels } = input;
    let main: string;
    let count_html = '';
    if (!supported) {
        main = `<p class="notice">${escapeHtml(labels.unsupported)}</p>`;
    } else if (messages.length === 0) {
        main = `<p class="notice">${escapeHtml(labels.empty)}</p>`;
    } else {
        main = renderMessages(messages, labels);
        count_html = `<span class="sub">${escapeHtml(labels.showing_last.replace('{0}', String(messages.length)))}</span>`;
    }
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`;
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title><style nonce="${nonce}">${CHAT_STYLE}</style></head>
<body><header><span class="title">${escapeHtml(title)}</span><span class="sub">${escapeHtml(vendor_label)}</span>${count_html}<button id="refresh">${escapeHtml(labels.refresh)}</button><button id="raw">${escapeHtml(labels.open_raw)}</button></header>
<main>${main}</main>
<script nonce="${nonce}">const vscode = acquireVsCodeApi(); window.scrollTo(0, document.body.scrollHeight); document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' })); document.getElementById('raw').addEventListener('click', () => vscode.postMessage({ type: 'openRaw' }));</script>
</body></html>`;
}

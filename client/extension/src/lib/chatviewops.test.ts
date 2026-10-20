import {
    CHAT_VIEW_MESSAGE_LIMIT,
    CHAT_VIEW_TAIL_START_BYTES,
    chatTitle,
    decodeTranscriptTail,
    escapeHtml,
    parseChatMessages,
    parseTranscriptTail,
    renderChatHtml,
    renderMarkdownSafe,
    summariseToolInput,
    type ChatLabels,
    type ChatMessage,
} from './chatviewops';

const LABELS: ChatLabels = {
    showing_last: 'Showing the last {0} messages',
    open_raw: 'Open raw transcript',
    refresh: 'Refresh',
    unsupported: 'cannot render',
    empty: 'nothing here',
    tool_calls: '{0} tool calls',
    no_result: 'no result',
};

function jsonl(...records: unknown[]): string {
    return records.map(record => JSON.stringify(record)).join('\n') + '\n';
}

function claudeUser(content: unknown, extra: Record<string, unknown> = {}): unknown {
    return { type: 'user', timestamp: '2026-09-22T10:00:00Z', message: { role: 'user', content }, ...extra };
}

function claudeAssistant(content: unknown[], extra: Record<string, unknown> = {}): unknown {
    return { type: 'assistant', timestamp: '2026-09-22T10:00:05Z', message: { role: 'assistant', content }, ...extra };
}

describe('parseChatMessages for Claude Code', () => {
    it('reads user and assistant text in order, with timestamps', () => {
        const messages = parseChatMessages('claude-code', jsonl(
            claudeUser('first prompt'),
            claudeAssistant([{ type: 'text', text: 'an answer' }]),
        ));
        expect(messages.map(message => [message.kind, message.text])).toEqual([['user', 'first prompt'], ['assistant', 'an answer']]);
        expect(messages[0].timestamp).toBe('2026-09-22T10:00:00Z');
    });

    it('skips sidechain, meta, snapshot, mode, prompt and attachment records and harness-written user text', () => {
        const messages = parseChatMessages('claude-code', jsonl(
            { type: 'file-history-snapshot', snapshot: {} },
            { type: 'permission-mode', permissionMode: 'default' },
            { type: 'last-prompt', lastPrompt: 'x' },
            { type: 'attachment', attachment: {} },
            claudeUser('sidechain text', { isSidechain: true }),
            claudeUser('meta text', { isMeta: true }),
            claudeUser('<command-name>/clear</command-name>'),
            claudeUser('<system-reminder>be good</system-reminder>'),
            claudeAssistant([{ type: 'thinking', thinking: 'private' }]),
            claudeUser('the real prompt'),
        ));
        expect(messages.map(message => message.text)).toEqual(['the real prompt']);
    });

    it('pairs a tool call with its result into one entry and summarises the input', () => {
        const messages = parseChatMessages('claude-code', jsonl(
            claudeAssistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la', description: 'list' } }]),
            claudeUser([{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'file.txt' }] }]),
        ));
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual(expect.objectContaining({ kind: 'tool', tool_name: 'Bash', tool_summary: 'ls -la', tool_result: 'file.txt' }));
    });

    it('keeps a result whose call fell outside the window as an entry of its own', () => {
        const messages = parseChatMessages('claude-code', jsonl(claudeUser([{ type: 'tool_result', tool_use_id: 'gone', content: 'late output', is_error: true }])));
        expect(messages).toEqual([expect.objectContaining({ kind: 'tool', tool_name: '', tool_result: 'late output', tool_is_error: true })]);
    });

    it('caps the list at the newest messages', () => {
        const records = Array.from({ length: CHAT_VIEW_MESSAGE_LIMIT + 20 }, (_, index) => claudeUser(`prompt ${index}`));
        const messages = parseChatMessages('claude-code', jsonl(...records));
        expect(messages).toHaveLength(CHAT_VIEW_MESSAGE_LIMIT);
        expect(messages[messages.length - 1].text).toBe(`prompt ${CHAT_VIEW_MESSAGE_LIMIT + 19}`);
        expect(messages[0].text).toBe('prompt 20');
    });

    it('skips a torn line rather than failing', () => {
        const text = `${JSON.stringify(claudeUser('kept'))}\n{"type":"user","mess`;
        expect(parseChatMessages('claude-code', text).map(message => message.text)).toEqual(['kept']);
    });
});

describe('parseChatMessages for Codex and other vendors', () => {
    it('reads messages and pairs function calls with their output', () => {
        const messages = parseChatMessages('codex', jsonl(
            { type: 'session_meta', payload: {} },
            { type: 'response_item', timestamp: '2026-09-22T10:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
            { type: 'response_item', timestamp: '2026-09-22T10:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do the thing' }] } },
            { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"command":"pwd"}' } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: '/ws' } },
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } },
        ));
        expect(messages.map(message => message.kind)).toEqual(['user', 'tool', 'assistant']);
        expect(messages[1]).toEqual(expect.objectContaining({ tool_name: 'shell', tool_summary: 'pwd', tool_result: '/ws' }));
    });

    it('yields nothing for a vendor it cannot render', () => {
        expect(parseChatMessages('grok', jsonl({ type: 'tool_started', tool_name: 'x' }))).toEqual([]);
    });
});

describe('decodeTranscriptTail and parseTranscriptTail', () => {
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

    it('returns a small file whole', () => {
        expect(decodeTranscriptTail(encode('a\nb\n'), 1024)).toBe('a\nb\n');
    });

    it('drops the partial first line of a chunk that starts mid-line', () => {
        expect(decodeTranscriptTail(encode('aaaa\nbbbb\ncccc\n'), 8)).toBe('cccc\n');
    });

    it('keeps the first line of a chunk that starts exactly on a line boundary', () => {
        expect(decodeTranscriptTail(encode('aaaa\nbbbb\ncccc\n'), 10)).toBe('bbbb\ncccc\n');
    });

    it('widens the window past the starting size when too few messages sit in it', () => {
        const filler = 'x'.repeat(CHAT_VIEW_TAIL_START_BYTES);
        const text = jsonl(claudeUser('early prompt'), claudeUser(filler), claudeUser('late prompt'));
        const messages = parseTranscriptTail('claude-code', encode(text));
        expect(messages.map(message => message.text.slice(0, 12))).toEqual(['early prompt', 'xxxxxxxxxxxx', 'late prompt']);
    });
});

describe('summariseToolInput and chatTitle', () => {
    it('prefers a well-known key and truncates a long value', () => {
        expect(summariseToolInput({ file_path: '/a/b.ts', other: 1 })).toBe('/a/b.ts');
        expect(summariseToolInput({ command: 'x'.repeat(500) }).length).toBeLessThanOrEqual(120);
        expect(summariseToolInput({ odd: 1 })).toBe('{"odd":1}');
    });

    it('titles a chat from its first prompt, else the fallback', () => {
        const messages: ChatMessage[] = [{ kind: 'assistant', text: 'hi' }, { kind: 'user', text: 'fix\nthe   bug' }];
        expect(chatTitle(messages, 'sid')).toBe('fix the bug');
        expect(chatTitle([], 'sid')).toBe('sid');
    });
});

describe('rendering', () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';

    it('escapes html', () => {
        expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });

    it('never lets raw html from a message, a tool or the title reach the page', () => {
        const html = renderChatHtml({
            nonce: 'abc',
            title: hostile,
            vendor_label: 'Claude Code',
            supported: true,
            labels: LABELS,
            messages: [
                { kind: 'user', text: hostile },
                { kind: 'assistant', text: `${hostile}\n\n\`\`\`\n${hostile}\n\`\`\`\n\n- ${hostile}\n\n**${hostile}** \`${hostile}\``, timestamp: '2026-09-22T10:00:00Z' },
                { kind: 'tool', text: '', tool_name: hostile, tool_summary: hostile, tool_result: hostile },
            ],
        });
        const body_without_ours = html.replace(/<script nonce="abc">[\s\S]*?<\/script>/, '');
        expect(body_without_ours).not.toContain('<script>');
        expect(body_without_ours).not.toContain('<img');
        expect(body_without_ours).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('carries a strict CSP bound to the nonce, the count line and both actions', () => {
        const html = renderChatHtml({ nonce: 'n0nce', title: 't', vendor_label: 'Codex', supported: true, labels: LABELS, messages: [{ kind: 'user', text: 'hi' }] });
        expect(html).toContain("default-src 'none'; style-src 'nonce-n0nce'; script-src 'nonce-n0nce'");
        expect(html).toContain('Showing the last 1 messages');
        expect(html).toContain('Open raw transcript');
        expect(html).toContain('id="refresh"');
    });

    it('renders markdown: fences, inline code, bold, lists, links as text', () => {
        const html = renderMarkdownSafe('# Head\n\nsome **bold** and `code` [link](http://example.test)\n\n- one\n- two\n\n```\nlet a = 1 < 2;\n```');
        expect(html).toContain('<p class="heading">Head</p>');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<code>code</code>');
        expect(html).toContain('link (http://example.test)');
        expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
        expect(html).toContain('<pre><code>let a = 1 &lt; 2;</code></pre>');
        expect(html).not.toContain('<a ');
    });

    it('folds a run of three tool calls into one group and shows a notice when unsupported or empty', () => {
        const tool: ChatMessage = { kind: 'tool', text: '', tool_name: 'Read', tool_summary: 'a', tool_result: 'r' };
        const grouped = renderChatHtml({ nonce: 'n', title: 't', vendor_label: 'v', supported: true, labels: LABELS, messages: [tool, tool, tool] });
        expect(grouped).toContain('3 tool calls');
        expect(renderChatHtml({ nonce: 'n', title: 't', vendor_label: 'v', supported: false, labels: LABELS, messages: [] })).toContain('cannot render');
        expect(renderChatHtml({ nonce: 'n', title: 't', vendor_label: 'v', supported: true, labels: LABELS, messages: [] })).toContain('nothing here');
    });
});

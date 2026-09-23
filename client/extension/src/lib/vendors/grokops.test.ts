import { buildGrokResult, parseGrokTranscript, readGrokSession } from './grokops';
import { AGENT_TRANSCRIPT_MAX_BYTES, type AgentSessionInput } from './agentvendorops';

const WINDOW_START_MS = Date.parse('2026-09-05T00:00:00.000Z');
const NOW_MS = Date.parse('2026-09-07T23:59:59.000Z');

interface BuildInputOptions {
    events?: object[];
    usage?: object;
    transcript?: { path: string; text: string };
    vendor_live?: boolean;
    now_ms?: number;
    window_start_ms?: number;
}

function buildInput(options: BuildInputOptions): AgentSessionInput {
    const events_text = (options.events ?? []).map((event) => JSON.stringify(event)).join('\n');
    const extra_files = options.usage ? [{ path: '/home/alex/.grok/sessions/x/y/usage.json', text: JSON.stringify(options.usage) }] : [];
    return {
        session_id: 'session-1',
        cwd: '/mnt/secure/home/alex/git/github.com/active_development/notethink',
        vendor_live: options.vendor_live ?? true,
        transcript: options.transcript ?? { path: '/home/alex/.grok/sessions/x/y/events.jsonl', text: events_text },
        extra_files,
        now_ms: options.now_ms ?? NOW_MS,
        window_start_ms: options.window_start_ms ?? WINDOW_START_MS,
    };
}

describe('readGrokSession', () => {
    it('reports the second, unmatched tool_started as current, the first pair having resolved', () => {
        const result = readGrokSession(buildInput({
            events: [
                { ts: '2026-09-07T14:19:53.408Z', type: 'tool_started', tool_name: 'run_terminal_command' },
                { ts: '2026-09-07T14:19:53.560Z', type: 'tool_completed', tool_name: 'run_terminal_command', outcome: 'error' },
                { ts: '2026-09-07T14:20:01.063Z', type: 'tool_started', tool_name: 'read_file' },
            ],
        }));
        expect(result.current).toEqual({ at: '2026-09-07T14:20:01.063Z', kind: 'tool_call', tool: 'read_file' });
        expect(result.question).toBeUndefined();
        expect(result.state).toBe('working');
    });

    it('reports waiting, not working, when a permission is pending alongside a pending tool call', () => {
        const result = readGrokSession(buildInput({
            events: [
                { ts: '2026-09-07T14:19:53.408Z', type: 'tool_started', tool_name: 'run_terminal_command' },
                { ts: '2026-09-07T14:19:53.409Z', type: 'permission_requested', tool_name: 'run_terminal_command' },
            ],
        }));
        expect(result.question).toEqual({
            question_id: 'run_terminal_command:2026-09-07T14:19:53.409Z',
            asked_at: '2026-09-07T14:19:53.409Z',
            prompt: 'Grant run_terminal_command permission?',
        });
        expect(result.state).toBe('waiting');
    });

    it('reports no question once the pending permission is resolved', () => {
        const result = readGrokSession(buildInput({
            events: [
                { ts: '2026-09-07T14:19:53.409Z', type: 'permission_requested', tool_name: 'run_terminal_command' },
                { ts: '2026-09-07T14:19:53.409Z', type: 'permission_resolved', tool_name: 'run_terminal_command', decision: 'allow' },
            ],
        }));
        expect(result.question).toBeUndefined();
    });

    it('keeps only the in-window turn from usage.json, and takes span_start_at from the true preceding turn regardless of window', () => {
        const result = readGrokSession(buildInput({
            events: [],
            usage: {
                turns: [
                    { turnNumber: 1, endedAt: '2026-09-01T00:00:00.000Z', modelUsage: { 'grok-4.5-build': { inputTokens: 100, outputTokens: 10, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, costUsdTicks: 0 } } },
                    { turnNumber: 2, endedAt: '2026-09-07T16:05:09.674Z', modelUsage: { 'grok-4.5-build': { inputTokens: 992273, outputTokens: 14201, cachedReadTokens: 708992, cacheCreationTokens: 0, reasoningTokens: 3532, costUsdTicks: 2939183040 } } },
                ],
            },
        }));
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].at).toBe('2026-09-07T16:05:09.674Z');
        expect(result.calls[0].span_start_at).toBe('2026-09-01T00:00:00.000Z');
    });

    it('carries the last turn\'s own modelUsage key as the session model, even a turn outside the window', () => {
        const result = readGrokSession(buildInput({
            events: [],
            usage: {
                turns: [
                    { turnNumber: 1, endedAt: '2026-09-01T00:00:00.000Z', modelUsage: { 'grok-4.5-build': { inputTokens: 100, outputTokens: 10, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, costUsdTicks: 0 } } },
                    { turnNumber: 2, endedAt: '2026-09-09T00:00:00.000Z', modelUsage: { 'grok-4.6': { inputTokens: 50, outputTokens: 5, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, costUsdTicks: 0 } } },
                ],
            },
        }));
        expect(result.model).toBe('grok-4.6');
    });

    it('carries no model when no usage.json was supplied', () => {
        const result = readGrokSession(buildInput({ events: [] }));
        expect(result.model).toBeUndefined();
    });

    it('never publishes vendor_cost_usd from costUsdTicks, since no source confirms its unit', () => {
        const result = readGrokSession(buildInput({
            events: [],
            usage: {
                turns: [
                    { turnNumber: 1, endedAt: '2026-09-07T16:05:09.674Z', modelUsage: { 'grok-4.5-build': { inputTokens: 992273, outputTokens: 14201, cachedReadTokens: 708992, cacheCreationTokens: 0, reasoningTokens: 3532, costUsdTicks: 2939183040 } } },
                ],
            },
        }));
        expect(result.calls[0].vendor_cost_usd).toBeUndefined();
    });

    it('folds reasoningTokens into output_tokens', () => {
        const result = readGrokSession(buildInput({
            events: [],
            usage: {
                turns: [
                    { turnNumber: 1, endedAt: '2026-09-07T16:05:09.674Z', modelUsage: { 'grok-4.5-build': { inputTokens: 992273, outputTokens: 14201, cachedReadTokens: 708992, cacheCreationTokens: 0, reasoningTokens: 3532, costUsdTicks: 2939183040 } } },
                ],
            },
        }));
        expect(result.calls[0].output_tokens).toBe(14201 + 3532);
    });

    it('returns an empty calls list, not a refusal, when no usage.json was supplied', () => {
        const result = readGrokSession(buildInput({ events: [{ ts: '2026-09-07T14:19:53.408Z', type: 'tool_started', tool_name: 'read_file' }] }));
        expect(result.calls).toEqual([]);
        expect(result.refusal).toBeUndefined();
    });

    it('never returns a tool_invocation, since events.jsonl carries no command text to attribute a file or commit from', () => {
        const result = readGrokSession(buildInput({
            events: [
                { ts: '2026-09-07T14:19:53.408Z', type: 'tool_started', tool_name: 'run_terminal_command' },
                { ts: '2026-09-07T14:19:53.560Z', type: 'tool_completed', tool_name: 'run_terminal_command', outcome: 'success' },
            ],
        }));
        expect(result.tool_invocations).toEqual([]);
    });

    it('refuses a transcript where every line is invalid JSON', () => {
        const result = readGrokSession(buildInput({ transcript: { path: 'x', text: 'not json\nalso not json' } }));
        expect(result.refusal?.code).toBe('invalid_shape');
    });

    it('refuses a transcript over the byte limit', () => {
        const result = readGrokSession(buildInput({ transcript: { path: 'x', text: 'a'.repeat(AGENT_TRANSCRIPT_MAX_BYTES + 1) } }));
        expect(result.refusal?.code).toBe('too_large');
    });

    it('reports ended when vendor_live is false', () => {
        const result = readGrokSession(buildInput({ events: [], vendor_live: false }));
        expect(result.state).toBe('ended');
    });

    describe('resumed (incremental) parsing equals a whole-file read', () => {
        /*
         * AgentAnalyserWorker.ts appends only the newly tail-parsed lines to a cached lines array
         * before calling buildGrokResult, so this asserts equivalence to a whole read for every
         * possible split point. usage.json is never tail-parsed (it is rewritten whole each turn, not
         * appended), so it is unaffected here and passed through on `input.extra_files` exactly as a
         * whole read receives it.
         */
        const events = [
            { ts: '2026-09-07T14:19:53.408Z', type: 'tool_started', tool_name: 'run_terminal_command' },
            { ts: '2026-09-07T14:19:53.560Z', type: 'tool_completed', tool_name: 'run_terminal_command', outcome: 'error' },
            { ts: '2026-09-07T14:20:01.063Z', type: 'tool_started', tool_name: 'read_file' },
            { ts: '2026-09-07T14:20:05.000Z', type: 'tool_completed', tool_name: 'read_file', outcome: 'ok' },
        ];
        const lines = events.map((event) => JSON.stringify(event));
        const full_text = lines.join('\n') + '\n';
        const usage = { turns: [{ turnNumber: 1, endedAt: '2026-09-07T14:20:05.000Z', modelUsage: { 'grok-4.5-build': { inputTokens: 10, outputTokens: 5, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, costUsdTicks: 0 } } }] };
        const input = buildInput({ transcript: { path: 'events.jsonl', text: full_text }, usage });

        it.each([0, 1, 2, 3, 4])('resuming from a split after line %d matches a whole-file read', (split) => {
            const whole = readGrokSession(input);
            const first_text = lines.slice(0, split).join('\n') + (split > 0 ? '\n' : '');
            const second_text = lines.slice(split).join('\n') + '\n';
            const first_lines = parseGrokTranscript(first_text).lines;
            const second_lines = parseGrokTranscript(second_text).lines;
            const resumed = buildGrokResult(input, [...first_lines, ...second_lines]);

            expect(resumed).toEqual(whole);
        });
    });
});

import { AGENT_TRANSCRIPT_MAX_BYTES, type AgentSessionInput } from './agentvendorops';
import { buildCodexResult, parseCodexTranscript, readCodexSession } from './codexops';

const SESSION_META_LINE = '{"timestamp":"2026-09-04T08:32:12.047Z","ordinal":0,"type":"session_meta","payload":{"session_id":"01a06b8a-856f-79d0-833c-064a25c90c9e","id":"01a06b8a-856f-79d0-833c-064a25c90c9e","timestamp":"2026-09-04T08:30:35.375Z","cwd":"/mnt/secure/home/alex/git/github.com/active_development","originator":"codex-tui","cli_version":"0.153.2","source":"cli","thread_source":"user","model_provider":"openai","base_instructions":{"text":"you are a helpful coding agent"}}}';

function messageLine(timestamp: string, ordinal: number, text: string): string {
    return JSON.stringify({ timestamp, ordinal, type: 'response_item', payload: { type: 'message', role: 'assistant', text } });
}

// the older shape: a local_shell_call/function_call response_item carrying a bare command array
function toolCallLine(timestamp: string, ordinal: number, command: string): string {
    return JSON.stringify({ timestamp, ordinal, type: 'response_item', payload: { type: 'local_shell_call', name: 'shell', command: ['bash', '-lc', command] } });
}

// the older function_call shape: payload.arguments is a JSON-ENCODED STRING, not a bare command
function functionCallLine(timestamp: string, ordinal: number, cmd: string): string {
    return JSON.stringify({ timestamp, ordinal, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd, workdir: '/repo' }) } });
}

// the current CLI's own tool-call shape: a custom_tool_call response_item, payload.input carrying the call's own content
function customToolCallLine(timestamp: string, ordinal: number, name: string, input: string): string {
    return JSON.stringify({ timestamp, ordinal, type: 'response_item', payload: { type: 'custom_tool_call', name, input } });
}

// the current CLI's own usage line: token_usage_record, with model resolved separately from a thread_settings_applied event_msg
function tokenUsageRecordLine(timestamp: string, ordinal: number, input_tokens: number, output_tokens: number, cached_input_tokens = 0, reasoning_output_tokens = 0): string {
    return JSON.stringify({
        timestamp, ordinal, type: 'token_usage_record',
        payload: { usage: { input_tokens, output_tokens, cached_input_tokens, cache_write_input_tokens: 0, reasoning_output_tokens, total_tokens: input_tokens + output_tokens } },
    });
}

function threadSettingsLine(timestamp: string, ordinal: number, model: string): string {
    return JSON.stringify({ timestamp, ordinal, type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model } } });
}

function baseInput(transcript_text: string, overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
    return {
        session_id: '01a06b8a-856f-79d0-833c-064a25c90c9e',
        cwd: '/mnt/secure/home/alex/git/github.com/active_development',
        vendor_live: true,
        transcript: { path: 'rollout-2026-09-04.jsonl', text: transcript_text },
        extra_files: [],
        now_ms: Date.parse('2026-09-04T09:00:00.000Z'),
        window_start_ms: Date.parse('2026-09-04T08:00:00.000Z'),
        ...overrides,
    };
}

describe('readCodexSession', () => {
    it('parses a normal session into current, calls and tool_invocations', () => {
        const lines = [
            SESSION_META_LINE,
            threadSettingsLine('2026-09-04T08:35:00.000Z', 1, 'gpt-5-codex'),
            messageLine('2026-09-04T08:40:00.000Z', 2, 'starting work on the story'),
            toolCallLine('2026-09-04T08:41:00.000Z', 3, 'echo hi > notes.txt'),
            tokenUsageRecordLine('2026-09-04T08:42:00.000Z', 4, 1200, 340),
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));

        expect(result.refusal).toBeUndefined();
        expect(result.current).toEqual({ at: '2026-09-04T08:41:00.000Z', kind: 'tool_call', tool: 'shell', arg: 'bash -lc echo hi > notes.txt' });
        expect(result.calls).toEqual([
            { model_id: 'gpt-5-codex', at: '2026-09-04T08:42:00.000Z', input_tokens: 1200, output_tokens: 340, cache_read_tokens: 0, cache_write_tokens: 0 },
        ]);
        expect(result.tool_invocations).toEqual([{ at: '2026-09-04T08:41:00.000Z', file_path: 'notes.txt' }]);
    });

    it('resolves a token_usage_record to whichever thread_settings_applied model was most recently seen, tracked outside the window', () => {
        const lines = [
            SESSION_META_LINE,
            // the model is set before the read window starts, but still governs an in-window usage record
            threadSettingsLine('2026-09-04T07:00:00.000Z', 1, 'gpt-5.6-sol'),
            tokenUsageRecordLine('2026-09-04T08:30:00.000Z', 2, 100, 50),
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.calls).toEqual([
            { model_id: 'gpt-5.6-sol', at: '2026-09-04T08:30:00.000Z', input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 },
        ]);
    });

    it('carries the last thread_settings_applied model as the session model, even one seen after the last in-window usage record', () => {
        const lines = [
            SESSION_META_LINE,
            threadSettingsLine('2026-09-04T08:00:00.000Z', 1, 'gpt-5.6-sol'),
            tokenUsageRecordLine('2026-09-04T08:30:00.000Z', 2, 100, 50),
            // seen after the last usage record, and outside the window, but still the session's most recent model
            threadSettingsLine('2026-09-04T10:00:00.000Z', 3, 'gpt-6.0-preview'),
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.model).toBe('gpt-6.0-preview');
    });

    it('folds reasoning_output_tokens into output_tokens, since AgentApiCall has no separate slot and OpenAI bills them at the output rate', () => {
        const lines = [
            SESSION_META_LINE,
            threadSettingsLine('2026-09-04T08:00:00.000Z', 1, 'gpt-5.6-sol'),
            tokenUsageRecordLine('2026-09-04T08:30:00.000Z', 2, 100, 50, 20, 30),
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.calls).toEqual([
            { model_id: 'gpt-5.6-sol', at: '2026-09-04T08:30:00.000Z', input_tokens: 100, output_tokens: 80, cache_read_tokens: 20, cache_write_tokens: 0 },
        ]);
    });

    it('parses a custom_tool_call apply_patch into one tool_invocation per file, with edits per hunk on Update File and whole_file on Add File', () => {
        const patch = [
            '*** Begin Patch',
            '*** Update File: docstech/users/alex/todo.md',
            '@@',
            ' context line',
            '-+ [ ] still working',
            '++ [X] still working',
            '*** Add File: notes/new.md',
            '+line one',
            '+line two',
            '*** End Patch',
            '',
        ].join('\n');
        const lines = [SESSION_META_LINE, customToolCallLine('2026-09-04T08:41:00.000Z', 1, 'apply_patch', patch)];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.tool_invocations).toEqual([
            { at: '2026-09-04T08:41:00.000Z', file_path: 'docstech/users/alex/todo.md', whole_file: undefined, edits: [{ new_text: '+ [X] still working', old_text: '+ [ ] still working' }] },
            { at: '2026-09-04T08:41:00.000Z', file_path: 'notes/new.md', whole_file: true, edits: undefined },
        ]);
    });

    it('parses a custom_tool_call apply_patch Delete File with no located edits', () => {
        const patch = '*** Begin Patch\n*** Delete File: notes/old.md\n*** End Patch\n';
        const lines = [SESSION_META_LINE, customToolCallLine('2026-09-04T08:41:00.000Z', 1, 'apply_patch', patch)];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.tool_invocations).toEqual([{ at: '2026-09-04T08:41:00.000Z', file_path: 'notes/old.md', whole_file: undefined, edits: undefined }]);
    });

    it('decodes a function_call whose arguments is a JSON-encoded string, rather than treating the whole JSON blob as the command', () => {
        const lines = [SESSION_META_LINE, functionCallLine('2026-09-04T08:41:00.000Z', 1, 'echo hi > notes.txt')];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.current).toEqual({ at: '2026-09-04T08:41:00.000Z', kind: 'tool_call', tool: 'exec_command', arg: 'echo hi > notes.txt' });
        expect(result.tool_invocations).toEqual([{ at: '2026-09-04T08:41:00.000Z', file_path: 'notes.txt' }]);
    });

    it('skips an unknown line type without throwing and without corrupting the rest of the parse', () => {
        const lines = [
            SESSION_META_LINE,
            JSON.stringify({ timestamp: '2026-09-04T08:40:30.000Z', ordinal: 1, type: 'some_future_event', payload: { anything: true } }),
            toolCallLine('2026-09-04T08:40:45.000Z', 2, 'echo hi > notes.txt'),
            messageLine('2026-09-04T08:41:00.000Z', 3, 'still parses this'),
        ];
        expect(() => readCodexSession(baseInput(lines.join('\n')))).not.toThrow();
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.refusal).toBeUndefined();
        // the message line after the unknown one still resets the working/idle tracking, proving it was recognised rather than silently dropped along with the unknown line
        expect(result.state).toBe('idle');
    });

    it('excludes content entirely before window_start_ms without throwing', () => {
        const lines = [
            SESSION_META_LINE,
            messageLine('2026-09-04T07:00:00.000Z', 1, 'too early to count'),
            toolCallLine('2026-09-04T07:05:00.000Z', 2, 'echo old > old.txt'),
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.refusal).toBeUndefined();
        expect(result.calls).toEqual([]);
        expect(result.tool_invocations).toEqual([]);
        expect(result.current).toBeUndefined();
    });

    it('drops a torn trailing line silently while still parsing the valid lines', () => {
        const lines = [
            SESSION_META_LINE,
            toolCallLine('2026-09-04T08:40:00.000Z', 1, 'echo hi > notes.txt'),
            '{"timestamp":"2026-09-04T08:41:00.000Z","ordinal":2,"type":"response_item","payload":{"type":"mess',
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.refusal).toBeUndefined();
        expect(result.tool_invocations).toEqual([{ at: '2026-09-04T08:40:00.000Z', file_path: 'notes.txt' }]);
    });

    it('refuses invalid_shape when every line fails to parse as JSON', () => {
        const text = 'not json\nstill not json';
        const result = readCodexSession(baseInput(text));
        expect(result.refusal?.code).toBe('invalid_shape');
    });

    it('refuses too_large when the transcript exceeds the byte limit', () => {
        const huge_text = `${SESSION_META_LINE}\n${'x'.repeat(AGENT_TRANSCRIPT_MAX_BYTES + 1)}`;
        const result = readCodexSession(baseInput(huge_text));
        expect(result.refusal?.code).toBe('too_large');
    });

    it('marks a git commit shell call as is_commit in tool_invocations', () => {
        const lines = [
            SESSION_META_LINE,
            toolCallLine('2026-09-04T08:45:00.000Z', 1, 'git commit -m "fix the thing"'),
        ];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.tool_invocations).toEqual([{ at: '2026-09-04T08:45:00.000Z', is_commit: true, commit_subject: 'fix the thing' }]);
    });

    it('marks an apply_patch custom_tool_call git commit the same way, since it is matched before the per-file patch parse', () => {
        const lines = [SESSION_META_LINE, customToolCallLine('2026-09-04T08:45:00.000Z', 1, 'exec', "tools.exec_command({cmd: \"git commit -m 'fix the thing'\"})")];
        const result = readCodexSession(baseInput(lines.join('\n')));
        expect(result.tool_invocations).toEqual([{ at: '2026-09-04T08:45:00.000Z', is_commit: true, commit_subject: 'fix the thing' }]);
    });

    it('reports state ended and no current when vendor_live is false', () => {
        const lines = [
            SESSION_META_LINE,
            toolCallLine('2026-09-04T08:41:00.000Z', 1, 'echo hi > notes.txt'),
        ];
        const result = readCodexSession(baseInput(lines.join('\n'), { vendor_live: false }));
        expect(result.state).toBe('ended');
        expect(result.current).toBeUndefined();
    });

    it('never sets question, since Codex records no permission-request signal', () => {
        const lines = [SESSION_META_LINE, messageLine('2026-09-04T08:40:00.000Z', 1, 'hello')];
        const live_result = readCodexSession(baseInput(lines.join('\n'), { vendor_live: true }));
        const ended_result = readCodexSession(baseInput(lines.join('\n'), { vendor_live: false }));
        expect(live_result.question).toBeUndefined();
        expect(ended_result.question).toBeUndefined();
    });

    describe('resumed (incremental) parsing equals a whole-file read', () => {
        // a tail parse appends only its new lines to the cached ones before building, so this asserts equivalence to a whole read for every possible split point
        const lines = [
            SESSION_META_LINE,
            threadSettingsLine('2026-09-04T08:35:00.000Z', 1, 'gpt-5-codex'),
            messageLine('2026-09-04T08:40:00.000Z', 2, 'starting work on the story'),
            toolCallLine('2026-09-04T08:41:00.000Z', 3, 'echo hi > notes.txt'),
            tokenUsageRecordLine('2026-09-04T08:42:00.000Z', 4, 1200, 340),
        ];
        const full_text = lines.join('\n') + '\n';

        it.each([0, 1, 2, 3, 4, 5])('resuming from a split after line %d matches a whole-file read', (split) => {
            const whole = readCodexSession(baseInput(full_text));
            const first_text = lines.slice(0, split).join('\n') + (split > 0 ? '\n' : '');
            const second_text = lines.slice(split).join('\n') + '\n';
            const first_lines = parseCodexTranscript(first_text).lines;
            const second_lines = parseCodexTranscript(second_text).lines;
            const resumed = buildCodexResult(baseInput(full_text), [...first_lines, ...second_lines]);

            expect(resumed).toEqual(whole);
        });
    });
});

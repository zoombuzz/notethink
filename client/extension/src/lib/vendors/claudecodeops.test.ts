import { AGENT_TRANSCRIPT_MAX_BYTES, type AgentSessionInput } from './agentvendorops';
import { buildClaudeCodeResult, parseClaudeCodeTranscript, readClaudeCodeSession } from './claudecodeops';

// a fixed window shared by most fixtures below, so each test only has to place its own timestamps relative to it
const WINDOW_START_MS = Date.parse('2026-09-22T09:00:00.000Z');
const NOW_MS = Date.parse('2026-09-22T11:00:00.000Z');

function makeInput(transcript_text: string, overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
    return {
        session_id: 'sess-1',
        cwd: '/repo',
        vendor_live: true,
        transcript: { path: 'transcript.jsonl', text: transcript_text },
        extra_files: [],
        now_ms: NOW_MS,
        window_start_ms: WINDOW_START_MS,
        ...overrides,
    };
}

describe('readClaudeCodeSession', () => {
    it('reads a normal session: user turn, an assistant turn with a pending Edit tool call and usage', () => {
        const lines = [
            '{"type":"user","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"user","content":"please fix the failing test"}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:05.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"Looking at the file now"},{"type":"tool_use","id":"tu_1","name":"Edit","input":{"file_path":"/repo/src/foo.ts","old_string":"foo","new_string":"bar"}}],"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}}',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));

        expect(result.refusal).toBeUndefined();
        expect(result.calls).toEqual([{
            model_id: 'claude-sonnet-5',
            at: '2026-09-22T10:00:05.000Z',
            span_start_at: '2026-09-22T10:00:00.000Z',
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 10,
            cache_write_tokens: 5,
        }]);
        expect(result.current).toEqual({ at: '2026-09-22T10:00:05.000Z', kind: 'tool_call', tool: 'Edit', arg: '/repo/src/foo.ts' });
        expect(result.tool_invocations).toEqual([{
            at: '2026-09-22T10:00:05.000Z',
            file_path: '/repo/src/foo.ts',
            edits: [{ old_text: 'foo', new_text: 'bar' }],
        }]);
    });

    it('carries one edit per MultiEdit entry, so a call touching several sections of one file locates each', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"MultiEdit","input":{"file_path":"/repo/todo.md","edits":[{"old_string":"status=doing","new_string":"status=code-review"},{"old_string":"[ ] task two","new_string":"[X] task two"}]}}]}}',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));

        expect(result.tool_invocations).toEqual([{
            at: '2026-09-22T10:00:00.000Z',
            file_path: '/repo/todo.md',
            edits: [
                { old_text: 'status=doing', new_text: 'status=code-review' },
                { old_text: '[ ] task two', new_text: '[X] task two' },
            ],
        }]);
    });

    it('flags a Write call whole_file with no located edits, since its whole-file content cannot locate one story section', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Write","input":{"file_path":"/repo/todo.md","content":"# Todo\\n\\n### New story\\n"}}]}}',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));

        expect(result.tool_invocations).toEqual([{ at: '2026-09-22T10:00:00.000Z', file_path: '/repo/todo.md', whole_file: true }]);
    });

    it('dedups usage by message.id: three lines sharing one id with identical usage count once', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"id":"msg_dup","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"partial one"}],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:01.000Z","message":{"id":"msg_dup","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"partial two"}],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:02.000Z","message":{"id":"msg_dup","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"partial three"}],"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));

        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]).toEqual(expect.objectContaining({
            at: '2026-09-22T10:00:00.000Z',
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 5,
            cache_write_tokens: 2,
        }));
    });

    it('folds a subagent extra_files entry into calls, deduping its own message ids independently', () => {
        const main_text = '{"type":"user","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"user","content":"go"}}';
        const subagent_lines = [
            '{"type":"assistant","timestamp":"2026-09-22T10:00:02.000Z","message":{"id":"sub_1","model":"claude-haiku","role":"assistant","content":[{"type":"text","text":"working"}],"usage":{"input_tokens":30,"output_tokens":15,"cache_read_input_tokens":1,"cache_creation_input_tokens":0}}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:03.000Z","message":{"id":"sub_1","model":"claude-haiku","role":"assistant","content":[{"type":"text","text":"still working"}],"usage":{"input_tokens":30,"output_tokens":15,"cache_read_input_tokens":1,"cache_creation_input_tokens":0}}}',
        ];
        const result = readClaudeCodeSession(makeInput(main_text, {
            extra_files: [{ path: 'subagents/agent-1.jsonl', text: subagent_lines.join('\n') }],
        }));

        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]).toEqual(expect.objectContaining({ model_id: 'claude-haiku', input_tokens: 30, output_tokens: 15 }));
    });

    it('carries the last assistant message.model as the session model, across the whole transcript rather than only a windowed slice', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T09:30:00.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"first"}]}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:05.000Z","message":{"id":"msg_2","model":"claude-opus-5","role":"assistant","content":[{"type":"text","text":"second"}]}}',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));
        expect(result.model).toBe('claude-opus-5');
    });

    it('a session entirely before window_start_ms yields empty calls and tool_invocations without throwing', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T07:00:00.000Z","message":{"id":"msg_old","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"old work"},{"type":"tool_use","id":"tu_old","name":"Edit","input":{"file_path":"/repo/old.ts"}}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
        ];
        let result;
        expect(() => { result = readClaudeCodeSession(makeInput(lines.join('\n'))); }).not.toThrow();

        expect(result!.calls).toEqual([]);
        expect(result!.current).toBeUndefined();
        expect(result!.tool_invocations).toEqual([]);
    });

    it('drops a torn trailing line silently and keeps the valid lines before it', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"id":"msg_a","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"fine"}],"usage":{"input_tokens":5,"output_tokens":3,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:01.000Z","message":{"id":"msg_b"',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));

        expect(result.refusal).toBeUndefined();
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]).toEqual(expect.objectContaining({ model_id: 'claude-sonnet-5', input_tokens: 5 }));
    });

    it('refuses invalid_shape when no line in the transcript parses as JSON', () => {
        const text = ['not json at all', 'also not json', '{broken'].join('\n');
        const result = readClaudeCodeSession(makeInput(text));

        expect(result.refusal).toEqual({ code: 'invalid_shape', reason: 'no line in the transcript parsed as JSON' });
        expect(result.calls).toEqual([]);
    });

    it('refuses too_large when the transcript exceeds the byte bound', () => {
        const padding = 'x'.repeat(AGENT_TRANSCRIPT_MAX_BYTES + 1000);
        const text = `{"type":"user","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"user","content":"${padding}"}}`;
        const result = readClaudeCodeSession(makeInput(text));

        expect(result.refusal?.code).toBe('too_large');
        expect(result.session_id).toBe('sess-1');
        expect(result.cwd).toBe('/repo');
    });

    it('records a git commit bash call as a commit tool invocation', () => {
        const lines = [
            '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_commit","name":"Bash","input":{"command":"git commit -m \\"fix bug in parser\\""}}]}}',
        ];
        const result = readClaudeCodeSession(makeInput(lines.join('\n')));

        expect(result.tool_invocations).toContainEqual({
            at: '2026-09-22T10:00:00.000Z',
            is_commit: true,
            commit_subject: 'fix bug in parser',
            file_path: undefined,
        });
    });

    describe('board edits made via Bash instead of Edit/MultiEdit', () => {
        /*
         * An orchestrating session can tick a story's tasks with a Python heredoc run through Bash
         * rather than one Edit call per line. Without this, such a write is invisible to
         * buildToolInvocations entirely (CLAUDE_FILE_WRITE_TOOLS only recognises the four built-in
         * file-write tools), so the session could never bind to any story regardless of how accurate
         * the location-matching binder is.
         */
        function bashToolUse(command: string): string {
            return JSON.stringify({
                type: 'assistant', timestamp: '2026-09-22T10:00:00.000Z',
                message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_bash', name: 'Bash', input: { command } }] },
            });
        }

        it('extracts a task-tick python heredoc as located edits, with the ticked form synthesised', () => {
            const command = [
                'python3 - <<\'PY\'',
                'import io',
                'p=\'docstech/users/alex/todo.md\'',
                's=io.open(p,encoding=\'utf-8\').read()',
                'tasks=[',
                '"+ [ ] a distinctive first task line here",',
                ']',
                'for t in tasks:',
                '    assert s.count(t)==1, t',
                '    s=s.replace(t, t.replace("+ [ ] ","+ [X] ",1))',
                'io.open(p,\'w\',encoding=\'utf-8\').write(s)',
                'PY',
            ].join('\n');
            const result = readClaudeCodeSession(makeInput(bashToolUse(command)));

            expect(result.tool_invocations).toEqual([{
                at: '2026-09-22T10:00:00.000Z',
                file_path: 'docstech/users/alex/todo.md',
                edits: [
                    { new_text: '+ [ ] a distinctive first task line here' },
                    { new_text: '+ [X] a distinctive first task line here' },
                ],
            }]);
        });

        it('does not treat a read-only board reference as a write, so a session that only inspects a board is never bound to it', () => {
            const command = 'sed -n \'1,50p\' docstech/users/alex/todo.md';
            const result = readClaudeCodeSession(makeInput(bashToolUse(command)));

            expect(result.tool_invocations).toEqual([]);
        });

        it('excludes the board path literal itself from the extracted edits, so a path reference is never mistaken for board content', () => {
            const command = [
                'python3 - <<\'PY\'',
                'import io',
                'p=\'oma/docstech/users/alex/todo.md\'',
                's=io.open(p,encoding=\'utf-8\').read()',
                's=s.replace("+ short anchor line here", "+ short anchor line here\\n+ a distinctive new note inserted here")',
                'io.open(p,\'w\',encoding=\'utf-8\').write(s)',
                'PY',
            ].join('\n');
            const result = readClaudeCodeSession(makeInput(bashToolUse(command)));

            expect(result.tool_invocations).toHaveLength(1);
            const edit_texts = result.tool_invocations[0].edits?.map(e => e.new_text);
            expect(edit_texts).not.toContain('oma/docstech/users/alex/todo.md');
            expect(edit_texts).toContain('+ short anchor line here\n+ a distinctive new note inserted here');
        });

        it('extracts a sed -i edit as write evidence too, not only a python .write() call', () => {
            const command = 'sed -i "s/+ \\[ \\] a distinctive sed-ticked task line/+ [X] a distinctive sed-ticked task line/" docstech/users/alex/todo.md';
            const result = readClaudeCodeSession(makeInput(bashToolUse(command)));

            expect(result.tool_invocations).toHaveLength(1);
            expect(result.tool_invocations[0].file_path).toBe('docstech/users/alex/todo.md');
        });
    });

    describe('resumed (incremental) parsing equals a whole-file read', () => {
        // a tail parse appends only its new records to the cached ones before building, so this asserts equivalence to a whole read for every possible split point
        const lines = [
            '{"type":"user","timestamp":"2026-09-22T10:00:00.000Z","message":{"role":"user","content":"please fix the failing test"}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:05.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"Looking at the file now"},{"type":"tool_use","id":"tu_1","name":"Edit","input":{"file_path":"/repo/src/foo.ts","old_string":"foo","new_string":"bar"}}],"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}}',
            '{"type":"user","timestamp":"2026-09-22T10:00:06.000Z","message":{"role":"user","content":"looks good"}}',
            '{"type":"assistant","timestamp":"2026-09-22T10:00:10.000Z","message":{"id":"msg_2","model":"claude-opus-5","role":"assistant","content":[{"type":"tool_use","id":"tu_2","name":"Bash","input":{"command":"git commit -m \\"fix bug\\""}}],"usage":{"input_tokens":20,"output_tokens":8,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
        ];
        const full_text = lines.join('\n') + '\n';

        it.each([0, 1, 2, 3, 4])('resuming from a split after line %d matches a whole-file read', (split) => {
            const whole = readClaudeCodeSession(makeInput(full_text));
            const first_text = lines.slice(0, split).join('\n') + (split > 0 ? '\n' : '');
            const second_text = lines.slice(split).join('\n') + '\n';
            const first_records = parseClaudeCodeTranscript(first_text).records;
            const second_records = parseClaudeCodeTranscript(second_text).records;
            const resumed = buildClaudeCodeResult(makeInput(full_text), [...first_records, ...second_records], []);

            expect(resumed).toEqual(whole);
        });

        it('resuming a subagent extra file at a split point matches a whole-file read too', () => {
            const main_text = lines[0] + '\n';
            const subagent_lines = [
                '{"type":"assistant","timestamp":"2026-09-22T10:00:02.000Z","message":{"id":"sub_1","model":"claude-haiku","role":"assistant","content":[{"type":"text","text":"working"}],"usage":{"input_tokens":30,"output_tokens":15,"cache_read_input_tokens":1,"cache_creation_input_tokens":0}}}',
                '{"type":"assistant","timestamp":"2026-09-22T10:00:03.000Z","message":{"id":"sub_2","model":"claude-haiku","role":"assistant","content":[{"type":"text","text":"still working"}],"usage":{"input_tokens":12,"output_tokens":6,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
            ];
            const subagent_text = subagent_lines.join('\n') + '\n';
            const input = makeInput(main_text, { extra_files: [{ path: 'subagents/agent-1.jsonl', text: subagent_text }] });
            const whole = readClaudeCodeSession(input);

            const first_sub = parseClaudeCodeTranscript(subagent_lines[0] + '\n').records;
            const second_sub = parseClaudeCodeTranscript(subagent_lines[1] + '\n').records;
            const main_records = parseClaudeCodeTranscript(main_text).records;
            const resumed = buildClaudeCodeResult(input, main_records, [[...first_sub, ...second_sub]]);

            expect(resumed).toEqual(whole);
        });
    });

    describe('state derivation', () => {
        it('is working when live and the last assistant message has a pending tool call', () => {
            const lines = [
                '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Edit","input":{"file_path":"/repo/foo.ts"}}]}}',
            ];
            const result = readClaudeCodeSession(makeInput(lines.join('\n'), { vendor_live: true }));
            expect(result.state).toBe('working');
        });

        it('is idle when live and the last assistant message has no pending tool call', () => {
            const lines = [
                '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"all done"}]}}',
            ];
            const result = readClaudeCodeSession(makeInput(lines.join('\n'), { vendor_live: true }));
            expect(result.state).toBe('idle');
        });

        it('is ended when not live, regardless of a pending tool call', () => {
            const lines = [
                '{"type":"assistant","timestamp":"2026-09-22T10:00:00.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Edit","input":{"file_path":"/repo/foo.ts"}}]}}',
            ];
            const result = readClaudeCodeSession(makeInput(lines.join('\n'), { vendor_live: false }));
            expect(result.state).toBe('ended');
        });
    });
});

import { handleAgentAnalyserRequest, resetTailCacheForTest, setTailCacheGlobalMaxBytesForTest, setTailCacheMaxBytesForTest, setTranscriptMaxBytesForTest, tailCacheStatsForTest, type AgentAnalyserRawFile, type AgentAnalyserWorkerJob } from './AgentAnalyserWorker';

const NOW_MS = Date.parse('2026-09-22T12:00:00Z');
const WINDOW_START_MS = NOW_MS - 30 * 24 * 60 * 60 * 1000;

function bytesOf(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer;
}

function fileOf(text: string, path = '/t.jsonl', mode: AgentAnalyserRawFile['mode'] = 'whole'): AgentAnalyserRawFile {
    return { path, bytes: bytesOf(text), mode };
}

// a claude-code assistant line with a distinct message id and usage, so total input_tokens reveals which lines combined
function claudeLine(message_id: string, input_tokens: number, at = '2026-09-22T11:00:00Z'): string {
    return JSON.stringify({
        type: 'assistant', timestamp: at,
        message: { id: message_id, role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });
}

function baseJob(overrides: Partial<AgentAnalyserWorkerJob> = {}): AgentAnalyserWorkerJob {
    return {
        vendor: 'claude-code',
        session_id: 's1',
        cwd: '/mnt/secure/home/alex/git/github.com/active_development/notethink',
        vendor_live: true,
        now_ms: NOW_MS,
        window_start_ms: WINDOW_START_MS,
        transcript: fileOf(''),
        extra_files: [],
        cacheable: true,
        ...overrides,
    };
}

describe('handleAgentAnalyserRequest', () => {
    it('decodes a job carrying raw bytes and runs it through the reader, pricing its calls and attaching claude-code capabilities', () => {
        const line = JSON.stringify({
            type: 'assistant',
            timestamp: '2026-09-22T11:00:00Z',
            message: {
                id: 'm1', role: 'assistant', model: 'claude-sonnet-5',
                content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/foo.ts' } }],
                usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            },
        });
        const job = baseJob({ transcript: fileOf(line) });
        const response = handleAgentAnalyserRequest({ request_id: 'r1', jobs: [job] });
        expect(response.request_id).toBe('r1');
        expect(response.sessions).toHaveLength(1);
        const session = response.sessions[0];
        expect(session.session_id).toBe('s1');
        expect(session.vendor).toBe('claude-code');
        expect(session.capabilities).toEqual({ live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' });
        expect(session.current?.tool).toBe('Edit');
        expect(session.model).toBe('claude-sonnet-5');
        expect(session.usage.input_tokens).toBe(10);
        expect(session.usage.output_tokens).toBe(5);
        expect(session.priced_calls).toEqual([{ at: '2026-09-22T11:00:00Z', usage: session.usage }]);
    });

    it('resolves a relative write-call path against the session cwd, and leaves an absolute one untouched', () => {
        const line = JSON.stringify({
            type: 'assistant', timestamp: '2026-09-22T11:00:00Z',
            message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/foo.ts' } }], usage: { input_tokens: 1, output_tokens: 1 } },
        });
        const job = baseJob({ transcript: fileOf(line) });
        const response = handleAgentAnalyserRequest({ request_id: 'r1', jobs: [job] });
        expect(response.sessions[0].calls[0].absolute_path).toBe('/mnt/secure/home/alex/git/github.com/active_development/notethink/src/foo.ts');
    });

    it('decodes each extra file independently alongside the main transcript', () => {
        const subagent_line = JSON.stringify({
            type: 'assistant', timestamp: '2026-09-22T11:00:00Z',
            message: { id: 'sub1', role: 'assistant', model: 'claude-sonnet-5', content: [], usage: { input_tokens: 7, output_tokens: 2 } },
        });
        const job = baseJob({ extra_files: [fileOf(subagent_line, '/t/subagents/agent-1.jsonl')] });
        const response = handleAgentAnalyserRequest({ request_id: 'r1', jobs: [job] });
        expect(response.sessions[0].usage.input_tokens).toBe(7);
    });

    it('handles a mixed batch of all three vendors in one request without one job affecting another', () => {
        const jobs: AgentAnalyserWorkerJob[] = [
            baseJob({ vendor: 'claude-code', session_id: 'c1' }),
            baseJob({ vendor: 'codex', session_id: 'x1' }),
            baseJob({ vendor: 'grok', session_id: 'g1' }),
        ];
        const response = handleAgentAnalyserRequest({ request_id: 'r2', jobs });
        expect(response.sessions.map(s => s.session_id)).toEqual(['c1', 'x1', 'g1']);
        expect(response.sessions.map(s => s.vendor)).toEqual(['claude-code', 'codex', 'grok']);
    });

    it('carries a reader refusal through to the worker response rather than throwing', () => {
        const job = baseJob({ transcript: fileOf('not json at all') });
        const response = handleAgentAnalyserRequest({ request_id: 'r3', jobs: [job] });
        expect(response.sessions[0].refusal?.code).toBe('invalid_shape');
    });

    it('an empty batch returns an empty session list', () => {
        expect(handleAgentAnalyserRequest({ request_id: 'r4', jobs: [] })).toEqual({ request_id: 'r4', sessions: [] });
    });

    it('turns one job throwing into a refusal entry for that session, never failing the whole batch', () => {
        const jobs: AgentAnalyserWorkerJob[] = [
            baseJob({ session_id: 'ok1' }),
            // an unrecognised vendor id has no VENDOR_READERS entry, so runJob's lookup throws like a real reader bug would
            baseJob({ vendor: 'unknown-vendor' as AgentAnalyserWorkerJob['vendor'], session_id: 'poisoned' }),
            baseJob({ session_id: 'ok2' }),
        ];
        const response = handleAgentAnalyserRequest({ request_id: 'r5', jobs });
        expect(response.sessions.map(s => s.session_id)).toEqual(['ok1', 'poisoned', 'ok2']);
        expect(response.sessions[0].refusal).toBeUndefined();
        expect(response.sessions[1].refusal?.code).toBe('unreadable');
        expect(response.sessions[2].refusal).toBeUndefined();
    });
});

describe('bounding the retained line cache', () => {
    // the line cache is module-level state shared across every request, so reset it between tests to stop leaks
    beforeEach(() => { resetTailCacheForTest(); });
    afterEach(() => { setTailCacheMaxBytesForTest(undefined); });

    it('does not retain a non-cacheable session after its whole parse: a later tail job for it builds from nothing, not from the earlier whole content', () => {
        const session_id = 'noncache-1';
        const whole_job = baseJob({ session_id, cacheable: false, transcript: fileOf(`${claudeLine('m1', 100)}\n`) });
        handleAgentAnalyserRequest({ request_id: 'a', jobs: [whole_job] });

        // a tail job for this session should never happen, but proves directly this worker held nothing for it
        const tail_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m2', 5)}\n`, '/t.jsonl', 'tail') });
        const response = handleAgentAnalyserRequest({ request_id: 'b', jobs: [tail_job] });

        // only m2's own tokens show up; m1 was built and thrown away, never retained
        expect(response.sessions[0].usage.input_tokens).toBe(5);
    });

    it('retains a cacheable session across requests, so a later tail job correctly combines with the earlier whole content', () => {
        const session_id = 'cache-1';
        const whole_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m1', 100)}\n`) });
        handleAgentAnalyserRequest({ request_id: 'a', jobs: [whole_job] });

        const tail_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m2', 5)}\n`, '/t.jsonl', 'tail') });
        const response = handleAgentAnalyserRequest({ request_id: 'b', jobs: [tail_job] });

        expect(response.sessions[0].usage.input_tokens).toBe(105);
    });

    it('the byte cap evicts the least-recently-touched session first, and reports it in evicted_session_ids', () => {
        // each claudeLine is 267 bytes; two sessions (534) fit the 1000 byte cap, a third (1068) forces an eviction
        setTailCacheMaxBytesForTest(1000);
        const job_a = baseJob({ session_id: 'lru-a', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
        const job_b = baseJob({ session_id: 'lru-b', cacheable: true, transcript: fileOf(`${claudeLine('m2', 1)}\n`) });
        const first = handleAgentAnalyserRequest({ request_id: 'a', jobs: [job_a, job_b] });
        expect(first.evicted_session_ids).toBeUndefined();

        // lru-a's tail job touches it, so lru-b is now the least recently touched
        const tail_a = baseJob({ session_id: 'lru-a', cacheable: true, transcript: fileOf(`${claudeLine('m3', 1)}\n`, '/t.jsonl', 'tail') });
        handleAgentAnalyserRequest({ request_id: 'b', jobs: [tail_a] });

        // a third session pushes the cache over the cap; lru-b, untouched since the first request, is evicted and lru-a survives
        const job_c = baseJob({ session_id: 'lru-c', cacheable: true, transcript: fileOf(`${claudeLine('m4', 1)}\n`) });
        const third = handleAgentAnalyserRequest({ request_id: 'c', jobs: [job_c] });
        expect(third.evicted_session_ids).toEqual(['lru-b']);

        // the cap is proven; lift it before the checks below, which grow the cache and would otherwise force an unrelated eviction
        setTailCacheMaxBytesForTest(undefined);

        // lru-b is gone: a tail job against it now combines from nothing, exactly like the non-cacheable case
        const tail_b = baseJob({ session_id: 'lru-b', cacheable: true, transcript: fileOf(`${claudeLine('m5', 5)}\n`, '/t.jsonl', 'tail') });
        const after_evict = handleAgentAnalyserRequest({ request_id: 'd', jobs: [tail_b] });
        expect(after_evict.sessions[0].usage.input_tokens).toBe(5);

        // lru-a was never touched by the eviction: its own tail job still combines both of its own earlier lines
        const tail_a_again = baseJob({ session_id: 'lru-a', cacheable: true, transcript: fileOf(`${claudeLine('m6', 1)}\n`, '/t.jsonl', 'tail') });
        const lru_a_response = handleAgentAnalyserRequest({ request_id: 'e', jobs: [tail_a_again] });
        expect(lru_a_response.sessions[0].usage.input_tokens).toBe(3);
    });

    it("evict_session_ids frees a session before that request's own jobs run, so a whole job for the same session starts from nothing", () => {
        const session_id = 'evict-me';
        const whole_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m1', 100)}\n`) });
        handleAgentAnalyserRequest({ request_id: 'a', jobs: [whole_job] });

        const replay_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m2', 5)}\n`) });
        const response = handleAgentAnalyserRequest({ request_id: 'b', jobs: [replay_job], evict_session_ids: [session_id] });
        expect(response.sessions[0].usage.input_tokens).toBe(5);
    });
});

describe('a pooled worker retains only its own share of the byte cap', () => {
    beforeEach(() => { resetTailCacheForTest(); });

    it('divides AGENT_TAIL_CACHE_MAX_BYTES by request.pool_size, but never evicts the one session left holding the cache', () => {
        // enormous pool_size shrinks the budget; the lone survivor still isn't evicted, avoiding a re-read
        const pooled_job = baseJob({ session_id: 'pooled', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
        const pooled = handleAgentAnalyserRequest({ request_id: 'a', jobs: [pooled_job], pool_size: 2_000_000 });
        expect(pooled.evicted_session_ids).toBeUndefined();
        expect(tailCacheStatsForTest().sessions).toBe(1);

        resetTailCacheForTest();
        // same session with no pool_size keeps the whole 128 MiB budget, nowhere near its cap
        const unpooled_job = baseJob({ session_id: 'unpooled', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
        const unpooled = handleAgentAnalyserRequest({ request_id: 'b', jobs: [unpooled_job] });
        expect(unpooled.evicted_session_ids).toBeUndefined();
        expect(tailCacheStatsForTest().sessions).toBe(1);
    });

    it('still evicts an older session to make room for a newer one, once more than one session is cached', () => {
        // even one session is already over its pool_size share, but with two cached the older still yields first
        const older_job = baseJob({ session_id: 'older', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
        handleAgentAnalyserRequest({ request_id: 'a', jobs: [older_job], pool_size: 2_000_000 });
        expect(tailCacheStatsForTest().sessions).toBe(1);

        const newer_job = baseJob({ session_id: 'newer', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
        const response = handleAgentAnalyserRequest({ request_id: 'b', jobs: [newer_job], pool_size: 2_000_000 });
        expect(response.evicted_session_ids).toEqual(['older']);
        expect(tailCacheStatsForTest().sessions).toBe(1);
    });

    it('evicts the lone survivor too once its own size outgrows the whole UNPOOLED budget, not just its per-worker share', () => {
        setTailCacheGlobalMaxBytesForTest(100);
        try {
            // this session exceeds the whole unpooled budget, not just its pool_size share
            const job = baseJob({ session_id: 'oversized', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
            const response = handleAgentAnalyserRequest({ request_id: 'a', jobs: [job], pool_size: 2_000_000 });
            expect(response.evicted_session_ids).toEqual(['oversized']);
            expect(tailCacheStatsForTest()).toEqual({ sessions: 0, total_source_bytes: 0 });
        } finally {
            setTailCacheGlobalMaxBytesForTest(undefined);
        }
    });

    it('pool_size of 1 keeps the whole budget, the same as omitting pool_size entirely', () => {
        const job = baseJob({ session_id: 'solo', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
        const response = handleAgentAnalyserRequest({ request_id: 'a', jobs: [job], pool_size: 1 });
        expect(response.evicted_session_ids).toBeUndefined();
        expect(tailCacheStatsForTest().sessions).toBe(1);
    });

    it('a test-only override still wins over a request\'s own pool_size, so existing byte-cap tests need no change', () => {
        setTailCacheMaxBytesForTest(100_000);
        try {
            const job = baseJob({ session_id: 'overridden', cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n`) });
            // pool_size alone would evict this session; the test-only override still applies, so it survives
            const response = handleAgentAnalyserRequest({ request_id: 'a', jobs: [job], pool_size: 2_000_000 });
            expect(response.evicted_session_ids).toBeUndefined();
        } finally {
            setTailCacheMaxBytesForTest(undefined);
        }
    });
});

describe('the transcript size cap applies the same way whole or tailed', () => {
    // each claudeLine is exactly 267 bytes with its trailing newline (measured, per the byte-cap describe block above)
    beforeEach(() => { resetTailCacheForTest(); });
    afterEach(() => { setTranscriptMaxBytesForTest(undefined); });

    it('refuses a whole job whose transcript is over the cap, and never caches it', () => {
        setTranscriptMaxBytesForTest(300);
        const session_id = 'oversize-whole';
        const job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n${claudeLine('m2', 1)}\n`) });
        const response = handleAgentAnalyserRequest({ request_id: 'a', jobs: [job] });
        expect(response.sessions[0].refusal?.code).toBe('too_large');
        expect(response.evicted_session_ids).toEqual([session_id]);
        expect(tailCacheStatsForTest()).toEqual({ sessions: 0, total_source_bytes: 0 });
    });

    it('refuses the same transcript again on its next whole scan, not only its first', () => {
        setTranscriptMaxBytesForTest(300);
        const session_id = 'oversize-repeat';
        const job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n${claudeLine('m2', 1)}\n`) });
        handleAgentAnalyserRequest({ request_id: 'a', jobs: [job] });
        const second = handleAgentAnalyserRequest({ request_id: 'b', jobs: [job] });
        expect(second.sessions[0].refusal?.code).toBe('too_large');
        expect(tailCacheStatsForTest()).toEqual({ sessions: 0, total_source_bytes: 0 });
    });

    it('refuses a tail job the scan its cumulative bytes cross the cap, dropping its cache and its bookmark eligibility', () => {
        setTranscriptMaxBytesForTest(300);
        const session_id = 'crosses-cap';
        // one line (267 bytes) fits the cap and caches normally
        const whole_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m1', 100)}\n`) });
        const first = handleAgentAnalyserRequest({ request_id: 'a', jobs: [whole_job] });
        expect(first.sessions[0].refusal).toBeUndefined();
        expect(tailCacheStatsForTest().sessions).toBe(1);

        // a second line appended by tail pushes the cumulative total (534 bytes) over the 300 byte cap
        const tail_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m2', 1)}\n`, '/t.jsonl', 'tail') });
        const second = handleAgentAnalyserRequest({ request_id: 'b', jobs: [tail_job] });
        expect(second.sessions[0].refusal?.code).toBe('too_large');
        expect(second.evicted_session_ids).toEqual([session_id]);
        expect(tailCacheStatsForTest()).toEqual({ sessions: 0, total_source_bytes: 0 });

        // nothing survived the refusal: a further tail job combines from nothing, like a session never cached at all
        const later_tail = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m3', 5)}\n`, '/t.jsonl', 'tail') });
        const third = handleAgentAnalyserRequest({ request_id: 'c', jobs: [later_tail] });
        expect(third.sessions[0].usage.input_tokens).toBe(5);
    });

    it('a session refused for size parses whole again, cleanly, once the cap no longer applies to it', () => {
        setTranscriptMaxBytesForTest(300);
        const session_id = 'shrinks-under-cap';
        const oversize_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m1', 1)}\n${claudeLine('m2', 1)}\n`) });
        const refused = handleAgentAnalyserRequest({ request_id: 'a', jobs: [oversize_job] });
        expect(refused.sessions[0].refusal?.code).toBe('too_large');

        // once the cap lifts, a fresh whole job for the session builds and caches normally, with nothing left from the refusal
        setTranscriptMaxBytesForTest(undefined);
        const small_job = baseJob({ session_id, cacheable: true, transcript: fileOf(`${claudeLine('m3', 9)}\n`) });
        const recovered = handleAgentAnalyserRequest({ request_id: 'b', jobs: [small_job] });
        expect(recovered.sessions[0].refusal).toBeUndefined();
        expect(recovered.sessions[0].usage.input_tokens).toBe(9);
    });

    it('does not check a non-cacheable job, which is always whole anyway and already goes through the reader\'s own check', () => {
        setTranscriptMaxBytesForTest(300);
        const session_id = 'noncacheable-oversize';
        const job = baseJob({ session_id, cacheable: false, transcript: fileOf(`${claudeLine('m1', 1)}\n${claudeLine('m2', 1)}\n`) });
        const response = handleAgentAnalyserRequest({ request_id: 'a', jobs: [job] });
        // 534 bytes exceeds the test's 300 byte override but stays under the real limit the vendor reader checks, so it accepts
        expect(response.sessions[0].refusal).toBeUndefined();
    });
});

// AgentAnalyser.ts's second use of this worker: counting added/removed lines off the host's own thread
describe('handleAgentAnalyserRequest line_diff_jobs', () => {
    it('is absent from the response when the request carries none, the shape every ordinary session-only scan sends', () => {
        const response = handleAgentAnalyserRequest({ request_id: 'r1', jobs: [] });
        expect(response.line_diff_results).toBeUndefined();
    });

    it('counts added and removed lines for each job, keyed the same way the request keyed it', () => {
        const response = handleAgentAnalyserRequest({
            request_id: 'r1',
            jobs: [],
            line_diff_jobs: [
                { key: 'src/a.ts', head_bytes: bytesOf('a\nb\nc\n'), working_bytes: bytesOf('a\nx\nc\n') },
                { key: 'src/b.ts', head_bytes: undefined, working_bytes: bytesOf('new\nfile\n') },
            ],
        });
        expect(response.line_diff_results).toEqual([
            { key: 'src/a.ts', counts: { added: 1, removed: 1 } },
            { key: 'src/b.ts', counts: { added: 2, removed: 0 } },
        ]);
    });

    it('reports a declined job (binary, or over the byte cap) as a result with no counts, not a thrown error', () => {
        const response = handleAgentAnalyserRequest({
            request_id: 'r1',
            jobs: [],
            line_diff_jobs: [{ key: 'image.png', head_bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]).buffer, working_bytes: bytesOf('a\n') }],
        });
        expect(response.line_diff_results).toEqual([{ key: 'image.png' }]);
    });

    it('isolates one bad job from the rest of the batch, the same guarantee runJobIsolated gives session jobs', () => {
        const poisoned: ArrayBuffer = -1 as unknown as ArrayBuffer; // `new Uint8Array(-1)` throws RangeError rather than decoding anything
        const response = handleAgentAnalyserRequest({
            request_id: 'r1',
            jobs: [],
            line_diff_jobs: [
                { key: 'bad', head_bytes: poisoned },
                { key: 'good', head_bytes: bytesOf('a\n'), working_bytes: bytesOf('a\nb\n') },
            ],
        });
        expect(response.line_diff_results).toEqual([{ key: 'bad' }, { key: 'good', counts: { added: 1, removed: 0 } }]);
    });
});

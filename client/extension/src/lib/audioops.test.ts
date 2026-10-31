import * as http from 'http';
import type { AddressInfo } from 'net';
import {
    AUDIO_QUEUE_MAX_CHUNKS,
    AUDIO_RETRY_MAX_MS,
    type AudioFetchFn,
    AudioUploadQueue,
    audioChunkHeaders,
    audioChunkUrl,
    audioRetryDelayMs,
    createAudioSession,
    validateAudioEndpoint,
} from './audioops';

const CHUNK_BYTES = 64000;
const CHUNK_MS = 2000;
const EXAMPLE_ENDPOINT = 'https://transcribe.example.com/ingest';

function makeChunk(chunk_index: number): { chunk_index: number; started_at: string; pcm: Uint8Array } {
    return { chunk_index, started_at: new Date(chunk_index * CHUNK_MS).toISOString(), pcm: new Uint8Array(CHUNK_BYTES) };
}

describe('validateAudioEndpoint', () => {
    it.each([
        ['https://transcribe.example.com/ingest', 'https://transcribe.example.com/ingest'],
        ['https://transcribe.example.com/ingest/', 'https://transcribe.example.com/ingest'],
        ['http://localhost:8080/a', 'http://localhost:8080/a'],
        ['http://127.0.0.1:9000', 'http://127.0.0.1:9000'],
        ['http://127.5.6.7/x', 'http://127.5.6.7/x'],
        ['http://[::1]:3000/x', 'http://[::1]:3000/x'],
    ])('accepts %s', (input, expected) => {
        expect(validateAudioEndpoint(input)).toEqual({ ok: true, endpoint: expected });
    });

    it.each([
        '',
        '   ',
        'not a url',
        'http://transcribe.example.com/ingest',
        'http://128.0.0.1/x',
        'ftp://transcribe.example.com/x',
        'ws://127.0.0.1/x',
        'file:///tmp/x',
        'https://user:pw@transcribe.example.com/x',
        'https://user@transcribe.example.com/x',
        'https://transcribe.example.com/x?key=1',
        'https://transcribe.example.com/x#frag',
    ])('refuses %j with a reason', (input) => {
        const result = validateAudioEndpoint(input);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason.length > 0).toBe(true);
    });
});

describe('request building', () => {
    it('joins with exactly one slash', () => {
        expect(audioChunkUrl('https://a.example.com/x', 'sid', 7)).toBe('https://a.example.com/x/sid/7');
        expect(audioChunkUrl('https://a.example.com/x/', 'sid', 7)).toBe('https://a.example.com/x/sid/7');
    });

    it('adds Authorization only with a token', () => {
        expect(audioChunkHeaders('t')).toEqual({ 'X-Chunk-Started-At': 't', 'Content-Type': 'application/octet-stream' });
        expect(audioChunkHeaders('t', 'abc')['Authorization']).toBe('Bearer abc');
    });

    it('backs off exponentially up to the cap', () => {
        expect([1, 2, 3, 4, 5, 6].map(audioRetryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, AUDIO_RETRY_MAX_MS]);
        expect(audioRetryDelayMs(500)).toBe(AUDIO_RETRY_MAX_MS);
    });
});

describe('AudioUploadQueue with fake timers', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    function makeStub(): { fetch_fn: AudioFetchFn; calls: Array<{ url: string; sequence: number; headers: Record<string, string> }>; state: { up: boolean } } {
        const calls: Array<{ url: string; sequence: number; headers: Record<string, string> }> = [];
        const state = { up: true };
        const fetch_fn: AudioFetchFn = async (url, init) => {
            if (!state.up) { throw new Error('connection refused'); }
            calls.push({ url, sequence: Number(url.split('/').pop()), headers: init.headers });
            return { ok: true, status: 200 };
        };
        return { fetch_fn, calls, state };
    }

    it('uploads 300 chunks over 600 s with no missing sequence numbers', async () => {
        const stub = makeStub();
        const queue = new AudioUploadQueue({ endpoint: EXAMPLE_ENDPOINT, session_id: 's1', token: 'secret-token', fetch_fn: stub.fetch_fn });
        for (let i = 0; i < 300; i++) {
            queue.enqueue(makeChunk(i));
            await jest.advanceTimersByTimeAsync(CHUNK_MS);
        }
        expect(stub.calls.map((c) => c.sequence)).toEqual(Array.from({ length: 300 }, (_, i) => i));
        expect(stub.calls[0].url).toBe(`${EXAMPLE_ENDPOINT}/s1/0`);
        expect(stub.calls[0].headers['Authorization']).toBe('Bearer secret-token');
        expect(queue.pending_count).toBe(0);
        expect(queue.dropped_count).toBe(0);
    });

    it('holds 30, drops 15 and delivers the held chunks in order after a 90 s outage', async () => {
        const stub = makeStub();
        stub.state.up = false;
        const dropped_events: number[] = [];
        const queue = new AudioUploadQueue({ endpoint: EXAMPLE_ENDPOINT, session_id: 's2', fetch_fn: stub.fetch_fn, on_dropped_change: (n) => dropped_events.push(n) });
        for (let i = 0; i < 45; i++) {
            queue.enqueue(makeChunk(i));
            await jest.advanceTimersByTimeAsync(CHUNK_MS);
        }
        expect(queue.pending_count).toBe(AUDIO_QUEUE_MAX_CHUNKS);
        expect(queue.dropped_count).toBe(15);
        expect(dropped_events[dropped_events.length - 1]).toBe(15);
        expect(stub.calls).toHaveLength(0);
        stub.state.up = true;
        await jest.advanceTimersByTimeAsync(AUDIO_RETRY_MAX_MS);
        expect(stub.calls.map((c) => c.sequence)).toEqual(Array.from({ length: 30 }, (_, i) => i + 15));
        expect(queue.pending_count).toBe(0);
    });

    it('treats a non-2xx response as a failure and waits behind the head', async () => {
        const sequences: number[] = [];
        let status = 503;
        const fetch_fn: AudioFetchFn = async (url) => {
            if (status === 200) { sequences.push(Number(url.split('/').pop())); }
            return { ok: status === 200, status };
        };
        const queue = new AudioUploadQueue({ endpoint: EXAMPLE_ENDPOINT, session_id: 's3', fetch_fn });
        queue.enqueue(makeChunk(0));
        queue.enqueue(makeChunk(1));
        await jest.advanceTimersByTimeAsync(5000);
        expect(sequences).toEqual([]);
        expect(queue.pending_count).toBe(2);
        status = 200;
        await jest.advanceTimersByTimeAsync(AUDIO_RETRY_MAX_MS);
        expect(sequences).toEqual([0, 1]);
    });

    it('refuses a chunk whose index is not greater than the last seen', async () => {
        const stub = makeStub();
        const queue = new AudioUploadQueue({ endpoint: EXAMPLE_ENDPOINT, session_id: 's4', fetch_fn: stub.fetch_fn });
        expect(queue.enqueue(makeChunk(3))).toBe(true);
        expect(queue.enqueue(makeChunk(3))).toBe(false);
        expect(queue.enqueue(makeChunk(2))).toBe(false);
        expect(queue.enqueue(makeChunk(5))).toBe(true);
        await jest.advanceTimersByTimeAsync(10);
        expect(stub.calls.map((c) => c.sequence)).toEqual([3, 5]);
    });

    it('stop clears the retry timer and drops held audio', async () => {
        const stub = makeStub();
        stub.state.up = false;
        const queue = new AudioUploadQueue({ endpoint: EXAMPLE_ENDPOINT, session_id: 's5', fetch_fn: stub.fetch_fn });
        queue.enqueue(makeChunk(0));
        await jest.advanceTimersByTimeAsync(10);
        expect(jest.getTimerCount()).toBe(1);
        queue.stop();
        expect(jest.getTimerCount()).toBe(0);
        expect(queue.pending_count).toBe(0);
        expect(queue.enqueue(makeChunk(1))).toBe(false);
        stub.state.up = true;
        await jest.advanceTimersByTimeAsync(AUDIO_RETRY_MAX_MS);
        expect(stub.calls).toHaveLength(0);
    });

    it('a new session gets a fresh id and resets numbering', async () => {
        const stub = makeStub();
        const first = createAudioSession({ endpoint: EXAMPLE_ENDPOINT, fetch_fn: stub.fetch_fn });
        const second = createAudioSession({ endpoint: EXAMPLE_ENDPOINT, fetch_fn: stub.fetch_fn });
        expect(first.session_id).not.toBe(second.session_id);
        expect(first.session_id).toMatch(/^[0-9a-f-]{36}$/);
        first.queue.enqueue(makeChunk(9));
        expect(second.queue.enqueue(makeChunk(0))).toBe(true);
        first.queue.stop();
        second.queue.stop();
    });
});

describe('AudioUploadQueue against a real local server', () => {
    let server: http.Server;
    let port = 0;
    const arrivals: Array<{ sequence: number; at_ms: number; bytes: number; method: string }> = [];

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const at_ms = performance.now();
            let bytes = 0;
            req.on('data', (part: Buffer) => { bytes += part.length; });
            req.on('end', () => {
                arrivals.push({ sequence: Number((req.url ?? '').split('/').pop()), at_ms, bytes, method: req.method ?? '' });
                res.statusCode = 200;
                res.end();
            });
        });
        await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
        port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => { server.close(() => resolve()); });
    });

    it('delivers with a median enqueue-to-arrival time of 300 ms or less', async () => {
        const validated = validateAudioEndpoint(`http://127.0.0.1:${port}/ingest`);
        expect(validated.ok).toBe(true);
        const endpoint = validated.ok ? validated.endpoint : '';
        const queue = new AudioUploadQueue({ endpoint, session_id: 'real' });
        const enqueued_at: number[] = [];
        for (let i = 0; i < 20; i++) {
            enqueued_at.push(performance.now());
            queue.enqueue(makeChunk(i));
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        queue.stop();
        expect(arrivals.map((a) => a.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i));
        expect(arrivals.every((a) => a.bytes === CHUNK_BYTES && a.method === 'PUT')).toBe(true);
        const latencies = arrivals.map((a, i) => a.at_ms - enqueued_at[i]).sort((a, b) => a - b);
        const median = latencies[Math.floor(latencies.length / 2)];
        process.stderr.write(`audioops median enqueue-to-arrival ms: ${median.toFixed(2)}\n`);
        expect(median).toBeLessThanOrEqual(300);
    });
});

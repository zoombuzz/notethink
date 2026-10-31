import { AudioCapture, checkMicrophoneFrame, readAudioWorkletUrl, readMicrophoneFrameEnv, type AudioCaptureOptions, type AudioCaptureStatus, type AudioChunkEvent, type MicrophoneFrameEnv } from './audioCapture';
import { CHUNK_BYTES, WORKLET_PROCESSOR_NAME } from './audiochunkops';

type Listener = () => void;

class FakeTrack {
    stopped = false;
    private listeners: Listener[] = [];
    stop(): void { this.stopped = true; }
    addEventListener(_type: string, listener: Listener): void { this.listeners.push(listener); }
    fireEnded(): void { this.listeners.forEach((listener) => listener()); }
}

class FakeStream {
    track = new FakeTrack();
    getTracks(): FakeTrack[] { return [this.track]; }
}

class FakePort {
    onmessage: ((event: { data: unknown }) => void) | null = null;
}

class FakeNode {
    static instances: FakeNode[] = [];
    port = new FakePort();
    disconnected = false;
    constructor(public context: unknown, public name: string, public node_options: unknown) { FakeNode.instances.push(this); }
    disconnect(): void { this.disconnected = true; }
    emit(chunk_index: number): void {
        this.port.onmessage?.({ data: { chunk_index, pcm: new ArrayBuffer(CHUNK_BYTES) } });
    }
}

class FakeContext {
    state = 'running';
    closed = false;
    modules: string[] = [];
    audioWorklet: { addModule: (url: string) => Promise<void> } | undefined = {
        addModule: async (url: string) => { this.modules.push(url); },
    };
    createMediaStreamSource = jest.fn(() => ({ connect: jest.fn() }));
    resume = jest.fn(async () => { this.state = 'running'; });
    close = jest.fn(async () => { this.closed = true; });
}

interface Rig {
    capture: AudioCapture;
    context: FakeContext;
    stream: FakeStream;
    chunks: AudioChunkEvent[];
    statuses: AudioCaptureStatus[];
    getUserMedia: jest.Mock;
}

function rig(overrides: Partial<AudioCaptureOptions> = {}, getUserMedia?: jest.Mock): Rig {
    const stream = new FakeStream();
    const context = new FakeContext();
    const chunks: AudioChunkEvent[] = [];
    const statuses: AudioCaptureStatus[] = [];
    const gum = getUserMedia ?? jest.fn(async () => stream);
    const capture = new AudioCapture({
        worklet_url: 'https://example.invalid/audioWorklet.js',
        onChunk: (chunk) => chunks.push(chunk),
        onStatus: (status) => statuses.push(status),
        media_devices: { getUserMedia: gum },
        audio_context_factory: () => context as unknown as AudioContext,
        now: () => Date.UTC(2026, 0, 1, 0, 0, 0),
        ...overrides,
    });
    return { capture, context, stream, chunks, statuses, getUserMedia: gum };
}

function domError(name: string): Error {
    const err = new Error(name);
    err.name = name;
    return err;
}

beforeEach(() => {
    FakeNode.instances = [];
    (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeNode;
});

afterEach(() => {
    delete (globalThis as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
});

describe('AudioCapture', () => {
    it('never calls getUserMedia, creates a node or reports status until start() runs', () => {
        const { getUserMedia, statuses, context } = rig();
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(FakeNode.instances.length).toBe(0);
        expect(statuses).toEqual([]);
        expect(context.modules).toEqual([]);
    });

    it('loads the worklet, requests mono audio and reports capturing once live', async () => {
        const { capture, getUserMedia, statuses, context } = rig();
        await capture.start();
        expect(context.modules).toEqual(['https://example.invalid/audioWorklet.js']);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1 } });
        expect(FakeNode.instances[0].name).toBe(WORKLET_PROCESSOR_NAME);
        expect(statuses).toEqual([{ capturing: true }]);
    });

    it('forwards worklet chunks with index, ISO start time on the client clock and a 64000 byte payload', async () => {
        const { capture, chunks } = rig();
        await capture.start();
        FakeNode.instances[0].emit(0);
        FakeNode.instances[0].emit(3);
        expect(chunks.map((c) => c.chunk_index)).toEqual([0, 3]);
        expect(chunks[0].started_at).toBe('2026-01-01T00:00:00.000Z');
        expect(chunks[1].started_at).toBe('2026-01-01T00:00:06.000Z');
        expect(chunks[0].pcm).toBeInstanceOf(Uint8Array);
        expect(chunks[0].pcm.length).toBe(CHUNK_BYTES);
    });

    it('reports NotAllowedError as a status without throwing, and closes the context', async () => {
        const denied = jest.fn(async () => { throw domError('NotAllowedError'); });
        const { capture, statuses, context } = rig({}, denied);
        await expect(capture.start()).resolves.toBeUndefined();
        expect(statuses).toEqual([{ capturing: false, error_name: 'NotAllowedError' }]);
        expect(context.closed).toBe(true);
        expect(capture.isRunning).toBe(false);
    });

    it('reports NotFoundError for a missing device', async () => {
        const missing = jest.fn(async () => { throw domError('NotFoundError'); });
        const { capture, statuses } = rig({}, missing);
        await capture.start();
        expect(statuses).toEqual([{ capturing: false, error_name: 'NotFoundError' }]);
    });

    it('reports Unsupported when getUserMedia is missing', async () => {
        const { capture, statuses } = rig({ media_devices: {} });
        await capture.start();
        expect(statuses).toEqual([{ capturing: false, error_name: 'Unsupported' }]);
    });

    it('reports Unsupported when AudioWorklet is missing, without asking for the microphone', async () => {
        const { capture, statuses, context, getUserMedia } = rig();
        context.audioWorklet = undefined;
        await capture.start();
        expect(statuses).toEqual([{ capturing: false, error_name: 'Unsupported' }]);
        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('reports the error name when the worklet module fails to load', async () => {
        const { capture, statuses, context, getUserMedia } = rig();
        context.audioWorklet = { addModule: async () => { throw domError('AbortError'); } };
        await capture.start();
        expect(statuses).toEqual([{ capturing: false, error_name: 'AbortError' }]);
        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('stop() stops the tracks, disconnects, closes the context and silences further chunks', async () => {
        const { capture, chunks, stream, context, statuses } = rig();
        await capture.start();
        const node = FakeNode.instances[0];
        capture.stop();
        expect(stream.track.stopped).toBe(true);
        expect(node.disconnected).toBe(true);
        expect(context.closed).toBe(true);
        node.emit(1);
        expect(chunks).toEqual([]);
        expect(statuses[statuses.length - 1]).toEqual({ capturing: false });
        expect(capture.isRunning).toBe(false);
    });

    it('stop() while the permission prompt is pending releases the stream when it arrives and reports nothing live', async () => {
        let resolve_stream: (stream: FakeStream) => void = () => {};
        const pending = jest.fn(() => new Promise<FakeStream>((resolve) => { resolve_stream = resolve; }));
        const { capture, stream, statuses } = rig({}, pending);
        const started = capture.start();
        await Promise.resolve();
        capture.stop();
        resolve_stream(stream);
        await started;
        expect(stream.track.stopped).toBe(true);
        expect(statuses).toEqual([{ capturing: false }]);
        expect(FakeNode.instances.length).toBe(0);
    });

    it('reports TrackEnded and releases everything when the device goes away mid-capture', async () => {
        const { capture, stream, statuses, context, chunks } = rig();
        await capture.start();
        stream.track.fireEnded();
        expect(statuses[statuses.length - 1]).toEqual({ capturing: false, error_name: 'TrackEnded' });
        expect(context.closed).toBe(true);
        FakeNode.instances[0].emit(1);
        expect(chunks).toEqual([]);
    });

    it('a second start() while running does nothing', async () => {
        const { capture, getUserMedia } = rig();
        await capture.start();
        await capture.start();
        expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('main-thread cost per chunk stays at or under 2 ms (measured mean and max logged)', async () => {
        const { capture, chunks } = rig();
        await capture.start();
        const node = FakeNode.instances[0];
        const warmup = 100;
        const runs = 2000;
        for (let i = 0; i < warmup; i++) {
            node.emit(i);
        }
        const costs: number[] = [];
        for (let i = 0; i < runs; i++) {
            const t0 = performance.now();
            node.emit(warmup + i);
            costs.push(performance.now() - t0);
        }
        const mean = costs.reduce((a, b) => a + b, 0) / runs;
        const max = Math.max(...costs);
        const p99 = [...costs].sort((a, b) => a - b)[Math.floor(runs * 0.99)];
        process.stdout.write(`audio main-thread cost per chunk over ${runs} after ${warmup} warm-up: mean ${mean.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms, max ${max.toFixed(4)} ms\n`);
        expect(chunks.length).toBe(warmup + runs);
        expect(mean).toBeLessThanOrEqual(2);
        expect(p99).toBeLessThanOrEqual(2);
    });
});

describe('readAudioWorkletUrl', () => {
    afterEach(() => {
        delete (window as unknown as { __notethinkChunkConfig?: unknown }).__notethinkChunkConfig;
    });

    it('returns the url from the chunk config, and undefined when absent', () => {
        expect(readAudioWorkletUrl()).toBeUndefined();
        (window as unknown as { __notethinkChunkConfig: unknown }).__notethinkChunkConfig = { publicPath: '/', nonce: 'n', audio_worklet_url: 'https://example.invalid/w.js' };
        expect(readAudioWorkletUrl()).toBe('https://example.invalid/w.js');
    });
});


describe('checkMicrophoneFrame', () => {
    let get_user_media: jest.Mock;

    function makeEnv(overrides: Partial<MicrophoneFrameEnv> = {}, state = 'prompt'): MicrophoneFrameEnv {
        return {
            policy: { allowsFeature: (feature: string) => feature === 'microphone' },
            media_devices: { getUserMedia: get_user_media },
            permissions: { query: jest.fn(async () => ({ state })) },
            ...overrides,
        };
    }

    beforeEach(() => {
        get_user_media = jest.fn();
    });

    afterEach(() => {
        expect(get_user_media).not.toHaveBeenCalled();
    });

    it.each(['prompt', 'granted'])('allows when the policy allows microphone, getUserMedia exists and the permission is %s', async (state) => {
        await expect(checkMicrophoneFrame(makeEnv({}, state))).resolves.toBe('allowed');
    });

    it('refuses when the permission is already denied', async () => {
        await expect(checkMicrophoneFrame(makeEnv({}, 'denied'))).resolves.toBe('permission-denied');
    });

    it('refuses when the frame policy does not allow microphone, as in a desktop VS Code webview', async () => {
        const env = makeEnv({ policy: { allowsFeature: () => false } });
        await expect(checkMicrophoneFrame(env)).resolves.toBe('policy-refuses');
        expect(env.permissions?.query).not.toHaveBeenCalled();
    });

    it('refuses when the browser has no permissions policy query, as Firefox and Safari do', async () => {
        await expect(checkMicrophoneFrame(makeEnv({ policy: undefined }))).resolves.toBe('no-policy-query');
    });

    it('refuses when the policy query throws', async () => {
        const env = makeEnv({ policy: { allowsFeature: () => { throw new Error('unknown feature'); } } });
        await expect(checkMicrophoneFrame(env)).resolves.toBe('policy-refuses');
    });

    it('refuses when getUserMedia is missing, as outside a secure context', async () => {
        await expect(checkMicrophoneFrame(makeEnv({ media_devices: undefined }))).resolves.toBe('no-getusermedia');
        await expect(checkMicrophoneFrame(makeEnv({ media_devices: {} }))).resolves.toBe('no-getusermedia');
    });

    it('does not refuse when the permissions API is missing or cannot answer for microphone', async () => {
        await expect(checkMicrophoneFrame(makeEnv({ permissions: undefined }))).resolves.toBe('allowed');
        const env = makeEnv({ permissions: { query: async () => { throw new TypeError('microphone is not a valid permission name'); } } });
        await expect(checkMicrophoneFrame(env)).resolves.toBe('allowed');
    });
});

describe('readMicrophoneFrameEnv', () => {
    const doc = document as unknown as Record<string, unknown>;

    afterEach(() => {
        delete doc.permissionsPolicy;
        delete doc.featurePolicy;
    });

    it('reads document.permissionsPolicy first and falls back to document.featurePolicy', () => {
        const feature_policy = { allowsFeature: () => true };
        doc.featurePolicy = feature_policy;
        expect(readMicrophoneFrameEnv().policy).toBe(feature_policy);
        const permissions_policy = { allowsFeature: () => false };
        doc.permissionsPolicy = permissions_policy;
        expect(readMicrophoneFrameEnv().policy).toBe(permissions_policy);
    });

    it('reports no policy in jsdom, which has neither, so the check refuses there', async () => {
        expect(readMicrophoneFrameEnv().policy).toBeUndefined();
        await expect(checkMicrophoneFrame(readMicrophoneFrameEnv())).resolves.toBe('no-policy-query');
    });
});

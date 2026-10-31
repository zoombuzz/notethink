import type * as vscode from 'vscode';
import {
    AUDIO_CHUNK_BYTES,
    AUDIO_ENABLED_STATE_KEY,
    AudioCaptureCoordinator,
    resolveInitialAudioEnabled,
    type AudioPanelRegistration,
    type AudioStateMessage,
} from './AudioCaptureCoordinator';

jest.mock('../lib/errorops', () => ({
    writeToLog: jest.fn(),
    writeToErrorLog: jest.fn(),
    writeToLogAtLevel: jest.fn(),
}));

const ENDPOINT = 'https://transcribe.example.com';
const open_coordinators: AudioCaptureCoordinator[] = [];

afterEach(() => {
    while (open_coordinators.length > 0) { open_coordinators.pop()?.dispose(); }
});

interface Harness {
    coordinator: AudioCaptureCoordinator;
    fetch_fn: jest.Mock;
    update: jest.Mock;
    setEndpoint: (value: string) => void;
    setToken: (value: string | undefined) => void;
    fireChange: () => Promise<void>;
}

function makeHarness(options: { endpoint?: string; remembered?: boolean } = {}): Harness {
    let endpoint = options.endpoint ?? ENDPOINT;
    let token: string | undefined;
    let on_change: () => void = () => {};
    const update = jest.fn(async () => {});
    const fetch_fn = jest.fn(async () => ({ ok: true, status: 200 }));
    const coordinator = new AudioCaptureCoordinator({
        secrets: { get: async () => token } as unknown as vscode.SecretStorage,
        global_state: { get: (_key: string, fallback: boolean) => options.remembered ?? fallback, update } as unknown as vscode.Memento,
        read_endpoint: () => endpoint,
        watch: (_secrets, callback) => {
            on_change = callback;
            return { dispose: jest.fn() } as unknown as vscode.Disposable;
        },
        fetch_fn,
    });
    open_coordinators.push(coordinator);
    return {
        coordinator,
        fetch_fn,
        update,
        setEndpoint: (value) => { endpoint = value; },
        setToken: (value) => { token = value; },
        fireChange: async () => { on_change(); await flush(); },
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) { await Promise.resolve(); }
}

interface FakePanel {
    registration: AudioPanelRegistration;
    posts: Array<Record<string, unknown>>;
    last: () => AudioStateMessage;
}

function openPanel(coordinator: AudioCaptureCoordinator): FakePanel {
    const posts: Array<Record<string, unknown>> = [];
    const registration = coordinator.register((message) => { posts.push(message); });
    return { registration, posts, last: () => posts[posts.length - 1].state as AudioStateMessage };
}

function chunk(index: number): Record<string, unknown> {
    return { type: 'audioChunk', chunk_index: index, started_at: '2026-01-01T00:00:00.000Z', pcm: new Uint8Array(AUDIO_CHUNK_BYTES) };
}

async function startCapture(panel: FakePanel, h: Harness): Promise<void> {
    await h.coordinator.init();
    panel.registration.handleToggle({ enabled: true });
    panel.registration.handleStatus({ capturing: true });
}

describe('resolveInitialAudioEnabled', () => {
    it('starts every window off, whatever was remembered', () => {
        expect(resolveInitialAudioEnabled(true)).toBe(false);
        expect(resolveInitialAudioEnabled(false)).toBe(false);
    });
});

describe('AudioCaptureCoordinator', () => {
    it('with an empty endpoint broadcasts available false, ignores chunks and makes 0 fetches', async () => {
        const h = makeHarness({ endpoint: '' });
        await h.coordinator.init();
        const panel = openPanel(h.coordinator);
        panel.registration.handleToggle({ enabled: true });
        panel.registration.handleStatus({ capturing: true });
        panel.registration.handleChunk(chunk(0));
        expect(panel.last()).toMatchObject({ available: false, enabled: false, owner: true });
        expect(h.fetch_fn).not.toHaveBeenCalled();
        expect(h.update).not.toHaveBeenCalled();
    });

    it('logs each distinct frame check verdict once, ignores malformed ones, and changes no state', () => {
        const write_to_log = jest.requireMock('../lib/errorops').writeToLog as jest.Mock;
        write_to_log.mockClear();
        const h = makeHarness();
        const first = openPanel(h.coordinator);
        const second = openPanel(h.coordinator);
        const posts_before = first.posts.length;
        first.registration.handleFrameCheck({ verdict: 'policy-refuses' });
        second.registration.handleFrameCheck({ verdict: 'policy-refuses' });
        second.registration.handleFrameCheck({ verdict: 'allowed' });
        first.registration.handleFrameCheck({ verdict: 42 });
        first.registration.handleFrameCheck({ verdict: 'Not A Verdict; with spaces' });
        const frame_lines = write_to_log.mock.calls.map((call) => String(call[1])).filter((line) => line.startsWith('microphone frame check'));
        expect(frame_lines).toEqual([
            'microphone frame check: policy-refuses, so the record control stays hidden',
            'microphone frame check: allowed, so the record control is offered',
        ]);
        expect(first.posts.length).toBe(posts_before);
    });

    it('treats an invalid endpoint as unavailable', () => {
        const h = makeHarness({ endpoint: 'http://transcribe.example.com' });
        const panel = openPanel(h.coordinator);
        expect(panel.last().available).toBe(false);
    });

    it('starts off even when the remembered choice is on', () => {
        const h = makeHarness({ remembered: true });
        const panel = openPanel(h.coordinator);
        expect(panel.last()).toMatchObject({ available: true, enabled: false });
    });

    it('persists a toggle to global state and broadcasts it to every panel', () => {
        const h = makeHarness();
        const first = openPanel(h.coordinator);
        const second = openPanel(h.coordinator);
        second.registration.handleToggle({ enabled: true });
        expect(h.update).toHaveBeenCalledWith(AUDIO_ENABLED_STATE_KEY, true);
        expect(first.last().enabled).toBe(true);
        expect(second.last().enabled).toBe(true);
        first.registration.handleToggle({ enabled: false });
        expect(h.update).toHaveBeenLastCalledWith(AUDIO_ENABLED_STATE_KEY, false);
    });

    it('ignores a toggle with no boolean enabled', () => {
        const h = makeHarness();
        const panel = openPanel(h.coordinator);
        panel.registration.handleToggle({ enabled: 'yes' });
        expect(h.update).not.toHaveBeenCalled();
    });

    it('makes the first open panel the owner and hands over in open order', () => {
        const h = makeHarness();
        const first = openPanel(h.coordinator);
        const second = openPanel(h.coordinator);
        const third = openPanel(h.coordinator);
        expect([first.last().owner, second.last().owner, third.last().owner]).toEqual([true, false, false]);
        first.registration.dispose();
        expect([second.last().owner, third.last().owner]).toEqual([true, false]);
        second.registration.dispose();
        expect(third.last().owner).toBe(true);
    });

    it('does not hand ownership to an earlier panel when a later one closes', () => {
        const h = makeHarness();
        const first = openPanel(h.coordinator);
        const second = openPanel(h.coordinator);
        second.registration.dispose();
        expect(first.last().owner).toBe(true);
    });

    it('captures nothing when no viewer is open, and the next viewer starts fresh', async () => {
        const h = makeHarness();
        const first = openPanel(h.coordinator);
        await startCapture(first, h);
        first.registration.handleChunk(chunk(0));
        await flush();
        expect(h.fetch_fn).toHaveBeenCalledTimes(1);
        first.registration.dispose();
        first.registration.handleChunk(chunk(1));
        await flush();
        expect(h.fetch_fn).toHaveBeenCalledTimes(1);
        const next = openPanel(h.coordinator);
        expect(next.last()).toMatchObject({ owner: true, capturing: false, enabled: true });
    });

    it('uploads owner chunks and ignores chunks from other panels', async () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        const other = openPanel(h.coordinator);
        await startCapture(owner, h);
        other.registration.handleChunk(chunk(0));
        await flush();
        expect(h.fetch_fn).not.toHaveBeenCalled();
        owner.registration.handleChunk(chunk(0));
        await flush();
        expect(h.fetch_fn).toHaveBeenCalledTimes(1);
        expect(h.fetch_fn.mock.calls[0][0]).toMatch(/^https:\/\/transcribe\.example\.com\/[^/]+\/0$/);
    });

    it('ignores chunks while disabled, malformed, or before the token has loaded', async () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        owner.registration.handleChunk(chunk(0));
        await h.coordinator.init();
        owner.registration.handleChunk(chunk(0));
        owner.registration.handleToggle({ enabled: true });
        owner.registration.handleChunk({ type: 'audioChunk', chunk_index: 0, started_at: 'x', pcm: new Uint8Array(10) });
        owner.registration.handleChunk({ type: 'audioChunk', chunk_index: 'a', started_at: 'x', pcm: new Uint8Array(AUDIO_CHUNK_BYTES) });
        await flush();
        expect(h.fetch_fn).not.toHaveBeenCalled();
    });

    it('sends the stored token as a bearer header', async () => {
        const h = makeHarness();
        h.setToken('abc');
        const owner = openPanel(h.coordinator);
        await startCapture(owner, h);
        owner.registration.handleChunk(chunk(0));
        await flush();
        expect(h.fetch_fn.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
    });

    it('uses a new session id per capture start, handover and re-enable', async () => {
        const h = makeHarness();
        const first = openPanel(h.coordinator);
        const second = openPanel(h.coordinator);
        await startCapture(first, h);
        const ids = (): string[] => h.fetch_fn.mock.calls.map((call) => String(call[0]).split('/')[3]);
        first.registration.handleChunk(chunk(0));
        await flush();
        first.registration.handleStatus({ capturing: false });
        first.registration.handleStatus({ capturing: true });
        first.registration.handleChunk(chunk(0));
        await flush();
        first.registration.handleToggle({ enabled: false });
        first.registration.handleToggle({ enabled: true });
        first.registration.handleChunk(chunk(0));
        await flush();
        first.registration.dispose();
        second.registration.handleStatus({ capturing: true });
        second.registration.handleChunk(chunk(0));
        await flush();
        expect(new Set(ids()).size).toBe(4);
    });

    it('stops the session and broadcasts when the endpoint is cleared', async () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        await startCapture(owner, h);
        owner.registration.handleChunk(chunk(0));
        await flush();
        h.setEndpoint('');
        await h.fireChange();
        expect(owner.last()).toMatchObject({ available: false, capturing: false });
        owner.registration.handleChunk(chunk(1));
        await flush();
        expect(h.fetch_fn).toHaveBeenCalledTimes(1);
    });

    it('does not resume capture after the endpoint is cleared and set again until a toggle', async () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        await startCapture(owner, h);
        h.setEndpoint('');
        await h.fireChange();
        expect(owner.last()).toMatchObject({ available: false, enabled: false });
        h.setEndpoint(ENDPOINT);
        await h.fireChange();
        expect(owner.last()).toMatchObject({ available: true, enabled: false, capturing: false });
        owner.registration.handleChunk(chunk(0));
        await flush();
        expect(h.fetch_fn).not.toHaveBeenCalled();
        expect(h.update).not.toHaveBeenCalledWith(AUDIO_ENABLED_STATE_KEY, false);
        owner.registration.handleToggle({ enabled: true });
        owner.registration.handleChunk(chunk(0));
        await flush();
        expect(h.fetch_fn).toHaveBeenCalledTimes(1);
    });

    it('starts a new session after the token changes', async () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        await startCapture(owner, h);
        owner.registration.handleChunk(chunk(0));
        await flush();
        h.setToken('rotated');
        await h.fireChange();
        owner.registration.handleChunk(chunk(1));
        await flush();
        expect(h.fetch_fn.mock.calls[1][1].headers.Authorization).toBe('Bearer rotated');
        expect(String(h.fetch_fn.mock.calls[1][0]).split('/')[3]).not.toBe(String(h.fetch_fn.mock.calls[0][0]).split('/')[3]);
    });

    it('propagates the owner microphone error to every panel and clears it on the next start', () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        const other = openPanel(h.coordinator);
        owner.registration.handleToggle({ enabled: true });
        owner.registration.handleStatus({ capturing: false, error_name: 'NotAllowedError' });
        expect(owner.last()).toMatchObject({ error_name: 'NotAllowedError', capturing: false });
        expect(other.last()).toMatchObject({ error_name: 'NotAllowedError', owner: false });
        owner.registration.handleStatus({ capturing: false });
        expect(other.last().error_name).toBe('NotAllowedError');
        owner.registration.handleStatus({ capturing: true });
        expect(other.last().error_name).toBeUndefined();
    });

    it('clears the error when the user toggles on again', () => {
        const h = makeHarness();
        const owner = openPanel(h.coordinator);
        owner.registration.handleToggle({ enabled: true });
        owner.registration.handleStatus({ capturing: false, error_name: 'NotFoundError' });
        owner.registration.handleToggle({ enabled: true });
        expect(owner.last().error_name).toBeUndefined();
    });

    it('ignores a status report from a panel that is not the owner', () => {
        const h = makeHarness();
        openPanel(h.coordinator);
        const other = openPanel(h.coordinator);
        other.registration.handleStatus({ capturing: true });
        expect(other.last().capturing).toBe(false);
    });

    it('sends the current state on request', () => {
        const h = makeHarness();
        const panel = openPanel(h.coordinator);
        const before = panel.posts.length;
        panel.registration.sendState();
        expect(panel.posts.length).toBe(before + 1);
        expect(panel.posts[before]).toMatchObject({ type: 'audioState' });
    });

    it('reports the queue dropped count and resets it for a new session', async () => {
        const h = makeHarness();
        h.fetch_fn.mockImplementation(async () => ({ ok: false, status: 503 }));
        const owner = openPanel(h.coordinator);
        await startCapture(owner, h);
        for (let i = 0; i < 32; i++) {
            owner.registration.handleChunk(chunk(i));
            await flush();
        }
        expect(owner.last().dropped_count).toBe(2);
        owner.registration.handleStatus({ capturing: false });
        owner.registration.handleStatus({ capturing: true });
        owner.registration.handleChunk(chunk(0));
        await flush();
        expect(owner.last().dropped_count).toBe(0);
    });
});

import Debug from 'debug';
import { CHUNK_SECONDS, WORKLET_PROCESSOR_NAME } from './audiochunkops';

const debug = Debug('nodejs:notethink:audioCapture');

const CHUNK_MS = CHUNK_SECONDS * 1000;
export const ERROR_UNSUPPORTED = 'Unsupported';
export const ERROR_TRACK_ENDED = 'TrackEnded';

/**
 * One gated 2 s chunk handed to the owner of the capture.
 * - chunk_index: counts every 2 s window since start(), including windows the energy gate dropped
 * - started_at: ISO 8601 time of the chunk's first sample, on the client clock
 * - pcm: 64000 bytes of PCM16LE, 16 kHz, mono
 */
export interface AudioChunkEvent {
    chunk_index: number;
    started_at: string;
    pcm: Uint8Array;
}

/**
 * Capture state reported to the owner. error_name is a DOMException name from the browser
 * (NotAllowedError, NotFoundError, NotReadableError, SecurityError, ...), Unsupported when
 * getUserMedia or AudioWorklet is missing, or TrackEnded when the device went away mid-capture.
 */
export interface AudioCaptureStatus {
    capturing: boolean;
    error_name?: string;
}

/**
 * Construction options.
 * - worklet_url: URL of the worklet module, loaded with audioWorklet.addModule
 * - media_devices: injected for tests; defaults to navigator.mediaDevices
 * - audio_context_factory: injected for tests; defaults to a new AudioContext at the device rate
 * - now: injected clock in epoch milliseconds; defaults to Date.now
 */
export interface AudioCaptureOptions {
    worklet_url: string;
    onChunk: (chunk: AudioChunkEvent) => void;
    onStatus: (status: AudioCaptureStatus) => void;
    media_devices?: Partial<Pick<MediaDevices, 'getUserMedia'>>;
    audio_context_factory?: () => AudioContext;
    now?: () => number;
}

interface WorkletChunkMessage {
    chunk_index: number;
    pcm: ArrayBuffer;
}

/**
 * What the microphone frame check reads, injected so the check itself stays pure.
 * - policy: the frame's permissions policy (`document.permissionsPolicy`, or the older `document.featurePolicy`); undefined where the browser exposes neither
 * - media_devices: `navigator.mediaDevices`, undefined outside a secure context
 * - permissions: `navigator.permissions`
 */
export interface MicrophoneFrameEnv {
    policy?: { allowsFeature(feature: string): boolean };
    media_devices?: { getUserMedia?: unknown };
    permissions?: { query(descriptor: { name: 'microphone' }): Promise<{ state: string }> };
}

/**
 * Read the live MicrophoneFrameEnv for this frame.
 */
export function readMicrophoneFrameEnv(): MicrophoneFrameEnv {
    const doc = (typeof document === 'undefined' ? undefined : document) as
        (Document & { permissionsPolicy?: MicrophoneFrameEnv['policy']; featurePolicy?: MicrophoneFrameEnv['policy'] }) | undefined;
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    return {
        policy: doc?.permissionsPolicy ?? doc?.featurePolicy,
        media_devices: nav?.mediaDevices,
        permissions: nav?.permissions,
    };
}

/**
 * The outcome of checkMicrophoneFrame. Only `allowed` offers the control; each other value names the first
 * condition that refused, and is what the extension logs so a hidden control can be explained.
 */
export type MicrophoneFrameVerdict = 'allowed' | 'no-policy-query' | 'policy-refuses' | 'no-getusermedia' | 'permission-denied';

/**
 * Whether this frame can be offered the microphone, decided without asking for it: the frame's permissions
 * policy allows `microphone`, `getUserMedia` exists, and the browser does not already report the permission
 * `denied`. A browser with no policy query (Firefox, Safari) counts as unknown and so as a refusal. A
 * permissions API that is missing or cannot answer for `microphone` reports nothing, so it does not refuse.
 *
 * Nothing here knows which editor hosts the frame. Desktop VS Code is refused by measurement, as its webview
 * iframes carry no `microphone` in their allow lists and its permission handlers never grant `media` to a
 * webview, so if a later release grants both, the control appears with no change here.
 *
 * Never calls `getUserMedia`, so no prompt appears before the user presses the button.
 */
export async function checkMicrophoneFrame(env: MicrophoneFrameEnv): Promise<MicrophoneFrameVerdict> {
    if (!env.policy || typeof env.policy.allowsFeature !== 'function') { return 'no-policy-query'; }
    let policy_allows = false;
    try {
        policy_allows = env.policy.allowsFeature('microphone');
    } catch (err) {
        debug('frame check: the policy query failed: %O', err);
    }
    if (!policy_allows) { return 'policy-refuses'; }
    if (typeof env.media_devices?.getUserMedia !== 'function') { return 'no-getusermedia'; }
    if (!env.permissions || typeof env.permissions.query !== 'function') { return 'allowed'; }
    try {
        const status = await env.permissions.query({ name: 'microphone' });
        debug('frame check: microphone permission is %s', status.state);
        return status.state === 'denied' ? 'permission-denied' : 'allowed';
    } catch (err) {
        debug('frame check: the permission query failed: %O', err);
        return 'allowed';
    }
}

/**
 * Read the worklet module URL the extension host put on the chunk config, or undefined when absent.
 */
export function readAudioWorkletUrl(): string | undefined {
    const config = (window as unknown as { __notethinkChunkConfig?: { audio_worklet_url?: string } }).__notethinkChunkConfig;
    return config?.audio_worklet_url || undefined;
}

/**
 * Captures the microphone through an AudioWorklet that resamples, gates and frames the audio off the
 * main thread. Nothing runs until start(); the microphone is never requested before that call.
 */
export class AudioCapture {
    private readonly options: AudioCaptureOptions;
    private generation = 0;
    private running = false;
    private start_ms = 0;
    private context: AudioContext | undefined;
    private stream: MediaStream | undefined;
    private node: AudioWorkletNode | undefined;

    constructor(options: AudioCaptureOptions) {
        this.options = options;
    }

    get isRunning(): boolean {
        return this.running;
    }

    async start(): Promise<void> {
        if (this.running) {
            return;
        }
        this.running = true;
        const generation = ++this.generation;
        try {
            await this.open(generation);
        } catch (err) {
            this.fail(generation, err);
        }
    }

    stop(): void {
        if (!this.running) {
            return;
        }
        this.generation++;
        this.release();
        this.options.onStatus({ capturing: false });
    }

    private async open(generation: number): Promise<void> {
        const devices = this.options.media_devices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
        if (!devices || typeof devices.getUserMedia !== 'function') {
            throw namedError(ERROR_UNSUPPORTED, 'getUserMedia is not available');
        }
        const context = this.createContext();
        this.context = context;
        if (!context.audioWorklet) {
            throw namedError(ERROR_UNSUPPORTED, 'AudioWorklet is not available');
        }
        await context.audioWorklet.addModule(this.options.worklet_url);
        const stream = await devices.getUserMedia({ audio: { channelCount: 1 } });
        if (generation !== this.generation) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        this.stream = stream;
        if (context.state === 'suspended') {
            await context.resume();
        }
        this.connect(context, stream);
        this.options.onStatus({ capturing: true });
    }

    private createContext(): AudioContext {
        if (this.options.audio_context_factory) {
            return this.options.audio_context_factory();
        }
        if (typeof AudioContext === 'undefined') {
            throw namedError(ERROR_UNSUPPORTED, 'AudioContext is not available');
        }
        return new AudioContext();
    }

    private connect(context: AudioContext, stream: MediaStream): void {
        const node = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 0 });
        node.port.onmessage = (event: MessageEvent<WorkletChunkMessage>) => this.handleChunk(event.data);
        context.createMediaStreamSource(stream).connect(node);
        this.node = node;
        this.start_ms = (this.options.now ?? Date.now)();
        const generation = this.generation;
        stream.getTracks().forEach((track) => {
            track.addEventListener('ended', () => this.handleTrackEnded(generation));
        });
    }

    private handleChunk(message: WorkletChunkMessage): void {
        if (!this.running) {
            return;
        }
        this.options.onChunk({
            chunk_index: message.chunk_index,
            started_at: new Date(this.start_ms + message.chunk_index * CHUNK_MS).toISOString(),
            pcm: new Uint8Array(message.pcm),
        });
    }

    private handleTrackEnded(generation: number): void {
        if (generation !== this.generation || !this.running) {
            return;
        }
        debug('input track ended mid-capture');
        this.generation++;
        this.release();
        this.options.onStatus({ capturing: false, error_name: ERROR_TRACK_ENDED });
    }

    private fail(generation: number, err: unknown): void {
        if (generation !== this.generation) {
            return;
        }
        const error_name = err instanceof Error && err.name ? err.name : 'UnknownError';
        debug('capture failed: %s: %O', error_name, err);
        this.generation++;
        this.release();
        this.options.onStatus({ capturing: false, error_name });
    }

    private release(): void {
        this.running = false;
        if (this.node) {
            this.node.port.onmessage = null;
            this.node.disconnect();
        }
        this.stream?.getTracks().forEach((track) => track.stop());
        const context = this.context;
        this.node = undefined;
        this.stream = undefined;
        this.context = undefined;
        context?.close().catch((err: unknown) => debug('closing the audio context failed: %O', err));
    }
}

/**
 * Build an Error whose name matches the DOMException naming the browser uses for the same class of failure.
 */
function namedError(name: string, message: string): Error {
    const err = new Error(message);
    err.name = name;
    return err;
}

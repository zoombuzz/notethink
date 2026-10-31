import type * as vscode from 'vscode';
import { createAudioSession, validateAudioEndpoint, type AudioFetchFn, type AudioSession } from '../lib/audioops';
import { writeToLog, writeToLogAtLevel } from '../lib/errorops';
import { readAudioEndpointSetting, readAudioEndpointToken, watchAudioEndpointChanges } from './audioSettings';

export const AUDIO_ENABLED_STATE_KEY = 'notethink.audio.enabled';
export const AUDIO_CHUNK_BYTES = 64000;
const MAX_ERROR_NAME_LENGTH = 64;
// a frame check verdict is a short kebab-case code such as `policy-refuses`; anything else is ignored
const FRAME_VERDICT_PATTERN = /^[a-z][a-z-]{0,39}$/;
const LOG_SOURCE = 'AudioCaptureCoordinator';

/**
 * The value `enabled` takes when a window starts, given the choice remembered from an earlier window.
 * Every window starts off, because capture starts only from an explicit user action in that window.
 * The remembered choice is still persisted by the coordinator on each toggle, as a record.
 */
export function resolveInitialAudioEnabled(_remembered: boolean): boolean {
    return false;
}

/**
 * The state one panel receives, the wire form of the webview's `AudioState`.
 * - owner: this panel is the one that captures, the first open viewer
 */
export interface AudioStateMessage {
    available: boolean;
    enabled: boolean;
    owner: boolean;
    capturing: boolean;
    error_name?: string;
    dropped_count: number;
}

/**
 * Collaborators and test seams for the coordinator.
 * - read_endpoint, watch, fetch_fn: default to the real settings reader, change watcher and global fetch
 */
export interface AudioCaptureCoordinatorOptions {
    secrets: vscode.SecretStorage;
    global_state: vscode.Memento;
    read_endpoint?: () => string;
    watch?: (secrets: vscode.SecretStorage, on_change: () => void) => vscode.Disposable;
    fetch_fn?: AudioFetchFn;
}

interface PanelEntry {
    post: (message: Record<string, unknown>) => void;
}

/** What one panel holds: its handlers for the audio messages it receives, and a way to leave. */
export interface AudioPanelRegistration {
    sendState: () => void;
    handleToggle: (message: Record<string, unknown>) => void;
    handleChunk: (message: Record<string, unknown>) => void;
    handleStatus: (message: Record<string, unknown>) => void;
    handleFrameCheck: (message: Record<string, unknown>) => void;
    dispose: () => void;
}

/**
 * Window-level owner of audio capture. Panels register in open order; the first still open owns the
 * microphone, and ownership hands to the next when it closes. One upload session runs at a time, held
 * in memory only. With no endpoint configured nothing is read, fetched or started.
 */
export class AudioCaptureCoordinator {
    private readonly panels: PanelEntry[] = [];
    private readonly watcher: vscode.Disposable;
    private available = false;
    private enabled: boolean;
    private capturing = false;
    private error_name: string | undefined;
    private dropped_count = 0;
    private token: string | undefined;
    private token_loaded = false;
    private session: AudioSession | undefined;
    private readonly logged_frame_verdicts = new Set<string>();

    constructor(private readonly options: AudioCaptureCoordinatorOptions) {
        this.enabled = resolveInitialAudioEnabled(options.global_state.get<boolean>(AUDIO_ENABLED_STATE_KEY, false));
        this.available = this.readAvailable();
        this.watcher = (options.watch ?? watchAudioEndpointChanges)(options.secrets, () => { void this.onSettingsChanged(); });
    }

    /** Reads the stored token once; chunks are ignored until this has resolved. */
    async init(): Promise<void> {
        await this.reloadToken();
    }

    register(post: (message: Record<string, unknown>) => void): AudioPanelRegistration {
        const entry: PanelEntry = { post };
        this.panels.push(entry);
        if (this.panels.length === 1) { this.resetCaptureState(); }
        this.broadcast();
        return {
            sendState: () => this.sendTo(entry),
            handleToggle: (message) => this.handleToggle(message),
            handleChunk: (message) => this.handleChunk(entry, message),
            handleStatus: (message) => this.handleStatus(entry, message),
            handleFrameCheck: (message) => this.handleFrameCheck(message),
            dispose: () => this.unregister(entry),
        };
    }

    dispose(): void {
        this.watcher.dispose();
        this.endSession();
    }

    private readAvailable(): boolean {
        return validateAudioEndpoint((this.options.read_endpoint ?? readAudioEndpointSetting)()).ok;
    }

    private async reloadToken(): Promise<void> {
        try {
            this.token = await readAudioEndpointToken(this.options.secrets);
        } catch (err) {
            this.token = undefined;
            writeToLogAtLevel('error', LOG_SOURCE, `could not read the audio endpoint token: ${err instanceof Error ? err.name : 'unknown error'}`);
        }
        this.token_loaded = true;
    }

    private async onSettingsChanged(): Promise<void> {
        await this.reloadToken();
        this.endSession();
        const was_available = this.available;
        this.available = this.readAvailable();
        if (was_available && !this.available) { this.enabled = false; }
        if (!this.available) { this.resetCaptureState(); }
        if (was_available !== this.available) { writeToLog(LOG_SOURCE, `audio capture ${this.available ? 'available' : 'unavailable'}`); }
        this.broadcast();
    }

    private unregister(entry: PanelEntry): void {
        const index = this.panels.indexOf(entry);
        if (index < 0) { return; }
        const was_owner = index === 0;
        this.panels.splice(index, 1);
        if (was_owner) {
            this.endSession();
            this.resetCaptureState();
        }
        this.broadcast();
    }

    private handleToggle(message: Record<string, unknown>): void {
        if (typeof message.enabled !== 'boolean' || !this.available) { return; }
        this.enabled = message.enabled;
        this.error_name = undefined;
        this.endSession();
        if (!this.enabled) { this.capturing = false; }
        this.persistEnabled();
        this.broadcast();
    }

    private persistEnabled(): void {
        Promise.resolve(this.options.global_state.update(AUDIO_ENABLED_STATE_KEY, this.enabled)).catch((err: unknown) => {
            writeToLogAtLevel('error', LOG_SOURCE, `could not remember the audio on or off choice: ${err instanceof Error ? err.name : 'unknown error'}`);
        });
    }

    private handleStatus(entry: PanelEntry, message: Record<string, unknown>): void {
        if (!this.isOwner(entry) || typeof message.capturing !== 'boolean') { return; }
        if (message.capturing && !this.capturing) { this.endSession(); }
        this.capturing = message.capturing;
        if (message.capturing) {
            this.error_name = undefined;
        } else if (typeof message.error_name === 'string' && message.error_name !== '') {
            this.error_name = message.error_name.trim().slice(0, MAX_ERROR_NAME_LENGTH) || 'Error';
            writeToLogAtLevel('error', LOG_SOURCE, `microphone unavailable: ${this.error_name}`);
        }
        this.broadcast();
    }

    /**
     * Logs a viewer's microphone frame check, once per distinct verdict per window, so the output channel
     * says why the record control is hidden (on desktop VS Code today, `policy-refuses`). Changes no state:
     * each viewer already hides its own control when its frame refuses.
     */
    private handleFrameCheck(message: Record<string, unknown>): void {
        if (typeof message.verdict !== 'string' || !FRAME_VERDICT_PATTERN.test(message.verdict)) { return; }
        if (this.logged_frame_verdicts.has(message.verdict)) { return; }
        this.logged_frame_verdicts.add(message.verdict);
        const outcome = message.verdict === 'allowed' ? 'the record control is offered' : 'the record control stays hidden';
        writeToLog(LOG_SOURCE, `microphone frame check: ${message.verdict}, so ${outcome}`);
    }

    private handleChunk(entry: PanelEntry, message: Record<string, unknown>): void {
        if (!this.isOwner(entry) || !this.available || !this.enabled || !this.token_loaded) { return; }
        const pcm = toPcmBytes(message.pcm);
        if (typeof message.chunk_index !== 'number' || typeof message.started_at !== 'string' || !pcm) {
            writeToLogAtLevel('error', LOG_SOURCE, 'ignored a malformed audio chunk');
            return;
        }
        const session = this.session ?? this.startSession();
        session?.queue.enqueue({ chunk_index: message.chunk_index, started_at: message.started_at, pcm });
    }

    private startSession(): AudioSession | undefined {
        const result = validateAudioEndpoint((this.options.read_endpoint ?? readAudioEndpointSetting)());
        if (!result.ok) { return undefined; }
        const had_drops = this.dropped_count > 0;
        this.dropped_count = 0;
        this.session = createAudioSession({
            endpoint: result.endpoint,
            token: this.token,
            fetch_fn: this.options.fetch_fn,
            on_dropped_change: (count) => {
                this.dropped_count = count;
                this.broadcast();
            },
        });
        writeToLog(LOG_SOURCE, 'audio upload session started');
        if (had_drops) { this.broadcast(); }
        return this.session;
    }

    private endSession(): void {
        this.session?.queue.dispose();
        this.session = undefined;
    }

    private resetCaptureState(): void {
        this.capturing = false;
        this.error_name = undefined;
        this.dropped_count = 0;
    }

    private isOwner(entry: PanelEntry): boolean {
        return this.panels[0] === entry;
    }

    private stateFor(entry: PanelEntry): AudioStateMessage {
        const state: AudioStateMessage = {
            available: this.available,
            enabled: this.enabled,
            owner: this.isOwner(entry),
            capturing: this.capturing,
            dropped_count: this.dropped_count,
        };
        if (this.error_name) { state.error_name = this.error_name; }
        return state;
    }

    private sendTo(entry: PanelEntry): void {
        entry.post({ type: 'audioState', state: this.stateFor(entry) });
    }

    private broadcast(): void {
        for (const entry of this.panels) { this.sendTo(entry); }
    }
}

/** The chunk bytes as a Uint8Array of exactly AUDIO_CHUNK_BYTES, or undefined when the payload is not one. */
function toPcmBytes(value: unknown): Uint8Array | undefined {
    let bytes: Uint8Array | undefined;
    if (value instanceof Uint8Array) {
        bytes = value;
    } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
    }
    return bytes && bytes.length === AUDIO_CHUNK_BYTES ? bytes : undefined;
}

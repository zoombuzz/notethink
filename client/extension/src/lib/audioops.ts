import { writeToLog, writeToLogAtLevel } from './errorops';

export const AUDIO_QUEUE_MAX_CHUNKS = 30;
export const AUDIO_RETRY_BASE_MS = 1000;
export const AUDIO_RETRY_MAX_MS = 30000;
const LOOPBACK_IPV4_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LOG_SOURCE = 'audioops';

export interface AudioChunk {
    chunk_index: number;
    started_at: string;
    pcm: Uint8Array;
}

export type AudioEndpointResult =
    | { ok: true; endpoint: string }
    | { ok: false; reason: string };

export interface AudioFetchInit {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array;
}

export type AudioFetchFn = (url: string, init: AudioFetchInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Options for AudioUploadQueue. Timer and fetch functions are injectable so tests control time.
 * - endpoint: a validated endpoint from validateAudioEndpoint (no trailing slash)
 * - session_id: random id for this capture
 * - token: optional bearer credential, sent as Authorization and never logged
 * - fetch_fn, set_timeout, clear_timeout: default to the globals, looked up at call time
 * - on_dropped_change: called with the new dropped count whenever it increases
 */
export interface AudioUploadQueueOptions {
    endpoint: string;
    session_id: string;
    token?: string;
    fetch_fn?: AudioFetchFn;
    set_timeout?: (fn: () => void, ms: number) => unknown;
    clear_timeout?: (handle: unknown) => void;
    on_dropped_change?: (dropped_count: number) => void;
}

/**
 * Validate a configured audio endpoint. https: any host; http: loopback hosts only
 * (localhost, 127.0.0.0/8, [::1]). Refused: other schemes, embedded credentials, unparsable input,
 * and any query string or fragment, because chunk paths are appended to the endpoint and a
 * query or fragment would swallow them (the conservative choice over rewriting the URL).
 * Returns the endpoint without trailing slashes, or the reason it was refused.
 */
export function validateAudioEndpoint(raw: string): AudioEndpointResult {
    const text = (raw ?? '').trim();
    if (text === '') { return { ok: false, reason: 'endpoint is empty' }; }
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return { ok: false, reason: 'endpoint is not a valid URL' };
    }
    if (url.username !== '' || url.password !== '') { return { ok: false, reason: 'endpoint must not contain credentials' }; }
    if (text.includes('?') || text.includes('#')) { return { ok: false, reason: 'endpoint must not contain a query string or fragment' }; }
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) { return { ok: false, reason: 'http is allowed only for a loopback host' }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') { return { ok: false, reason: `scheme ${url.protocol} is not allowed` }; }
    return { ok: true, endpoint: text.replace(/\/+$/, '') };
}

/** True for localhost, any 127.0.0.0/8 address and the IPv6 loopback. */
export function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === 'localhost' || host === '[::1]' || LOOPBACK_IPV4_PATTERN.test(host);
}

/** The upload URL for one chunk, with exactly one slash between each part. */
export function audioChunkUrl(endpoint: string, session_id: string, sequence: number): string {
    return `${endpoint.replace(/\/+$/, '')}/${session_id}/${sequence}`;
}

/** The request headers for one chunk; the Authorization header appears only when a token is given. */
export function audioChunkHeaders(started_at: string, token?: string): Record<string, string> {
    const headers: Record<string, string> = {
        'X-Chunk-Started-At': started_at,
        'Content-Type': 'application/octet-stream',
    };
    if (token) { headers['Authorization'] = `Bearer ${token}`; }
    return headers;
}

/** Delay before retry number `attempt` (1-based): doubles from the base, capped. */
export function audioRetryDelayMs(attempt: number): number {
    const exponent = Math.min(Math.max(attempt - 1, 0), 20);
    return Math.min(AUDIO_RETRY_BASE_MS * 2 ** exponent, AUDIO_RETRY_MAX_MS);
}

function defaultFetch(url: string, init: AudioFetchInit): Promise<{ ok: boolean; status: number }> {
    return fetch(url, init as unknown as RequestInit);
}

/**
 * In-memory ordered upload queue. Holds at most AUDIO_QUEUE_MAX_CHUNKS, dropping the oldest when
 * full, delivers strictly in order and retries a failing head with capped exponential backoff.
 * Nothing is persisted. stop() clears the retry timer and discards held audio.
 */
export class AudioUploadQueue {
    private readonly options: AudioUploadQueueOptions;
    private readonly held: AudioChunk[] = [];
    private dropped = 0;
    private last_index = -1;
    private attempt = 0;
    private in_flight = false;
    private stopped = false;
    private timer: unknown;
    private outage_logged = false;

    constructor(options: AudioUploadQueueOptions) {
        this.options = options;
    }

    get dropped_count(): number {
        return this.dropped;
    }

    get pending_count(): number {
        return this.held.length;
    }

    /** Queue a chunk for upload; returns false when it is refused (stopped, or index not increasing). */
    enqueue(chunk: AudioChunk): boolean {
        if (this.stopped) { return false; }
        if (!Number.isInteger(chunk.chunk_index) || chunk.chunk_index <= this.last_index) {
            writeToLogAtLevel('error', LOG_SOURCE, `chunk index ${chunk.chunk_index} is not greater than ${this.last_index}, not uploaded`);
            return false;
        }
        this.last_index = chunk.chunk_index;
        this.held.push(chunk);
        this.trimToLimit();
        void this.pump();
        return true;
    }

    /** Clear timers and drop held audio. The queue accepts nothing afterwards. */
    stop(): void {
        this.stopped = true;
        if (this.timer !== undefined) {
            (this.options.clear_timeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
            this.timer = undefined;
        }
        this.held.length = 0;
    }

    dispose(): void {
        this.stop();
    }

    private trimToLimit(): void {
        let changed = false;
        while (this.held.length > AUDIO_QUEUE_MAX_CHUNKS) {
            this.held.shift();
            this.dropped += 1;
            changed = true;
        }
        if (changed) { this.options.on_dropped_change?.(this.dropped); }
    }

    private async pump(): Promise<void> {
        if (this.in_flight || this.timer !== undefined || this.stopped) { return; }
        this.in_flight = true;
        try {
            for (let i = 0; i <= AUDIO_QUEUE_MAX_CHUNKS * 2 && this.held.length > 0 && !this.stopped; i++) {
                const head = this.held[0];
                const ok = await this.send(head);
                if (this.stopped) { return; }
                if (!ok) { this.scheduleRetry(); return; }
                if (this.held[0] === head) { this.held.shift(); }
                this.recordSuccess();
            }
        } finally {
            this.in_flight = false;
        }
        if (this.held.length > 0 && !this.stopped && this.timer === undefined) { void this.pump(); }
    }

    private async send(chunk: AudioChunk): Promise<boolean> {
        const fetch_fn = this.options.fetch_fn ?? defaultFetch;
        const url = audioChunkUrl(this.options.endpoint, this.options.session_id, chunk.chunk_index);
        try {
            const response = await fetch_fn(url, {
                method: 'PUT',
                headers: audioChunkHeaders(chunk.started_at, this.options.token),
                body: chunk.pcm,
            });
            if (!response.ok) { this.logFailure(`status ${response.status}`); }
            return response.ok;
        } catch (error) {
            this.logFailure(error instanceof Error ? error.name : 'network error');
            return false;
        }
    }

    private logFailure(detail: string): void {
        if (this.outage_logged) { return; }
        this.outage_logged = true;
        writeToLogAtLevel('error', LOG_SOURCE, `audio upload failing (${detail}), holding chunks and retrying`);
    }

    private recordSuccess(): void {
        this.attempt = 0;
        if (!this.outage_logged) { return; }
        this.outage_logged = false;
        writeToLog(LOG_SOURCE, `audio upload recovered, ${this.held.length} chunks still held`);
    }

    private scheduleRetry(): void {
        this.attempt += 1;
        const set_timer = this.options.set_timeout ?? ((fn, ms) => setTimeout(fn, ms));
        this.timer = set_timer(() => {
            this.timer = undefined;
            void this.pump();
        }, audioRetryDelayMs(this.attempt));
    }
}

/** A capture session: a fresh random id and the queue that numbers and uploads its chunks. */
export interface AudioSession {
    session_id: string;
    queue: AudioUploadQueue;
}

/** Start a new session with a fresh id and empty queue. Stop the previous session's queue first. */
export function createAudioSession(options: Omit<AudioUploadQueueOptions, 'session_id'>, make_id: () => string = () => crypto.randomUUID()): AudioSession {
    const session_id = make_id();
    return { session_id, queue: new AudioUploadQueue({ ...options, session_id }) };
}

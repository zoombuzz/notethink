import Debug from 'debug';
import { useEffect, useMemo, useState } from 'react';
import { parse } from '../lib/parseops';
import { ParseScheduler, type ParseSchedulerEvent } from '../../../extension/src/lib/ParseScheduler';
import type { ParseWorkerRequest, ParseWorkerResponse } from '../parseWorker';
import type { Root as MdastRoot } from 'mdast';
import type { HashMapOf, Doc } from '../types/general';

const debug = Debug("nodejs:notethink:useWorkerParsedDocs");

// the compiled worker bundle's filename, served from the same directory as index.js
const PARSE_WORKER_BUNDLE_FILENAME = 'parseWorker.js';

interface ParsedEntry {
    content_key: string;
    content: MdastRoot;
}

interface ChunkLoadingConfig {
    publicPath: string;
    nonce: string;
}

/**
 * Counts which path a folder doc's parse actually took. worker_parses should be the whole count
 * wherever a worker can be created at all; fallback_parses staying at 0 there confirms the
 * off-thread path is genuinely in use, not just present.
 */
export interface ParseModeProbe {
    worker_parses: number;
    fallback_parses: number;
}

const parse_mode_probe: ParseModeProbe = { worker_parses: 0, fallback_parses: 0 };

// the perf harness reads this off the page, where it has no way to reach a module-private binding
(globalThis as { __notethink_parse_mode_probe?: ParseModeProbe }).__notethink_parse_mode_probe = parse_mode_probe;

/** A snapshot of the parse-mode probe. Returns a copy so a caller can compare two readings. */
export function parseModeProbe(): ParseModeProbe {
    return { ...parse_mode_probe };
}

/** Zero the parse-mode probe. Each test case that asserts on it resets first, since the counts are process-wide. */
export function resetParseModeProbe(): void {
    parse_mode_probe.worker_parses = 0;
    parse_mode_probe.fallback_parses = 0;
}

// must stay in sync with mergeAggregateRoot's docContentKey - the identity a re-parse is keyed on
function docContentKey(doc: Doc): string {
    return doc.hash_sha256 ?? doc.text ?? '';
}

// a folder-mode doc that arrived without `content` and needs parsing
function needsParsing(doc: Doc): boolean {
    return doc.content === undefined && doc.text !== undefined;
}

/*
 * The worker bundle's URL, built from the same chunk config chunkLoading.ts reads for split
 * view/note chunks, so no separate wiring is needed to locate it. Undefined before that config
 * exists (no webview bootstrap yet, or a non-webview test environment).
 */
function workerBundleUrl(): string | undefined {
    const config = (window as unknown as { __notethinkChunkConfig?: ChunkLoadingConfig }).__notethinkChunkConfig;
    if (!config?.publicPath) { return undefined; }
    return `${config.publicPath}${PARSE_WORKER_BUNDLE_FILENAME}`;
}

// true when the runtime can create a Web Worker; false under Jest/jsdom, so the caller falls back to parsing inline
function workerCapable(): boolean {
    return typeof Worker !== 'undefined'
        && typeof fetch !== 'undefined'
        && typeof Blob !== 'undefined'
        && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/**
 * A small pool of nested parse workers, one per webview session. A single shared worker would
 * serialise every folder doc's parse behind it - a Worker is itself single-threaded - so a pool of
 * workers gives genuine parallelism instead. Every slot's worker runs the same fetched script: the
 * blob: URL is created once and backs any number of `new Worker(...)` instances, loaded via
 * fetch-then-blob since a vscode-webview: URI can't always be used directly as a Worker source.
 * Slot, queue and crash mechanics live in the ParseScheduler shared with the extension host's pool;
 * this adapter keeps the blob preparation, the id/hash response check and the parse-mode probe.
 */
class ParseWorkerPool {
    private blob_url: string | undefined;
    // true once preparing the worker bundle fails outright; every call then falls back to inline parsing rather than retry
    private prepare_failed = false;
    private preparing: Promise<void> | undefined;
    private readonly scheduler: ParseScheduler<Doc, MdastRoot | undefined, ParseWorkerRequest, ParseWorkerResponse>;

    constructor(pool_size?: number, queue_max_length?: number) {
        this.scheduler = new ParseScheduler({
            createWorker: () => new Worker(this.blob_url!),
            buildRequest: (doc) => ({ id: doc.id, hash: docContentKey(doc), text: doc.text! }),
            matchesRequest: (request, response) => response.id === request.id && response.hash === request.hash,
            // a worker answer is what the probe counts as an off-thread parse; an error answer is not one
            decodeResponse: (response) => {
                if ('error' in response) { throw new Error(response.error); }
                parse_mode_probe.worker_parses++;
                return response.content;
            },
            parseInline: (doc) => this.fallback(doc),
            onEvent: logSchedulerEvent,
        }, { pool_size, queue_max_length });
    }

    /** Parses one doc's text off-thread when a worker slot is available, inline otherwise - never left permanently unparsed. */
    async parse(doc: Doc): Promise<MdastRoot | undefined> {
        if (!this.prepare_failed && this.blob_url === undefined) {
            if (!this.preparing) { this.preparing = this.prepareBlobUrl(); }
            await this.preparing;
        }
        if (this.prepare_failed) { return this.fallback(doc); }
        try {
            return await this.scheduler.submit(doc);
        } catch (err) {
            // a worker error answer, a queue overflow or a disposal: the doc stays unparsed until its next change
            debug('worker parse did not complete for %s: %O', doc.path, err);
            return undefined;
        }
    }

    // the synchronous main-thread parse, counted for the probe so a silent fallback doesn't look like a worker parse
    private fallback(doc: Doc): MdastRoot | undefined {
        parse_mode_probe.fallback_parses++;
        try {
            return parse(doc.text!);
        } catch (err) {
            debug('synchronous fallback parse failed for %s: %O', doc.path, err);
            return undefined;
        }
    }

    // fetches the worker script once into a blob: URL every slot constructs from; sets prepare_failed on any failure
    private async prepareBlobUrl(): Promise<void> {
        if (!workerCapable()) { this.prepare_failed = true; return; }
        const url = workerBundleUrl();
        if (!url) { this.prepare_failed = true; return; }
        try {
            const response = await fetch(url);
            const source = await response.text();
            const blob = new Blob([source], { type: 'application/javascript' });
            this.blob_url = URL.createObjectURL(blob);
        } catch (err) {
            debug('parse worker bundle unavailable, falling back to synchronous parse: %O', err);
            this.prepare_failed = true;
        }
    }
}

function logSchedulerEvent(event: ParseSchedulerEvent): void {
    if (event.kind === 'spawned') { debug('spawned parse worker %d/%d', event.slot_count, event.pool_size); }
    else if (event.kind === 'spawn_failed') { debug('failed to spawn a parse worker slot, falling back to synchronous parse: %O', event.error); }
    else { debug('parse worker crashed, falling back to synchronous parse for the in-flight doc: %O', event.error); }
}

// one pool for the whole session, shared across every call site rather than one worker per composer
const parse_worker_pool = new ParseWorkerPool();

/*
 * Module-level, not per-hook-instance, so releaseFolderDocContent (called from FolderTreeComposer,
 * far from this hook) can reach the same cache without threading a callback through props.
 *
 * `resolved` remembers every (id, content_key) ever resolved and is never cleared by a release: it
 * stops the effect below from re-parsing a doc whose content has already been released after being
 * fully digested. A genuine content change carries a new content_key, which `resolved` has never
 * seen, so it always triggers a fresh parse.
 */
const cache = new Map<string, ParsedEntry>();
const pending = new Set<string>();
const resolved = new Set<string>();

/**
 * Drops a folder doc's parsed content once its merge has cached what it needed, so the webview
 * never holds a second full mdast per doc (which can be 10x+ the file's text size). A no-op if
 * `content_key` doesn't match what's cached (a stale or already-released call). current_file mode
 * never calls this: its docs carry `content` directly, never through this cache.
 */
export function releaseFolderDocContent(id: string, content_key: string): void {
    const cached = cache.get(id);
    if (cached && cached.content_key === content_key) { cache.delete(id); }
}

/** Test-only: clears every module-level cache this hook keeps, so one test's docs can't leak into the next. */
export function resetWorkerParsedDocsCacheForTests(): void {
    cache.clear();
    pending.clear();
    resolved.clear();
}

/**
 * Fills in `content` for any doc that arrived without it (folder-mode, text-only) by parsing off
 * the main thread; docs that already carry `content` pass through untouched. A doc awaiting its
 * parse is returned as-is, which composers already treat as not ready, so the board renders every
 * other file immediately and this one joins on its next commit. Parsed once per (id, content_key);
 * never re-parsed while unchanged, including a doc already released via releaseFolderDocContent.
 */
export function useWorkerParsedDocs(docs: HashMapOf<Doc> | undefined): HashMapOf<Doc> | undefined {
    const [resolved_tick, setResolvedTick] = useState(0);
    useEffect(() => {
        if (!docs) { return; }
        const known_ids = new Set(Object.keys(docs));
        // forget bookkeeping for docs no longer on the board, or `resolved` grows one entry per (id, hash) ever seen
        for (const key of [...resolved]) { if (!known_ids.has(key.slice(0, key.indexOf(':')))) { resolved.delete(key); } }
        for (const id of [...cache.keys()]) { if (!known_ids.has(id)) { cache.delete(id); } }
        for (const [id, doc] of Object.entries(docs)) {
            if (!needsParsing(doc)) { continue; }
            const content_key = docContentKey(doc);
            const resolved_key = `${id}:${content_key}`;
            if (resolved.has(resolved_key)) { continue; }
            if (pending.has(resolved_key)) { continue; }
            pending.add(resolved_key);
            void parse_worker_pool.parse(doc).then((content) => {
                pending.delete(resolved_key);
                if (!content) { return; }
                cache.set(id, { content_key, content });
                resolved.add(resolved_key);
                setResolvedTick((tick) => tick + 1);
            });
        }
    }, [docs]);
    return useMemo(() => {
        if (!docs) { return docs; }
        let changed = false;
        const next: HashMapOf<Doc> = {};
        for (const [id, doc] of Object.entries(docs)) {
            const cached = needsParsing(doc) ? cache.get(id) : undefined;
            if (cached && cached.content_key === docContentKey(doc)) {
                next[id] = { ...doc, content: cached.content };
                changed = true;
            } else {
                next[id] = doc;
            }
        }
        return changed ? next : docs;
        // resolved_tick forces a recompute when a pending parse resolves - the cache ref isn't visible to useMemo's own comparison
    }, [docs, resolved_tick]);
}

import * as path from 'path';
import {
    ACTIVITY_CONTRACT_VERSION,
    ACTIVITY_DIGEST_MAX_BYTES,
    ACTIVITY_DIR,
    ACTIVITY_EVENTS_MAX_BYTES,
    ACTIVITY_MANIFEST_MAX_BYTES,
    ACTIVITY_SESSIONS_DIR,
    ACTIVITY_SESSION_MAX_BYTES,
    ACTIVITY_TREE_MAX_BYTES,
    type ActivityCapabilities,
    type ActivityChangedFile,
    type ActivityDigest,
    type ActivityEvent,
    type ActivityManifest,
    type ActivityProducer,
    type ActivityRejectCode,
    type ActivitySession,
    type ActivityTree,
} from '../types/AgentActivity';
import { isActivityBlobPath, isActivityProducerLive, type activityFileKindFromFileName } from './activityops';
import type { HashMapOf } from '../types/general';

/**
 * What the reader holds after reading a `.notethink/` directory, and the snapshot it posts to the
 * webview. `activityops.ts` parses one file; this module accumulates the files into a store and
 * folds the store into one message payload. ACTIVITY_CONTRACT.md is the specification behind both.
 *
 * The snapshot is NOT the contract: it is NoteThink's own extension-to-webview message, so it may
 * carry things the contract does not, and must carry everything the webview's join needs. The join
 * is by document path and story id, and a producer writes every path relative to the contract root,
 * never to the workspace. So each entry carries the contract root as the reader found it: absolute,
 * for the host's own opens, and workspace-relative, which is the one spelling that turns a declared
 * `doc_path` into the path a note carries. Neither is an alternative reading of the other, and the
 * session's `project` is a directory name rather than a path, so nothing is joined to it.
 * NoteProps stays free of all of it.
 *
 * The snapshot carries no timestamp on purpose. The producer rewrites its manifest every heartbeat
 * whether or not anything changed, so the reader compares one snapshot against the last and posts
 * only a different one; a generated-at field would make every heartbeat a fresh message and repaint
 * the board for nothing.
 *
 * These functions are pure, so the watcher's I/O and logging stay testable separately.
 */

// the file kinds activityFileKindFromFileName recognises, derived from it so the two cannot drift
export type ActivityFileKind = NonNullable<ReturnType<typeof activityFileKindFromFileName>>;

export const ACTIVITY_BAND_UNCOMMITTED = 'uncommitted';
export const ACTIVITY_BAND_COMMITTED = 'committed';

/**
 * ActivityRefusal is one contract file the reader would not read, carried to the webview so an empty
 * board over a failed read never looks like an idle one.
 * - file: the contract-relative name of the file at fault, never an absolute path
 * - code: the machine-readable reason, so a test and a card's copy both key off it rather than off a message string
 * - reason: the detail naming what was wrong, including what a partial read dropped
 * - session_id: the session the file belongs to, for the three per-session files, so a refusal can be drawn on the row it concerns without the name being parsed again downstream
 */
export interface ActivityRefusal {
    file: string;
    code: ActivityRejectCode;
    reason: string;
    session_id?: string;
}

/**
 * ActivitySessionFiles is the three per-session files as the reader last read them. Each is absent
 * until a good read lands and then keeps its last good value, because a producer writes while the
 * reader reads: a file that fails to parse leaves what was read before it in place.
 */
export interface ActivitySessionFiles {
    session?: ActivitySession;
    events?: ActivityEvent[];
    digest?: ActivityDigest;
}

/**
 * ActivityContractRoot is one `.notethink/` directory and everything read out of it.
 * - root_path: absolute posix path of the repository holding the contract directory
 * - root_relative: the same directory relative to its workspace folder, which is what a declared contract-root-relative path is joined to for the webview's join against a note's own path
 * - sessions: keyed by session id, holding every session file read, whether or not the manifest still declares it
 * - refusals: keyed by the absolute path of the file at fault, so a later clean read of that file clears it; the snapshot carries only the contract-relative name
 */
export interface ActivityContractRoot {
    root_path: string;
    root_relative: string;
    manifest?: ActivityManifest;
    tree?: ActivityTree;
    sessions: HashMapOf<ActivitySessionFiles>;
    refusals: HashMapOf<ActivityRefusal>;
}

export type ActivityStore = HashMapOf<ActivityContractRoot>;

/**
 * ActivityProducerState answers "is anything writing here at all" for one contract directory.
 * - live: the manifest was written within the producer's own declared heartbeat window; false covers a stopped producer and a contract directory with no readable manifest alike, and the webview says which from the other fields
 * - declared_session_ids: what the manifest declares, which is authoritative about what is live
 * - unreadable_session_ids: declared here and not readable, so the board can say three were declared and two could be read
 * - refusals: one entry per file this reader refused or read with entries dropped, because a board that silently drops what it cannot read looks exactly like a board with nothing happening on it
 */
export interface ActivityProducerState {
    root_path: string;
    root_relative: string;
    project: string;
    producer?: ActivityProducer;
    written_at?: string;
    heartbeat_seconds?: number;
    live: boolean;
    capabilities: ActivityCapabilities;
    declared_session_ids: string[];
    unreadable_session_ids: string[];
    refusals: ActivityRefusal[];
}

/**
 * ActivitySessionState is one declared, readable session with the files that belong to it.
 * - events: in write order, never re-sorted by their timestamps, and empty when the session has no event log
 * - digest: absent when no digest was written or the one written was refused
 */
export interface ActivitySessionState {
    root_path: string;
    root_relative: string;
    session: ActivitySession;
    events: ActivityEvent[];
    digest?: ActivityDigest;
}

export interface ActivityTreeState {
    root_path: string;
    root_relative: string;
    tree: ActivityTree;
}

/**
 * ActivitySnapshot is the whole activity payload: every contract directory in the workspace, the
 * sessions its manifest declares, and its working tree. An empty snapshot is a meaningful answer,
 * not a missing one: it says no producer is writing anywhere the host can see.
 */
export interface ActivitySnapshot {
    contract_version: string;
    producers: ActivityProducerState[];
    sessions: ActivitySessionState[];
    trees: ActivityTreeState[];
}

/**
 * The repository directory holding a contract file, or undefined when the path is not one of the
 * contract's own files. The shape is checked rather than assumed: only `<root>/.notethink/<file>`
 * and `<root>/.notethink/sessions/<file>` are contract files, so a path that merely mentions the
 * directory somewhere is refused.
 */
export function activityContractRootFor(file_path: string): string | undefined {
    const segments = file_path.split('/');
    const dir_index = segments.lastIndexOf(ACTIVITY_DIR);
    if (dir_index < 1) { return undefined; }
    const tail = segments.slice(dir_index + 1);
    const is_root_file = tail.length === 1;
    const is_session_file = tail.length === 2 && tail[0] === ACTIVITY_SESSIONS_DIR;
    if (!is_root_file && !is_session_file) { return undefined; }
    return segments.slice(0, dir_index).join('/');
}

/**
 * A contract file's name relative to the contract directory, `manifest.json` or
 * `sessions/<id>.session.json`. A refusal names the file this way rather than by its absolute path,
 * which is a machine's path and not the producer author's.
 */
export function activityContractRelative(root_path: string, file_path: string): string {
    const prefix = `${path.posix.join(root_path, ACTIVITY_DIR)}/`;
    return file_path.startsWith(prefix) ? file_path.slice(prefix.length) : path.posix.basename(file_path);
}

/** the bound a file of this kind is refused over, checked against its byte size before it is decoded */
export function activityMaxBytesForKind(kind: ActivityFileKind): number {
    switch (kind) {
        case 'manifest': return ACTIVITY_MANIFEST_MAX_BYTES;
        case 'tree': return ACTIVITY_TREE_MAX_BYTES;
        case 'session': return ACTIVITY_SESSION_MAX_BYTES;
        case 'events': return ACTIVITY_EVENTS_MAX_BYTES;
        case 'digest': return ACTIVITY_DIGEST_MAX_BYTES;
    }
}

/**
 * The absolute path of a blob a changed file references, or undefined when the reference is absent
 * or is not confined to `blobs/`. The reference becomes a file URI, so an unchecked one walks out
 * of the contract directory and opens whatever it names.
 */
export function activityBlobPathFor(root_path: string, blob_reference: string | undefined): string | undefined {
    if (!isActivityBlobPath(blob_reference)) { return undefined; }
    return path.posix.join(root_path, ACTIVITY_DIR, blob_reference);
}

/**
 * The changed file a band lists at this path, or undefined when the band does not list it. This is
 * the admission gate for opening a diff: a path the contract does not list is never opened, which
 * is what lets a non-markdown path be opened at all.
 *
 * The band is never guessed. The two bands measure against different left-hand sides, so a request
 * naming neither band answers nothing rather than answering from the wrong one.
 */
export function activityChangedFileIn(tree: ActivityTree, band: string, file_path: string): ActivityChangedFile | undefined {
    if (band === ACTIVITY_BAND_UNCOMMITTED) { return tree.uncommitted.find((entry) => entry.path === file_path); }
    if (band === ACTIVITY_BAND_COMMITTED) { return tree.committed.find((entry) => entry.path === file_path); }
    return undefined;
}

export function emptyActivityContractRoot(root_path: string, root_relative: string): ActivityContractRoot {
    return { root_path, root_relative, sessions: {}, refusals: {} };
}

function producerStateFor(root: ActivityContractRoot, now_ms: number): ActivityProducerState {
    const manifest = root.manifest;
    const declared_session_ids = manifest ? [...manifest.sessions] : [];
    const unreadable_session_ids = declared_session_ids.filter((session_id) => root.sessions[session_id]?.session === undefined);
    return {
        root_path: root.root_path,
        root_relative: root.root_relative,
        project: path.posix.basename(root.root_path),
        producer: manifest?.producer,
        written_at: manifest?.written_at,
        heartbeat_seconds: manifest?.heartbeat_seconds,
        live: manifest !== undefined && isActivityProducerLive(manifest, now_ms),
        capabilities: manifest?.capabilities ?? {},
        declared_session_ids,
        unreadable_session_ids,
        refusals: Object.values(root.refusals).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
    };
}

/**
 * The declared, readable sessions of one contract directory. The manifest is authoritative about
 * which sessions are live, so a session file left behind by a crashed producer is held in the store
 * and drawn nowhere, rather than shown as an agent that never stops working.
 */
function sessionStatesFor(root: ActivityContractRoot): ActivitySessionState[] {
    const declared = root.manifest ? [...root.manifest.sessions].sort() : [];
    const states: ActivitySessionState[] = [];
    for (const session_id of declared) {
        const files = root.sessions[session_id];
        if (!files?.session) { continue; }
        states.push({
            root_path: root.root_path,
            root_relative: root.root_relative,
            session: files.session,
            events: files.events ?? [],
            digest: files.digest,
        });
    }
    return states;
}

/**
 * Fold everything read so far into one payload. Every list is sorted by a stable key so an
 * unchanged store always serialises identically and the reader can skip posting it again.
 */
export function buildActivitySnapshot(store: ActivityStore, now_ms: number): ActivitySnapshot {
    const roots = Object.values(store).sort((a, b) => a.root_path < b.root_path ? -1 : a.root_path > b.root_path ? 1 : 0);
    const trees: ActivityTreeState[] = [];
    const sessions: ActivitySessionState[] = [];
    for (const root of roots) {
        if (root.tree) { trees.push({ root_path: root.root_path, root_relative: root.root_relative, tree: root.tree }); }
        sessions.push(...sessionStatesFor(root));
    }
    return {
        contract_version: ACTIVITY_CONTRACT_VERSION,
        producers: roots.map((root) => producerStateFor(root, now_ms)),
        sessions,
        trees,
    };
}

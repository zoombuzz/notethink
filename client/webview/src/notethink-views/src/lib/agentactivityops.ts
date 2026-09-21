import Debug from "debug";
import {
    ACTIVITY_CAPABILITY_SUPPORTED,
    ACTIVITY_CONTRACT_VERSION,
    ACTIVITY_STATES,
    ACTIVITY_STATE_UNKNOWN,
    type ActivityCapabilities,
    type ActivityChangedFile,
    type ActivityDigest,
    type ActivityEvent,
    type ActivityProducer,
    type ActivityRejectCode,
    type ActivitySession,
    type ActivityState,
    type ActivityTree,
} from "../types/AgentActivity";
import { hueForProjectName } from "./originops";
import { makeVirtualNote } from "./virtualnoteops";
import type { NoteProps } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:agentactivityops");

/**
 * The webview's half of the agent activity contract: the snapshot the extension host posts, and the
 * joins between a story note and the sessions working on it. ACTIVITY_CONTRACT.md at the repo root is
 * the specification and `types/AgentActivity.ts` holds the contract's own shapes; nothing here
 * re-decides either.
 *
 * The snapshot is NOT the contract. It is NoteThink's own extension-to-webview message, mirrored from
 * `client/extension/src/lib/activitystoreops.ts` because the two bundles share no module graph, and
 * it carries what the contract does not: where each `.notethink/` directory was found. A workspace
 * folder can hold several repositories, each with its own producer, so every entry is per contract
 * root and nothing about it is singular.
 *
 * Activity travels on that message rather than on NoteProps, which is the mdast contract and stays
 * free of agent, git and process fields. The join to a card is made here, at render.
 *
 * THE JOIN RESOLVES EXACTLY ONE WAY. A producer runs inside a repository and cannot know how the
 * user arranged their VS Code workspace - the same repository may be opened directly, as one folder
 * of a multi-root workspace, or nested inside a parent that is the workspace root - so it writes
 * every path relative to the CONTRACT ROOT, the directory holding `.notethink/`. The host reports
 * where it found that directory as `root_relative`, and joining the two gives the one workspace
 * relative path a note can be matched against. A second interpretation is never tried: two readings
 * can match two different files, and crediting an agent's work to a guessed story is the single
 * failure this card exists to prevent. A near-match is not a match, and an unmatched session is drawn
 * nowhere.
 *
 * `project` is a display label, never a locator. A contract root can sit several folders below the
 * workspace folder, so a path rebuilt from it names a file that does not exist.
 *
 * Two further distinctions carry the design, and both exist because silence must never read as "all
 * quiet". `producerStateOf` separates nothing writing at all from something that stopped writing and
 * from a contract directory whose manifest could not be read; `factStateFor` separates a vendor that
 * cannot report a thing from a vendor reporting that there is nothing to report.
 */

// the wire types the host posts on, and the namespace the unbound-agent virtual notes are minted in
export const ACTIVITY_MESSAGE_TYPE = 'activity';
export const ACTIVITY_UNAVAILABLE_MESSAGE_TYPE = 'activityUnavailable';
export const ACTIVITY_OPEN_DIFF_MESSAGE_TYPE = 'openActivityDiff';
export const ACTIVITY_OPEN_CHAT_MESSAGE_TYPE = 'openActivityChat';
export const AGENT_VIRTUAL_NAMESPACE = 'agent';

// the two bands of the working tree, named as the host's admission gate names them
export const ACTIVITY_BAND_UNCOMMITTED = 'uncommitted';
export const ACTIVITY_BAND_COMMITTED = 'committed';
export type ActivityBand = typeof ACTIVITY_BAND_UNCOMMITTED | typeof ACTIVITY_BAND_COMMITTED;

/*
 * How a producer is doing, which is the first question a board answers. `absent` is nothing writing
 * where this note lives, `unreadable` is a contract directory whose manifest the host could not read,
 * `stopped` is a manifest whose heartbeat has gone stale, and `live` is a producer writing now. Only
 * the last means the agents themselves are quiet when nothing else is shown.
 */
export const ACTIVITY_PRODUCER_STATES = ['absent', 'unreadable', 'stopped', 'live'] as const;
export type ActivityProducerLiveness = typeof ACTIVITY_PRODUCER_STATES[number];

/*
 * What a reader may honestly say about one fact on one session. `reported` is a value to draw,
 * `quiet` is a supported capability with nothing to report, and `unsupported` is a producer that
 * cannot answer either way. Collapsing the last two is the failure this whole contract exists to
 * prevent.
 */
export const ACTIVITY_FACT_STATES = ['reported', 'quiet', 'unsupported'] as const;
export type ActivityFactState = typeof ACTIVITY_FACT_STATES[number];

/**
 * ActivityRefusal is one contract file the host would not read, mirrored from the host's own type.
 * - file: the contract-relative name of the file at fault, never an absolute path
 * - code: the machine-readable reason, so a test and the card's copy key off it rather than off a message string
 * - session_id: present for the three per-session files, so a refusal is drawn on the row it concerns
 */
export interface ActivityRefusal {
    file: string;
    code: ActivityRejectCode;
    reason: string;
    session_id?: string;
}

/**
 * ActivityProducerState answers "is anything writing here at all" for one contract directory.
 * - root_relative: where the host found the `.notethink/` directory, relative to its workspace folder, and empty when that directory sits at the workspace folder itself. The one base a declared path is joined to
 * - live: false covers a stopped producer and an unreadable manifest alike, which `producer` then tells apart
 * - unreadable_session_ids: declared here and not readable, which is a different thing from a session sitting idle
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

/** ActivitySessionState is one declared, readable session with the files that belong to it, and the contract root it came from */
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
 * sessions its manifest declares, and its working tree. Empty arrays are a meaningful answer rather
 * than a missing one - they say no producer is writing anywhere the host can see - which is why the
 * store holds `undefined` until the host has spoken at all.
 */
export interface ActivitySnapshot {
    contract_version: string;
    producers: ActivityProducerState[];
    sessions: ActivitySessionState[];
    trees: ActivityTreeState[];
}

/** the snapshot a board holds once the host has said that nothing is writing anywhere it can see */
export const EMPTY_ACTIVITY_SNAPSHOT: ActivitySnapshot = {
    contract_version: ACTIVITY_CONTRACT_VERSION,
    producers: [],
    sessions: [],
    trees: [],
};

/**
 * ActivityUnavailable is the host's answer when a row's request could not be carried out: a diff
 * whose sides it could not resolve, or a chat panel there is none of. The copy belongs to the
 * webview, so only the machine-readable reason crosses.
 */
export interface ActivityUnavailable {
    request: 'diff' | 'chat';
    reason: string;
    path?: string;
    session_id?: string;
}

/**
 * ActivityStoryKey is the pair a session's binding is joined to a note on, in the note's own spelling:
 * a workspace-relative posix document path and the story's authored id. Neither half identifies a
 * story alone, because an id is unique within a file and not across a workspace.
 */
export interface ActivityStoryKey {
    doc_path: string;
    id: string;
}

/** a workspace-relative posix path in one spelling, so a leading dot-slash or slash cannot break a join */
export function normaliseActivityPath(path: string | undefined): string {
    if (!path) { return ''; }
    return path.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * The one workspace-relative path a contract-root-relative path resolves to: where the host found the
 * contract directory, joined to what the producer declared. An empty `root_relative` means the
 * contract root IS the workspace folder, and the declared path stands alone.
 */
export function resolveActivityPath(root_relative: string, declared_path: string | undefined): string {
    const declared = normaliseActivityPath(declared_path);
    const base = normaliseActivityPath(root_relative);
    if (!declared) { return ''; }
    return base ? `${base}/${declared}` : declared;
}

/**
 * The story key a note joins activity on, or undefined when the note cannot be joined at all.
 *
 * The id half is the authored `[](?id=slug)` linetag and never the implicit headline-derived one: a
 * binding is a cross-session reference by definition, and only the authored linetag survives a
 * rename. A story with no authored id is therefore unjoinable, which the card says rather than
 * guessing. The path half comes from the note's folder-mode origin, falling back to the view's own
 * document path in single-file mode where no origin is stamped.
 */
export function storyKeyForNote(note: NoteProps | undefined, fallback_doc_path?: string): ActivityStoryKey | undefined {
    const id = note?.linetags?.id?.value;
    if (!id) { return undefined; }
    const doc_path = normaliseActivityPath(note?.origin?.relative_path ?? fallback_doc_path);
    if (!doc_path) { return undefined; }
    return { doc_path, id };
}

/** turn a posted message into a snapshot, or undefined when it is not an activity message at all */
export function parseActivityMessage(message: unknown): ActivitySnapshot | undefined {
    if (message === null || typeof message !== 'object') { return undefined; }
    const envelope = message as { type?: unknown; activity?: unknown };
    if (envelope.type !== ACTIVITY_MESSAGE_TYPE) { return undefined; }
    if (envelope.activity === null || typeof envelope.activity !== 'object') {
        debug('discarding an activity message with no activity payload');
        return undefined;
    }
    const payload = envelope.activity as Partial<ActivitySnapshot>;
    return {
        contract_version: payload.contract_version ?? ACTIVITY_CONTRACT_VERSION,
        producers: Array.isArray(payload.producers) ? payload.producers : [],
        sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
        trees: Array.isArray(payload.trees) ? payload.trees : [],
    };
}

/** turn a posted message into the host's answer that a row's request could not be carried out */
export function parseActivityUnavailableMessage(message: unknown): ActivityUnavailable | undefined {
    if (message === null || typeof message !== 'object') { return undefined; }
    const envelope = message as { type?: unknown; request?: unknown; reason?: unknown; path?: unknown; session_id?: unknown };
    if (envelope.type !== ACTIVITY_UNAVAILABLE_MESSAGE_TYPE) { return undefined; }
    if (envelope.request !== 'diff' && envelope.request !== 'chat') { return undefined; }
    if (typeof envelope.reason !== 'string') { return undefined; }
    return {
        request: envelope.request,
        reason: envelope.reason,
        path: typeof envelope.path === 'string' ? envelope.path : undefined,
        session_id: typeof envelope.session_id === 'string' ? envelope.session_id : undefined,
    };
}

/**
 * The contract root a note's document sits inside: the producer entry whose `root_relative` the
 * note's own path begins with, and the deepest such entry where repositories nest. An empty
 * `root_relative` matches every path, which is what a workspace folder that is itself the repository
 * looks like.
 */
export function producerForDocPath(snapshot: ActivitySnapshot | undefined, doc_path: string | undefined): ActivityProducerState | undefined {
    const path = normaliseActivityPath(doc_path);
    if (!path || !snapshot) { return undefined; }
    let best: ActivityProducerState | undefined;
    for (const producer of snapshot.producers) {
        const base = normaliseActivityPath(producer.root_relative);
        if (base && !path.startsWith(`${base}/`)) { continue; }
        if (!best || base.length > normaliseActivityPath(best.root_relative).length) { best = producer; }
    }
    return best;
}

/** the producer entry for one contract root, by the absolute path the host reported it at */
export function producerForRoot(snapshot: ActivitySnapshot | undefined, root_path: string | undefined): ActivityProducerState | undefined {
    if (!snapshot || !root_path) { return undefined; }
    return snapshot.producers.find(producer => producer.root_path === root_path);
}

/** the working tree one contract root published, absent when its producer cannot run git */
export function treeForRoot(snapshot: ActivitySnapshot | undefined, root_path: string | undefined): ActivityTree | undefined {
    if (!snapshot || !root_path) { return undefined; }
    return snapshot.trees.find(entry => entry.root_path === root_path)?.tree;
}

/**
 * How the producer for one contract root is doing, which is the first thing an otherwise empty card
 * has to say. `undefined` is nothing writing where this note lives; a producer that is not live is a
 * stopped one when the manifest was read and an unreadable directory when it was not.
 */
export function producerStateOf(producer: ActivityProducerState | undefined): ActivityProducerLiveness {
    if (!producer) { return 'absent'; }
    if (producer.live) { return 'live'; }
    return producer.producer ? 'stopped' : 'unreadable';
}

/** true when a capability map declares this name supported; an absent key and any other value alike mean it cannot be reported */
export function hasActivityCapability(capabilities: ActivityCapabilities | undefined, name: string): boolean {
    return capabilities?.[name] === ACTIVITY_CAPABILITY_SUPPORTED;
}

/**
 * What may honestly be said about one fact on one session: the value when there is one, "nothing to
 * report" when the producer could have reported it and did not, and "not reported" when it cannot.
 */
export function factStateFor(session: ActivitySession | undefined, capability: string, has_value: boolean): ActivityFactState {
    if (!hasActivityCapability(session?.capabilities, capability)) { return 'unsupported'; }
    return has_value ? 'reported' : 'quiet';
}

/** a session's state, coerced to `unknown` for anything outside the contract's set, because a reader never guesses `idle` */
export function sessionStateOf(session: ActivitySession): ActivityState {
    return (ACTIVITY_STATES as ReadonlyArray<string>).includes(session.state) ? session.state : ACTIVITY_STATE_UNKNOWN;
}

/** the one workspace-relative document path a session declared its story at, empty when it declared none */
export function sessionStoryPath(state: ActivitySessionState): string {
    if (state.session.story_binding !== 'bound') { return ''; }
    return resolveActivityPath(state.root_relative, state.session.story?.doc_path);
}

/**
 * The sessions a story's card draws: those whose agent declared this exact story, in the order the
 * host listed them. One resolution, and a session that does not match it is drawn nowhere.
 */
export function sessionsForStory(snapshot: ActivitySnapshot | undefined, key: ActivityStoryKey | undefined): ActivitySessionState[] {
    if (!snapshot || !key) { return []; }
    return snapshot.sessions.filter(state => state.session.story?.id === key.id && sessionStoryPath(state) === key.doc_path);
}

/** the sessions whose agent declared it is on no story, which are the ones a virtual note is minted for */
export function unboundSessions(snapshot: ActivitySnapshot | undefined): ActivitySessionState[] {
    return (snapshot?.sessions ?? []).filter(state => state.session.story_binding !== 'bound');
}

/** the changed files in one band attributed to any of these sessions, keeping the producer's order */
export function attributedFiles(tree: ActivityTree | undefined, band: ActivityBand, session_ids: ReadonlyArray<string>): ActivityChangedFile[] {
    const wanted = new Set(session_ids);
    return (tree?.[band] ?? []).filter(file => file.session_id !== undefined && wanted.has(file.session_id));
}

/** the changed files in one band that no session's write calls account for, which are never credited to a guessed agent */
export function unattributedFiles(tree: ActivityTree | undefined, band: ActivityBand): ActivityChangedFile[] {
    return (tree?.[band] ?? []).filter(file => file.session_id === undefined);
}

/**
 * The virtual-note key one unbound session is minted under, unique across contract roots because two
 * repositories can declare the same session id. A session id cannot contain a slash, so the last one
 * splits the key back into its halves.
 */
export function unboundSessionKey(state: ActivitySessionState): string {
    return `${normaliseActivityPath(state.root_relative)}/${state.session.session_id}`;
}

/** the session one virtual-note key stands for, or undefined when the snapshot no longer carries it */
export function sessionForUnboundKey(snapshot: ActivitySnapshot | undefined, key: string | undefined): ActivitySessionState | undefined {
    if (!snapshot || key === undefined) { return undefined; }
    return snapshot.sessions.find(state => unboundSessionKey(state) === key);
}

/** the headline a virtual note for an unbound session carries: the vendor and the project it is working in, never a story it did not declare */
export function unboundSessionHeadline(session: ActivitySession): string {
    return session.project ? `${session.vendor} in ${session.project}` : session.vendor;
}

/**
 * The virtual notes this snapshot calls for: one per session whose agent declared it is on no story,
 * so an unbound agent is drawn away from every story's card rather than guessed onto one.
 */
export function virtualNotesForActivity(snapshot: ActivitySnapshot | undefined): NoteProps[] {
    return unboundSessions(snapshot).map(state => makeVirtualNote({
        namespace: AGENT_VIRTUAL_NAMESPACE,
        key: unboundSessionKey(state),
        headline: unboundSessionHeadline(state.session),
        project: state.session.project,
        project_hue: state.session.project ? hueForProjectName(state.session.project) : undefined,
        project_label: state.session.project ? state.session.project.slice(0, 2).toUpperCase() : undefined,
    }));
}

/**
 * The two-character monogram a vendor is drawn as. Vendor is an open string, so this derives from the
 * slug rather than from a table: the initials of a hyphenated slug's first two segments, else the
 * slug's first two characters. A vendor nobody has heard of gets a monogram rather than being dropped.
 */
export function vendorMonogram(vendor: string): string {
    const segments = vendor.split(/[-_ ]+/).filter(segment => segment.length > 0);
    if (segments.length === 0) { return '??'; }
    if (segments.length === 1) { return segments[0].slice(0, 2).toUpperCase(); }
    return (segments[0][0] + segments[1][0]).toUpperCase();
}

/** a contract argument shortened for display; a producer that overruns the bound loses its whole log, so a reader truncates rather than refusing */
export function truncateActivityArg(arg: string | undefined, limit: number): string {
    if (!arg) { return ''; }
    return arg.length <= limit ? arg : `${arg.slice(0, limit - 1)}…`;
}

/*
 * Whether a file row's diff could be opened, and when it could not, why. The distinction the contract
 * insists on is the last two: a side that does not exist at all (which is what `added` means) reads
 * differently from a side that exists and was not stored, and a reader says the diff is unavailable
 * rather than showing an empty pane. This is the card's own reading of what the producer stored; the
 * host answers for the attempt itself, on an `activityUnavailable` message.
 */
export const ACTIVITY_DIFF_AVAILABILITY = ['both_sides', 'added_no_base', 'omitted_binary', 'omitted_size', 'no_stored_side'] as const;
export type ActivityDiffAvailability = typeof ACTIVITY_DIFF_AVAILABILITY[number];

/**
 * What a reader could show for one changed file. An uncommitted entry's right-hand side is the file in
 * the workspace, so it needs only a stored base; a committed entry may carry further edits on top of
 * the commit, so it needs both sides stored.
 */
export function diffAvailabilityOf(file: ActivityChangedFile, band: ActivityBand): ActivityDiffAvailability {
    if (file.omitted === 'binary') { return 'omitted_binary'; }
    if (file.omitted === 'size') { return 'omitted_size'; }
    const needs_head = band === ACTIVITY_BAND_COMMITTED;
    if (file.base_blob && (!needs_head || file.head_blob)) { return 'both_sides'; }
    if (file.change === 'added' && (!needs_head || file.head_blob)) { return 'added_no_base'; }
    return 'no_stored_side';
}

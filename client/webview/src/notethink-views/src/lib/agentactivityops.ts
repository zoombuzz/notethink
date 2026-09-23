import Debug from "debug";
import * as l10n from "@vscode/l10n";
import {
    ACTIVITY_CAPABILITY_SUPPORTED,
    ACTIVITY_STATES,
    ACTIVITY_STATE_UNKNOWN,
    type ActivityCapabilities,
    type ActivityChangedFile,
    type ActivityCommit,
    type ActivityRejectCode,
    type ActivitySession,
    type ActivityState,
    type ActivityStoryUsage,
    type ActivityTree,
    type ActivityUsage,
} from "../types/AgentActivity";
import { hueForProjectName } from "./originops";
import { storyStableIdSlug } from "./noteops";
import { makeVirtualNote } from "./virtualnoteops";
import type { NoteProps } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:agentactivityops");

/**
 * The webview's half of the agent activity snapshot, mirrored from
 * `client/extension/src/lib/agentanalyserops.ts` because the two bundles share no module graph.
 *
 * The analyser reads each vendor's own session files itself, inside the same host that renders the
 * card, so it already knows the workspace: every path on a session or a story reference arrives
 * workspace-relative, with no contract-root indirection left for the webview to resolve. What
 * remains per-repository is the working tree (`trees`), because a workspace can hold more than one
 * repository and a file band is a fact about one of them.
 *
 * Activity travels on its own message rather than on NoteProps, which is the mdast contract and
 * stays free of agent, git and process fields. The join to a card is made here, at render.
 *
 * Two distinctions carry the design, and both exist because silence must never read as "all quiet".
 * `analyser.state` separates the analyser not running at all from it running and finding nothing;
 * `factStateFor` separates a vendor that cannot report a thing from a vendor reporting that there is
 * nothing to report.
 */

// the wire types the host posts on, and the namespace the unbound-agent virtual notes are minted in
export const ACTIVITY_MESSAGE_TYPE = 'activity';
export const ACTIVITY_UNAVAILABLE_MESSAGE_TYPE = 'activityUnavailable';
export const ACTIVITY_OPEN_DIFF_MESSAGE_TYPE = 'openActivityDiff';
export const ACTIVITY_OPEN_CHAT_MESSAGE_TYPE = 'openActivityChat';
export const ACTIVITY_DEMAND_MESSAGE_TYPE = 'activityDemand';
export const ACTIVITY_WITHDRAW_MESSAGE_TYPE = 'activityWithdraw';
export const AGENT_VIRTUAL_NAMESPACE = 'agent';
// the pending-work key the toolbar spinner holds while the analyser's first scan is in flight
export const AGENT_SCAN_PENDING_KEY = 'agentScan';

// the one band a diff can be opened on; the committed band lists commits, not files, and carries no diff affordance
export const ACTIVITY_BAND_UNCOMMITTED = 'uncommitted';
export type ActivityBand = typeof ACTIVITY_BAND_UNCOMMITTED;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 60 * 60 * 1000;
// the analyser's usage window, the longest span a counter can state; it mirrors the extension host's AGENT_WINDOW_DAYS
export const ACTIVITY_USAGE_WINDOW_DAYS = 30;
// an elapsed clock reads in hours and minutes up to two days, then in whole days, because "448h 56m" is a date a reader has to work out
const CLOCK_HOURS_BEFORE_DAYS = 48;
// the one model-id prefix that repeats what the vendor monogram beside it already says; "grok-" is kept because a bare version number would not read as a model
const REDUNDANT_MODEL_PREFIX = 'claude-';

/*
 * How the analyser is doing, which is the first question a board answers. `unavailable` is this host
 * having no local file access to read from at all (a web host, or a user-data layout it does not
 * recognise); `scanning` is its first read still in flight; `live` is at least one scan having
 * completed, whether or not it found anything; `failed` is its worker having crashed and its one
 * restart having also failed.
 */
export const ACTIVITY_ANALYSER_STATES = ['unavailable', 'scanning', 'live', 'failed'] as const;
export type ActivityAnalyserLiveness = typeof ACTIVITY_ANALYSER_STATES[number];

/*
 * What a reader may honestly say about one fact on one session. `reported` is a value to draw,
 * `quiet` is a supported capability with nothing to report, and `unsupported` is a vendor that
 * cannot answer either way. Collapsing the last two is the failure this whole card exists to
 * prevent.
 */
export const ACTIVITY_FACT_STATES = ['reported', 'quiet', 'unsupported'] as const;
export type ActivityFactState = typeof ACTIVITY_FACT_STATES[number];

/**
 * ActivityRefusal is one vendor session file the analyser could not read, mirrored from the host's
 * own type.
 * - file: names the file at fault for a reader (vendor and a short form), never an absolute path
 * - code: the machine-readable reason, so a test and the card's copy key off it rather than a message string
 * - session_id: present when the refusal concerns one session, so it is drawn on that session's own row
 */
export interface ActivityRefusal {
    file: string;
    code: ActivityRejectCode;
    reason: string;
    session_id?: string;
}

/**
 * ActivityAnalyserState answers "is the analyser working at all" for the whole workspace, which is
 * the first thing an otherwise empty board has to say.
 */
export interface ActivityAnalyserState {
    state: ActivityAnalyserLiveness;
    reason?: string;
    refusals: ActivityRefusal[];
}

/**
 * One session, and the repository its cwd resolves inside, absent when it resolves inside none open
 * here.
 */
export interface ActivitySessionState {
    root_path?: string;
    session: ActivitySession;
}

/** one repository's working tree, and where the analyser found it relative to a workspace folder */
export interface ActivityTreeState {
    root_path: string;
    root_relative: string;
    tree: ActivityTree;
}

/**
 * ActivitySnapshot is the whole activity payload: the analyser's own state, every session it could
 * read across the three vendors, and every open repository's working tree. An empty `sessions` array
 * while `analyser.state` is `live` is a meaningful answer rather than a missing one - it says no
 * agent is working anywhere this analyser can see.
 */
export interface ActivitySnapshot {
    analyser: ActivityAnalyserState;
    sessions: ActivitySessionState[];
    trees: ActivityTreeState[];
}

/** the snapshot a board holds before the host has said anything at all */
export const EMPTY_ACTIVITY_SNAPSHOT: ActivitySnapshot = {
    analyser: { state: 'scanning', refusals: [] },
    sessions: [],
    trees: [],
};

/**
 * ActivityUnavailable is the host's answer when a row's request could not be carried out: a diff it
 * could not resolve, or a chat panel there is none of. The copy belongs to the webview, so only the
 * machine-readable reason crosses.
 */
export interface ActivityUnavailable {
    request: 'diff' | 'chat';
    reason: string;
    path?: string;
    session_id?: string;
}

/**
 * ActivityStoryKey is the pair a session's binding is joined to a note on, in the note's own
 * spelling: a workspace-relative posix document path and the story's stable id (its authored
 * `[](?id=slug)` linetag where one exists, else the slug derived from its stripped headline text).
 * Neither half identifies a story alone, because an id is unique within a file and not across a
 * workspace.
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
 * The story key a note joins activity on, or undefined when the note carries no document path at all
 * to join on (an unmounted note, or a single-file view with no `fallback_doc_path` stamped).
 *
 * The id half is the note's stable id (`storyStableIdSlug`, `noteops.ts`): its authored
 * `[](?id=slug)` linetag where one exists, else the slug derived from its stripped headline text, the
 * same derivation the extension host's `agentstorybindingops.ts` mirrors byte-for-byte so a session
 * bound there by a heading with no authored id still lands on the card this key resolves to. The path
 * half comes from the note's folder-mode origin, falling back to the view's own document path in
 * single-file mode where no origin is stamped.
 */
export function storyKeyForNote(note: NoteProps | undefined, fallback_doc_path?: string): ActivityStoryKey | undefined {
    if (!note) { return undefined; }
    const doc_path = normaliseActivityPath(note.origin?.relative_path ?? fallback_doc_path);
    if (!doc_path) { return undefined; }
    return { doc_path, id: storyStableIdSlug(note) };
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
        analyser: payload.analyser ?? EMPTY_ACTIVITY_SNAPSHOT.analyser,
        sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
        trees: Array.isArray(payload.trees) ? payload.trees : [],
    };
}

/**
 * Whether the panel is waiting on the analyser's first scan: it has asked for activity, and the host
 * has either not answered yet or answered that its first read is still in flight. A panel that has not
 * asked is never waiting, whatever the last snapshot it held said, because the host stops posting to a
 * panel once it withdraws and a `scanning` snapshot left behind would otherwise never be superseded.
 */
export function isAgentScanPending(demanded: boolean, snapshot: ActivitySnapshot | undefined): boolean {
    if (!demanded) { return false; }
    return snapshot === undefined || snapshot.analyser.state === 'scanning';
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
 * The repository a workspace-relative document path sits inside: the tree entry whose `root_relative`
 * the path begins with, and the deepest such entry where repositories nest. An empty `root_relative`
 * matches every path, which is what a repository that IS a workspace folder looks like.
 */
export function treeForDocPath(snapshot: ActivitySnapshot | undefined, doc_path: string | undefined): ActivityTreeState | undefined {
    const path = normaliseActivityPath(doc_path);
    if (!path || !snapshot) { return undefined; }
    let best: ActivityTreeState | undefined;
    for (const entry of snapshot.trees) {
        const base = normaliseActivityPath(entry.root_relative);
        if (base && !path.startsWith(`${base}/`)) { continue; }
        if (!best || base.length > normaliseActivityPath(best.root_relative).length) { best = entry; }
    }
    return best;
}

/** the tree entry for one repository, by the absolute path the host reported it at */
export function treeForRoot(snapshot: ActivitySnapshot | undefined, root_path: string | undefined): ActivityTreeState | undefined {
    if (!snapshot || !root_path) { return undefined; }
    return snapshot.trees.find(entry => entry.root_path === root_path);
}

/** true when a capability map declares this name supported; an absent key and any other value alike mean it cannot be reported */
export function hasActivityCapability(capabilities: ActivityCapabilities | undefined, name: string): boolean {
    return capabilities?.[name] === ACTIVITY_CAPABILITY_SUPPORTED;
}

/**
 * What may honestly be said about one fact on one session: the value when there is one, "nothing to
 * report" when the vendor could have reported it and did not, and "not reported" when it cannot.
 */
export function factStateFor(session: ActivitySession | undefined, capability: string, has_value: boolean): ActivityFactState {
    if (!hasActivityCapability(session?.capabilities, capability)) { return 'unsupported'; }
    return has_value ? 'reported' : 'quiet';
}

/** a session's state, coerced to `unknown` for anything outside the known set, because a reader never guesses `idle` */
export function sessionStateOf(session: ActivitySession): ActivityState {
    return (ACTIVITY_STATES as ReadonlyArray<string>).includes(session.state) ? session.state : ACTIVITY_STATE_UNKNOWN;
}

/** the sessions a story's card draws: those whose agent bound it to this exact story (among however many it bound to), in the order the host listed them */
export function sessionsForStory(snapshot: ActivitySnapshot | undefined, key: ActivityStoryKey | undefined): ActivitySessionState[] {
    if (!snapshot || !key) { return []; }
    return snapshot.sessions.filter(state => (state.session.stories ?? []).some(story => story.id === key.id && story.doc_path === key.doc_path));
}

/** one session's own split usage entry for this story; undefined when it carries none */
function storyUsageEntryFor(state: ActivitySessionState, key: ActivityStoryKey): ActivityStoryUsage | undefined {
    return state.session.story_usage?.find(entry => entry.story.id === key.id && entry.story.doc_path === key.doc_path);
}

/** one session's own split usage for this story; undefined when it carries no split entry for this story, which the caller then falls back to the session's whole usage for */
function storyUsageFor(state: ActivitySessionState, key: ActivityStoryKey): ActivityUsage | undefined {
    return storyUsageEntryFor(state, key)?.usage;
}

/**
 * The usage one session contributes to one card: its own split share for this story where it carries
 * one, else its whole usage. Without a story key (a virtual note's own unbound session) the whole
 * usage is the share, since there is no story to split against.
 */
export function sessionUsageForStory(state: ActivitySessionState, story_key: ActivityStoryKey | undefined): ActivityUsage {
    return (story_key ? storyUsageFor(state, story_key) : undefined) ?? state.session.usage;
}

/** the sessions whose agent's own write calls bound it to no story, which are the ones a virtual note is minted for */
export function unboundSessions(snapshot: ActivitySnapshot | undefined): ActivitySessionState[] {
    return (snapshot?.sessions ?? []).filter(state => state.session.story_binding !== 'bound');
}

/** the uncommitted files in one repository's tree attributed to any of these sessions, keeping the analyser's own order */
export function attributedFiles(tree: ActivityTree | undefined, session_ids: ReadonlyArray<string>): ActivityChangedFile[] {
    const wanted = new Set(session_ids);
    return (tree?.uncommitted ?? []).filter(file => file.session_id !== undefined && wanted.has(file.session_id));
}

/** the uncommitted files no session's write calls account for, which are never credited to a guessed agent */
export function unattributedFiles(tree: ActivityTree | undefined): ActivityChangedFile[] {
    return (tree?.uncommitted ?? []).filter(file => file.session_id === undefined);
}

/** the commits in one repository's tree credited to any of these sessions */
export function attributedCommits(tree: ActivityTree | undefined, session_ids: ReadonlyArray<string>): ActivityCommit[] {
    const wanted = new Set(session_ids);
    return (tree?.committed ?? []).filter(commit => commit.session_id !== undefined && wanted.has(commit.session_id));
}

/** the commits no session's own `git commit` call accounts for, which appear on every card drawing this repository, exactly as an unattributed uncommitted file does */
export function unattributedCommits(tree: ActivityTree | undefined): ActivityCommit[] {
    return (tree?.committed ?? []).filter(commit => commit.session_id === undefined);
}

/**
 * The virtual-note key one unbound session is minted under, unique across repositories because two
 * of them can happen to run a session with the same id. A session id cannot contain a slash, so the
 * last one splits the key back into its halves.
 */
export function unboundSessionKey(state: ActivitySessionState): string {
    return `${normaliseActivityPath(state.root_path)}/${state.session.session_id}`;
}

/** the session one virtual-note key stands for, or undefined when the snapshot no longer carries it */
export function sessionForUnboundKey(snapshot: ActivitySnapshot | undefined, key: string | undefined): ActivitySessionState | undefined {
    if (!snapshot || key === undefined) { return undefined; }
    return snapshot.sessions.find(state => unboundSessionKey(state) === key);
}

/** the headline a virtual note for an unbound session carries: the vendor and the project it is working in, never a story it was not bound to */
export function unboundSessionHeadline(session: ActivitySession): string {
    return session.project ? `${session.vendor} in ${session.project}` : session.vendor;
}

/**
 * The virtual notes this snapshot calls for: one per session whose own write calls bound it to no
 * story, so an unbound agent is drawn away from every story's card rather than guessed onto one.
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

/** a model id as an agent row draws it beside the vendor monogram: `claude-opus-5-5` reads `opus-5-5`, and any other id is left whole */
export function shortModelId(model: string | undefined): string {
    if (!model) { return ''; }
    return model.startsWith(REDUNDANT_MODEL_PREFIX) && model.length > REDUNDANT_MODEL_PREFIX.length ? model.slice(REDUNDANT_MODEL_PREFIX.length) : model;
}

/**
 * A compact duration clock between two ISO timestamps: `7m`, `3h 05m`, and whole days (`18d`) past
 * two days. A numeric-unit convention like `formatActivityTokens`'s `k`/`M`, not prose, so it is not
 * run through `l10n.t`. Either timestamp unparseable draws no clock rather than `NaNm`, and an end
 * before its start reads `0m`.
 */
export function formatDurationClock(from: string, to: string): string {
    const from_ms = new Date(from).getTime();
    const to_ms = new Date(to).getTime();
    if (Number.isNaN(from_ms) || Number.isNaN(to_ms)) { return ''; }
    const minutes = Math.max(0, Math.floor((to_ms - from_ms) / 60000));
    if (minutes < MINUTES_PER_HOUR) { return `${minutes}m`; }
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    if (hours >= CLOCK_HOURS_BEFORE_DAYS) { return `${Math.floor(hours / HOURS_PER_DAY)}d`; }
    const rest = String(minutes % MINUTES_PER_HOUR).padStart(2, '0');
    return `${hours}h ${rest}m`;
}

/** an argument shortened for display; a session that overruns the bound loses the rest of its own line, so a reader truncates rather than refusing */
export function truncateActivityArg(arg: string | undefined, limit: number): string {
    if (!arg) { return ''; }
    return arg.length <= limit ? arg : `${arg.slice(0, limit - 1)}…`;
}

/** an integer token count as a compact display string; the counter states an order of magnitude, not an exact figure a reader would ever need to reconcile against a bill */
export function formatActivityTokens(tokens: number): string {
    if (tokens >= 1_000_000) { return `${(tokens / 1_000_000).toFixed(1)}M`; }
    if (tokens >= 1_000) { return `${(tokens / 1_000).toFixed(1)}k`; }
    return String(tokens);
}

/**
 * ActivityUsageWindow is the span a usage figure covers, as a count of whole days or, under a day,
 * whole hours, each rounded up so the span always contains the activity it counts.
 */
export interface ActivityUsageWindow {
    unit: 'd' | 'h';
    count: number;
}

/**
 * The span a counter covers: from the earliest activity it counts to now, capped at the analyser's
 * window, so a story two days old reads "2d" rather than claiming thirty days of history. An unknown
 * or unparseable start reads as the whole window, the one span the figure is sure to fit in.
 */
export function activityUsageWindow(since: string | undefined, now: number = Date.now()): ActivityUsageWindow {
    const whole: ActivityUsageWindow = { unit: 'd', count: ACTIVITY_USAGE_WINDOW_DAYS };
    const since_ms = since === undefined ? NaN : new Date(since).getTime();
    if (Number.isNaN(since_ms)) { return whole; }
    const hours = Math.max(1, Math.ceil((now - since_ms) / MS_PER_HOUR));
    if (hours < HOURS_PER_DAY) { return { unit: 'h', count: hours }; }
    return { unit: 'd', count: Math.min(ACTIVITY_USAGE_WINDOW_DAYS, Math.ceil(hours / HOURS_PER_DAY)) };
}

/**
 * The earliest activity a card's counter counts: on a story, the earliest priced call any of its
 * sessions credited to that story; on a virtual note, its one session's start. Undefined when no
 * session says, which `activityUsageWindow` reads as the whole window.
 */
export function earliestCountedActivity(sessions: ReadonlyArray<ActivitySessionState>, story_key?: ActivityStoryKey): string | undefined {
    const starts = sessions.map(state => {
        if (!story_key) { return state.session.started_at; }
        return storyUsageEntryFor(state, story_key)?.first_at;
    }).filter((at): at is string => at !== undefined && !Number.isNaN(new Date(at).getTime()));
    if (starts.length === 0) { return undefined; }
    return starts.reduce((first, at) => (new Date(at).getTime() < new Date(first).getTime() ? at : first));
}

/**
 * A session's or a story's usage as one display line: total tokens and, where priced, an estimated
 * cost, labelled as an estimate unless the vendor supplied its own authoritative figure. An unpriced
 * usage still shows its tokens, never a dollar figure borrowed from another model.
 *
 * `window` states the span the figure covers, on the story's own counter; an agent row omits it,
 * since it sits under that counter where the span is already stated once.
 */
export function formatActivityUsage(usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd?: number; is_estimate: boolean }, window?: ActivityUsageWindow): string {
    const total = usage.input_tokens + usage.output_tokens + usage.cache_read_tokens + usage.cache_write_tokens;
    const count = formatActivityTokens(total);
    const tokens = window === undefined
        ? l10n.t('{0} tokens', count)
        : window.unit === 'h' ? l10n.t('{0} tokens ({1}h)', count, window.count) : l10n.t('{0} tokens ({1}d)', count, window.count);
    if (usage.cost_usd === undefined) { return tokens; }
    const cost = usage.is_estimate ? l10n.t('~${0}', usage.cost_usd.toFixed(2)) : l10n.t('${0}', usage.cost_usd.toFixed(2));
    return `${tokens} ${cost}`;
}

/**
 * The combined usage of every session on a card, so a story's counter needs no separate figure
 * shipped from the host. With `story_key`, a session bound to more than one story contributes only
 * its own split share for that story (`state.session.story_usage`), never its whole-session total;
 * without one (a virtual note's own unbound session, or a caller not yet passing it), each session
 * contributes its whole `usage`.
 */
export function totalActivityUsage(sessions: ReadonlyArray<ActivitySessionState>, story_key?: ActivityStoryKey): { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd?: number; is_estimate: boolean } {
    let input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_write_tokens = 0;
    let cost_usd: number | undefined;
    let is_estimate = false;
    let all_priced = true;
    for (const state of sessions) {
        const usage = sessionUsageForStory(state, story_key);
        input_tokens += usage.input_tokens;
        output_tokens += usage.output_tokens;
        cache_read_tokens += usage.cache_read_tokens;
        cache_write_tokens += usage.cache_write_tokens;
        if (usage.cost_usd !== undefined) { cost_usd = (cost_usd ?? 0) + usage.cost_usd; } else { all_priced = false; }
        if (usage.is_estimate) { is_estimate = true; }
    }
    // a total is priced only when every contributing usage is, so one unpriced session never understates the dollar figure against the tokens shown beside it
    return { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd: all_priced ? cost_usd : undefined, is_estimate };
}

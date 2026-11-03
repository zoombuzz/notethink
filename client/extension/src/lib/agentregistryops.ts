import { emptyActivityUsage, ACTIVITY_VENDOR_CLAUDE_CODE, type ActivitySession, type ActivityState, type ActivityStoryProgress, type ActivityStoryRef } from '../types/AgentActivity';
import type { ActivitySessionState } from './agentanalyserops';
import type { HashMapOf } from '../types/general';
import { progressProjectName } from './progressfileops';

/**
 * Reading the thinkersync agent registry: the pure half. Every agent keeps one
 * `registry/<agent>/agent.json` under the thinkersync home, written by other tooling and read here
 * and never written, so a missing, empty, oversize or malformed file and any field a newer writer
 * adds are all ordinary: each function answers them with an omission, never an error. Every field is
 * optional, and a value this build does not know is carried rather than rejected.
 *
 * The entry's `state` is a hint and not a heartbeat, because `updated_at` moves only on a state
 * change or a restart. So an entry is bound to its story only while that story is in flight on the
 * board, and a `working` entry that nothing since its last update corroborates reads as stale.
 *
 * What reaches the webview is the agent's name, vendor, state and story, drawn on an ordinary
 * `ActivitySession`. Left out on purpose: the mailbox path, the terminal pane id, the binary version,
 * the machine name, the open convoys and the last recycle time, none of which a row displays, and
 * the agent kind.
 */

// the registry directory below the thinkersync home, one directory per agent
export const REGISTRY_DIR_SEGMENTS = ['registry'] as const;
export const REGISTRY_ENTRY_FILE = 'agent.json';

// an entry is a few short fields; anything larger is not one and is left unread
export const REGISTRY_FILE_MAX_BYTES = 64 * 1024;

// the most agent directories read in one scan, so a runaway registry cannot stall it
export const REGISTRY_MAX_AGENTS = 100;

// a `working` entry with no corroborating activity this long after its last update reads as stale
export const REGISTRY_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// the story statuses a `working` entry binds to its story under
export const REGISTRY_BINDING_STORY_STATUSES = ['doing', 'code-review', 'testing'] as const;

// registry vendor names that differ from the slug the vendor display table keys on
const REGISTRY_VENDOR_SLUGS: Readonly<Record<string, string>> = {
    claude: ACTIVITY_VENDOR_CLAUDE_CODE,
};

const REGISTRY_UNKNOWN_VENDOR = 'unknown';

// the longest name and story id carried, so a runaway writer cannot bloat every activity post
const REGISTRY_TEXT_MAX_CHARS = 120;

const REGISTRY_SESSION_ID_PREFIX = 'registry:';

/**
 * RegistryEntry is the part of one `agent.json` NoteThink keeps.
 * - agent: the agent's name, such as `coord-demo`; the directory name when the file carries none
 * - vendor: the vendor slug the display table keys on, the registry's own spelling mapped where it differs
 * - repo: absolute path of the repository the agent works in
 * - state: the registry's own state word, carried as written
 * - story: the story id the agent is working on, empty when none
 * - session_ids: the agent's current session id first, then its previous ones, so a vendor session joins by any of them
 * - updated_at: ISO 8601 UTC of the last state change or restart
 */
export interface RegistryEntry {
    agent: string;
    vendor: string;
    repo: string;
    state: string;
    story: string;
    session_ids: string[];
    updated_at?: string;
}

/**
 * A registry entry placed in the open workspace.
 * - root_path: the repository root the agent's session is filed under, the git root holding `repo` where one is open, else `repo`
 * - repo_relative: workspace-relative path of `repo`, empty when it is a workspace folder; boards and progress entries are matched against it
 */
export interface ResolvedRegistryAgent extends RegistryEntry {
    root_path: string;
    repo_relative: string;
}

/**
 * What the overlay needs from the analyser: the clock, the coordinators' progress entries, and a
 * lookup of a story on the boards under a repository.
 */
export interface RegistryOverlayContext {
    now_ms: number;
    progress: ReadonlyArray<ActivityStoryProgress>;
    findStory: (repo_relative: string, story_id: string) => { story: ActivityStoryRef; status?: string } | undefined;
}

/** the path segments of one agent's entry below the thinkersync home */
export function registryEntrySegments(agent_dir: string): string[] {
    return [...REGISTRY_DIR_SEGMENTS, agent_dir, REGISTRY_ENTRY_FILE];
}

/** a registry vendor name as the display table's slug: `claude` is `claude-code`, any other vendor keeps its own lower-cased name */
export function registryVendorSlug(vendor: string | undefined): string {
    const name = vendor?.trim().toLowerCase();
    if (!name) { return REGISTRY_UNKNOWN_VENDOR; }
    return Object.hasOwn(REGISTRY_VENDOR_SLUGS, name) ? REGISTRY_VENDOR_SLUGS[name] : name;
}

/** the activity state a registry state word stands for: `stopped` ended, `working` and `waiting` as they read, `starting` and `idle` idle, anything else unknown */
export function registryActivityState(state: string): ActivityState {
    switch (state) {
        case 'working': return 'working';
        case 'waiting': return 'waiting';
        case 'idle':
        case 'starting': return 'idle';
        case 'stopped': return 'ended';
        default: return 'unknown';
    }
}

function textField(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, REGISTRY_TEXT_MAX_CHARS) : '';
}

/**
 * The entry one `agent.json` holds, undefined when the text is not a JSON object or names no
 * repository (an entry that cannot be placed in a workspace is of no use). A field of the wrong type
 * is read as absent rather than failing the entry.
 */
export function parseRegistryEntry(text: string, fallback_agent: string): RegistryEntry | undefined {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return undefined; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { return undefined; }
    const raw = parsed as Record<string, unknown>;
    const repo = typeof raw.repo === 'string' ? raw.repo.trim().replace(/\/+$/, '') : '';
    if (!repo.startsWith('/')) { return undefined; }
    const previous = Array.isArray(raw.previous_session_ids) ? raw.previous_session_ids.map(textField).filter(id => id.length > 0) : [];
    const current = textField(raw.session_id);
    const session_ids = [...new Set([...(current ? [current] : []), ...previous])];
    const updated_at = typeof raw.updated_at === 'string' && !Number.isNaN(Date.parse(raw.updated_at)) ? raw.updated_at : undefined;
    return {
        agent: textField(raw.agent) || textField(fallback_agent),
        vendor: registryVendorSlug(typeof raw.vendor === 'string' ? raw.vendor : undefined),
        repo,
        state: textField(raw.state),
        story: textField(raw.story),
        session_ids,
        updated_at,
    };
}

/** the latest of the given ISO times in epoch ms, ignoring any that do not parse; undefined when none does */
function latestMs(times: ReadonlyArray<string | undefined>): number | undefined {
    let latest: number | undefined;
    for (const time of times) {
        const ms = time === undefined ? Number.NaN : Date.parse(time);
        if (!Number.isNaN(ms) && (latest === undefined || ms > latest)) { latest = ms; }
    }
    return latest;
}

/** whether a progress entry belongs to the repository at this workspace-relative path: an empty entry base holds every path, otherwise the path is the base or sits inside it */
function progressInRepository(entry: ActivityStoryProgress, repo_relative: string): boolean {
    return entry.root_relative === '' || repo_relative === entry.root_relative || repo_relative.startsWith(`${entry.root_relative}/`);
}

/**
 * Whether a `working` entry has gone stale: its last update, the story's latest progress entry and the
 * joined session's last transcript write are all older than `REGISTRY_STALE_AFTER_MS`. Only a
 * `working` entry can be stale, and one with no parseable time at all is stale, since nothing
 * corroborates it.
 */
export function isRegistryWorkStale(agent: ResolvedRegistryAgent, joined: ActivitySession | undefined, ctx: RegistryOverlayContext): boolean {
    if (agent.state !== 'working') { return false; }
    const progress_times = agent.story
        ? ctx.progress.filter(entry => entry.story_id === agent.story && progressInRepository(entry, agent.repo_relative)).map(entry => entry.at)
        : [];
    const last_signal_ms = latestMs([agent.updated_at, joined?.updated_at, ...progress_times]);
    return last_signal_ms === undefined || ctx.now_ms - last_signal_ms > REGISTRY_STALE_AFTER_MS;
}

/** the key a registry-only agent is filed under: its name, and its repository's directory name so two repositories' agents of one name stay apart */
export function registrySessionId(agent: ResolvedRegistryAgent): string {
    const project = progressProjectName(agent.root_path) ?? '';
    const safe = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-');
    return `${REGISTRY_SESSION_ID_PREFIX}${safe(agent.agent)}:${safe(project)}`;
}

/** the vendor session an entry joins: the first session whose id is one of the entry's, current id before previous ones */
function joinedSessionKey(sessions: HashMapOf<ActivitySessionState>, agent: ResolvedRegistryAgent): string | undefined {
    const by_session_id = new Map<string, string>();
    for (const [key, state] of Object.entries(sessions)) { by_session_id.set(state.session.session_id, key); }
    for (const id of agent.session_ids) {
        const key = by_session_id.get(id);
        if (key !== undefined) { return key; }
    }
    return undefined;
}

/** a session bound to one story, its whole usage credited to it since it is the only one */
function boundTo(session: ActivitySession, story: ActivityStoryRef): ActivitySession {
    return { ...session, story_binding: 'bound', stories: [story], story_usage: [{ story, usage: session.usage }] };
}

/**
 * The vendor sessions with the registry laid over them. An entry joins a vendor session by its
 * session id or any previous one: the session keeps its vendor-derived state and takes the agent's
 * name, and gains the entry's story binding when it has none. An entry no session joins becomes a
 * registry-only row, with its state read from the registry's word (a stale `working` reads idle and
 * is marked stale) and liveness from that state, so a `stopped` agent is not live.
 *
 * A story binding needs a `working` entry that is not stale, a story found on the boards under the
 * entry's repository at `doing`, `code-review` or `testing`, and, for a joined session, one that has
 * not ended. Binding is what places a coordinator on its story's card before its first write.
 */
export function overlayRegistry(sessions: HashMapOf<ActivitySessionState>, agents: ReadonlyArray<ResolvedRegistryAgent>, ctx: RegistryOverlayContext): HashMapOf<ActivitySessionState> {
    if (agents.length === 0) { return sessions; }
    const overlaid: HashMapOf<ActivitySessionState> = { ...sessions };
    for (const agent of [...agents].sort((a, b) => a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0)) {
        const joined_key = joinedSessionKey(overlaid, agent);
        const joined = joined_key === undefined ? undefined : overlaid[joined_key];
        const stale = isRegistryWorkStale(agent, joined?.session, ctx);
        const found = agent.story ? ctx.findStory(agent.repo_relative, agent.story) : undefined;
        const in_flight = found !== undefined && (REGISTRY_BINDING_STORY_STATUSES as ReadonlyArray<string>).includes(found.status ?? '');
        const binds = agent.state === 'working' && !stale && in_flight;
        if (joined_key !== undefined && joined !== undefined) {
            const named: ActivitySession = { ...joined.session, registry_name: agent.agent };
            const bindable = binds && joined.session.story_binding !== 'bound' && joined.session.state !== 'ended';
            overlaid[joined_key] = { ...joined, session: bindable && found ? boundTo(named, found.story) : named };
            continue;
        }
        const key = registrySessionId(agent);
        const updated_at = agent.updated_at ?? new Date(ctx.now_ms).toISOString();
        const base: ActivitySession = {
            session_id: key,
            vendor: agent.vendor,
            project: progressProjectName(agent.root_path) ?? agent.root_path,
            registry_name: agent.agent,
            registry_only: true,
            registry_stale: stale || undefined,
            registry_story: agent.story || undefined,
            story_binding: 'none',
            started_at: updated_at,
            updated_at,
            state: stale ? 'idle' : registryActivityState(agent.state),
            capabilities: {},
            usage: emptyActivityUsage(),
        };
        overlaid[key] = { root_path: agent.root_path, session: binds && found ? boundTo(base, found.story) : base };
    }
    return overlaid;
}

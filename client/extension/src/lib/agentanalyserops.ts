import type {
    ActivityChangedFile,
    ActivityRejectCode,
    ActivitySession,
    ActivityTree,
} from '../types/AgentActivity';
import type { HashMapOf } from '../types/general';

/**
 * The analyser's own aggregation: pure folding of what the vendor readers and the git reader found
 * into the one payload the webview renders. There is no contract and no per-repository producer: the
 * analyser reads vendor session files itself, inside the same host that renders the card.
 *
 * These functions are pure, so the service's I/O, its worker and its logging stay testable
 * separately.
 */

export const AGENT_ANALYSER_STATES = ['unavailable', 'scanning', 'live', 'failed'] as const;
export type AgentAnalyserState = typeof AGENT_ANALYSER_STATES[number];

/**
 * ActivityRefusal is one vendor session file the analyser could not read, carried to the webview so
 * an empty board over a failed read never looks like an idle one.
 * - file: the file at fault, named for a reader rather than as an absolute path (the vendor and a
 *   short relative form, such as "claude-code transcript for 80d65e90")
 * - code: the machine-readable reason, so a test and a card's copy both key off it rather than a
 *   message string
 * - session_id: the session the file belongs to, so a refusal can be drawn on the row it concerns
 *   without the name being parsed again downstream
 */
export interface ActivityRefusal {
    file: string;
    code: ActivityRejectCode;
    reason: string;
    session_id?: string;
}

/**
 * One repository the analyser found a tree for, keyed by its absolute root.
 * - root_relative: workspace-relative, empty when the repository IS a workspace folder; the one
 *   base a session's or a note's own workspace-relative path is matched against
 */
export interface ActivityTreeState {
    root_path: string;
    root_relative: string;
    tree: ActivityTree;
}

/**
 * One session with the repository root its cwd resolves inside, absent when the cwd matches no open
 * repository.
 */
export interface ActivitySessionState {
    root_path?: string;
    session: ActivitySession;
}

/**
 * ActivityAnalyserState answers "is the analyser working at all", which is the first thing an
 * otherwise empty board has to say.
 * - unavailable: this host cannot read local files (a web host, or a user-data layout the analyser
 *   does not recognise) - reason names which
 * - scanning: the first read of every vendor is still in flight; nothing has been posted about a
 *   session yet
 * - live: at least one scan has completed, whether or not it found anything
 * - failed: the worker crashed and its one restart also failed
 */
export interface ActivityAnalyserState {
    state: AgentAnalyserState;
    reason?: string;
    refusals: ActivityRefusal[];
}

/**
 * ActivitySnapshot is the whole activity payload: the analyser's own state, every session it could
 * read across the three vendors, and every repository's working tree. An empty `sessions` array
 * while `state` is `live` is a meaningful answer, not a missing one: it says no agent is working
 * anywhere this analyser can see.
 */
export interface ActivitySnapshot {
    analyser: ActivityAnalyserState;
    sessions: ActivitySessionState[];
    trees: ActivityTreeState[];
}

export function emptyAnalyserState(state: AgentAnalyserState, reason?: string): ActivityAnalyserState {
    return { state, reason, refusals: [] };
}

export function emptyActivitySnapshot(state: AgentAnalyserState = 'scanning', reason?: string): ActivitySnapshot {
    return { analyser: emptyAnalyserState(state, reason), sessions: [], trees: [] };
}

/** every session id the analyser declared it could not fully read, deduped and sorted for a stable snapshot */
export function unreadableSessionIds(refusals: ReadonlyArray<ActivityRefusal>): string[] {
    const ids = new Set(refusals.map(refusal => refusal.session_id).filter((id): id is string => id !== undefined));
    return [...ids].sort();
}

/**
 * The changed files in one repository's uncommitted band credited to any of these session ids,
 * keeping git's own order.
 */
export function attributedFiles(tree: ActivityTree | undefined, session_ids: ReadonlyArray<string>): ActivityChangedFile[] {
    const wanted = new Set(session_ids);
    return (tree?.uncommitted ?? []).filter(file => file.session_id !== undefined && wanted.has(file.session_id));
}

/** the uncommitted files no session's write calls account for, which are never credited to a guessed agent */
export function unattributedFiles(tree: ActivityTree | undefined): ActivityChangedFile[] {
    return (tree?.uncommitted ?? []).filter(file => file.session_id === undefined);
}

/** the repository root a workspace-relative path sits inside: the tree whose `root_relative` the path begins with, deepest match wins where repositories nest */
export function treeForWorkspacePath(trees: ReadonlyArray<ActivityTreeState>, workspace_relative_path: string): ActivityTreeState | undefined {
    let best: ActivityTreeState | undefined;
    for (const entry of trees) {
        const base = entry.root_relative;
        if (base && !workspace_relative_path.startsWith(`${base}/`)) { continue; }
        if (!best || base.length > best.root_relative.length) { best = entry; }
    }
    return best;
}

/** fold everything the analyser has read so far into one payload, sorted so an unchanged read serialises identically and a caller can skip re-posting it */
export function buildActivitySnapshot(
    state: ActivityAnalyserState,
    sessions: HashMapOf<ActivitySessionState>,
    trees: HashMapOf<ActivityTreeState>,
): ActivitySnapshot {
    return {
        analyser: state,
        sessions: Object.values(sessions).sort((a, b) => a.session.session_id < b.session.session_id ? -1 : a.session.session_id > b.session.session_id ? 1 : 0),
        trees: Object.values(trees).sort((a, b) => a.root_path < b.root_path ? -1 : a.root_path > b.root_path ? 1 : 0),
    };
}

import { encodeClaudeProjectDirName, projectDirNamesWorkspace } from './agenthomeops';
import type {
    ActivityChangedFile,
    ActivityRejectCode,
    ActivitySession,
    ActivityStoryProgress,
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
 * Machine-readable reason an 'unavailable' state carries, so the webview renders fully translated
 * copy instead of embedding the host's own English `reason` sentence into a translated one (that
 * sentence stays on the wire as a fallback only, for a webview build that does not yet know a given
 * code - `AgentActivityBanner.tsx` > `emptyNotice`). Transient message field, not a persisted name.
 * - no_local_access: this host (local, or a web host) has no file access the analyser recognises
 * - remote_home_not_found: a remote window probed the workspace folder's ancestors and found no
 *   `.claude`, `.codex` or `.grok` directory on the remote host
 */
export const AGENT_ANALYSER_UNAVAILABLE_REASON_CODES = ['no_local_access', 'remote_home_not_found'] as const;
export type AgentAnalyserUnavailableReasonCode = typeof AGENT_ANALYSER_UNAVAILABLE_REASON_CODES[number];

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
 * - unavailable: this host (local or remote) cannot read an agent vendor's files - `reason_code`
 *   names which, for the webview to translate; `reason` is an English fallback only
 * - scanning: the first read of every vendor is still in flight; nothing has been posted about a
 *   session yet
 * - live: at least one scan has completed, whether or not it found anything
 * - failed: the worker crashed and its one restart also failed
 * - progress: while scanning, how many of the sessions found have been read or reused so far; absent
 *   once the scan is live
 * - done_roots: while scanning, the repository roots (`ActivityTreeState.root_path`) whose own scan is
 *   complete, because every session that could belong to them has been read; absent once live, when
 *   every root is done
 */
export interface ActivityAnalyserState {
    state: AgentAnalyserState;
    reason?: string;
    reason_code?: AgentAnalyserUnavailableReasonCode;
    refusals: ActivityRefusal[];
    progress?: ActivityScanProgress;
    done_roots?: string[];
}

/** ActivityScanProgress is the first scan's tally: sessions read or reused so far, out of the sessions it found */
export interface ActivityScanProgress {
    sessions_read: number;
    sessions_found: number;
}

/**
 * Where a session still to be read could belong, known before anything is read.
 * - claude_dir: Claude Code names each project folder for the session's launch directory with every
 *   character outside `[a-zA-Z0-9]` replaced by a dash (`encodeClaudeProjectDirName`)
 * - cwd: Grok's folder name is the URI-encoded cwd itself, decoded here
 * A Codex rollout names no directory, so its scope is absent and it could belong anywhere.
 */
export type AgentCandidateScope = { claude_dir: string } | { cwd: string };

/**
 * Whether a session with this scope could belong to the repository or folder at `root_path`: its
 * directory names that path (or a symlinked alias of it) or a folder inside it, or sits above it, since
 * a session launched in an umbrella folder can still write into a repository beneath. An unknown scope
 * could belong anywhere, so it never lets a repository count as finished early.
 */
export function scopeMayBelongTo(scope: AgentCandidateScope | undefined, root_path: string): boolean {
    if (scope === undefined) { return true; }
    if ('claude_dir' in scope) {
        return projectDirNamesWorkspace(scope.claude_dir, root_path) || encodeClaudeProjectDirName(root_path).startsWith(`${scope.claude_dir}-`);
    }
    return scope.cwd === root_path || scope.cwd.startsWith(`${root_path}/`) || root_path.startsWith(`${scope.cwd}/`);
}

/** the roots no remaining session could belong to, sorted so an unchanged answer serialises identically */
export function rootsWithNothingLeftToRead(root_paths: ReadonlyArray<string>, remaining: ReadonlyArray<AgentCandidateScope | undefined>): string[] {
    return root_paths.filter(root_path => !remaining.some(scope => scopeMayBelongTo(scope, root_path))).sort();
}

/**
 * ActivitySnapshot is the whole activity payload: the analyser's own state, every session it could
 * read across the three vendors, and every repository's working tree. An empty `sessions` array
 * while `state` is `live` is a meaningful answer, not a missing one: it says no agent is working
 * anywhere this analyser can see.
 * - progress: the coordinators' per-story percentages for the repositories in the open folder; empty
 *   when none is recorded or this host cannot read them, which is not an error
 */
export interface ActivitySnapshot {
    analyser: ActivityAnalyserState;
    sessions: ActivitySessionState[];
    trees: ActivityTreeState[];
    progress: ActivityStoryProgress[];
}

export function emptyAnalyserState(state: AgentAnalyserState, reason?: string, reason_code?: AgentAnalyserUnavailableReasonCode): ActivityAnalyserState {
    return { state, reason, reason_code, refusals: [] };
}

export function emptyActivitySnapshot(state: AgentAnalyserState = 'scanning', reason?: string, reason_code?: AgentAnalyserUnavailableReasonCode): ActivitySnapshot {
    return { analyser: emptyAnalyserState(state, reason, reason_code), sessions: [], trees: [], progress: [] };
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
    progress: ReadonlyArray<ActivityStoryProgress> = [],
): ActivitySnapshot {
    return {
        analyser: state,
        sessions: Object.values(sessions).sort((a, b) => a.session.session_id < b.session.session_id ? -1 : a.session.session_id > b.session.session_id ? 1 : 0),
        trees: Object.values(trees).sort((a, b) => a.root_path < b.root_path ? -1 : a.root_path > b.root_path ? 1 : 0),
        progress: [...progress],
    };
}

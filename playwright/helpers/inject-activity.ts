import type { Page } from '@playwright/test';

/**
 * Builds a synthetic activity snapshot shaped exactly as `AgentAnalyser.ts` posts one, with no
 * on-disk fixture. Sessions can be placed at any `root_path`/`root_relative`; the card resolves
 * them by `root_relative` alone, the way `treeForDocPath` does.
 */

const DEFAULT_ROOT_RELATIVE = 'notethink';
const DEFAULT_ROOT_PATH = '/mnt/workspace/in_development/notethink';
const TODO_PATH = 'docstech/users/alex.stanhope/todo.md';

const CLAUDE_CAPABILITIES = { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' };
const CODEX_CAPABILITIES = { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' };
const GROK_CAPABILITIES = { live_tool_call: 'supported', question: 'supported', file_attribution: 'unsupported' };
const USAGE = { input_tokens: 4200, output_tokens: 980, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.34, is_estimate: true };

interface ActivityRefusalSpec {
    file: string;
    code: string;
    reason: string;
    session_id?: string;
}

/**
 * Options for one injected activity snapshot.
 * - root_relative: relative to the workspace folder; '' when the repository IS the workspace folder
 * - state: defaults to 'live'; 'scanning' posts a growing snapshot, as an interim batch looks
 * - sessions: session ids to keep; defaults to every session this helper declares
 * - tail_read_sessions: ids of sessions to mark `tail_read`, as the analyser does for a transcript over its size bound
 * - extra_uncommitted: extra unattributed changed files, to fill a card's uncommitted band
 * - no_uncommitted: leaves the working tree clean, so the card has no uncommitted files
 * - pending_commits: the branch's ahead-of-upstream count, 2 by default; 'none' leaves it off, as a branch with no upstream does
 * - pending_detail: the newest pending commits as the host lists them; by default up to two, one per pending commit, and 'none' leaves it off, as a repository whose objects cannot be read does
 * - scan_progress: the first scan's tally of sessions read out of sessions found, carried on a scanning snapshot
 * - repository_done: a scanning snapshot also names this repository as one whose own scan is done, as the host does once every session that could belong to it has been read
 * - finished_children: how many finished subagents the `claude-coordinator` session carries beside its running one
 * - progress: coordinator percentages by story id, each stamped as written by the coordinator at the given time
 */
interface InjectActivityOptions {
    root_relative?: string;
    root_path?: string;
    live?: boolean;
    state?: 'scanning' | 'live' | 'unavailable';
    refusals?: ActivityRefusalSpec[];
    sessions?: string[];
    tail_read_sessions?: string[];
    extra_uncommitted?: number;
    no_uncommitted?: boolean;
    pending_commits?: number | 'none';
    pending_detail?: Array<Record<string, unknown>> | 'none';
    scan_progress?: { sessions_read: number; sessions_found: number };
    repository_done?: boolean;
    finished_children?: number;
    progress?: Array<{ story_id: string; pct: number; at?: string; note?: string }>;
}

/** one bound session's `stories`/`story_usage` pair for a single story, the common case every fixture session below has */
function boundToOneStory(doc_path: string, id: string): Record<string, unknown> {
    const story = { doc_path, id };
    return { stories: [story], story_usage: [{ story, usage: USAGE }] };
}

function claudeBoundBusy(story_doc_path: string): Record<string, unknown> {
    return {
        session_id: 'claude-bound-busy', vendor: 'claude-code', project: 'notethink',
        started_at: '2026-09-18T08:51:30Z', updated_at: '2026-09-18T09:14:01Z', state: 'working',
        story_binding: 'bound', ...boundToOneStory(story_doc_path, 'agent-activity-card'),
        capabilities: CLAUDE_CAPABILITIES,
        current: { at: '2026-09-18T09:14:01Z', kind: 'tool_call', tool: 'Edit', arg: 'client/extension/src/types/AgentActivity.ts' },
        model: 'claude-sonnet-5',
        // well under the 22m31s span between started_at and updated_at, so active mode and span mode read visibly differently
        active_ms: 7 * 60 * 1000,
        usage: USAGE,
    };
}

function grokBoundIdle(story_doc_path: string): Record<string, unknown> {
    return {
        session_id: 'grok-bound-idle', vendor: 'grok', project: 'notethink',
        started_at: '2026-09-18T08:20:05Z', updated_at: '2026-09-18T09:10:12Z', state: 'idle',
        story_binding: 'bound', ...boundToOneStory(story_doc_path, 'kanban-card-ratio-height'),
        capabilities: GROK_CAPABILITIES,
        usage: USAGE,
    };
}

function grokQuestion(story_doc_path: string): Record<string, unknown> {
    return {
        session_id: 'grok-question', vendor: 'grok', project: 'notethink',
        started_at: '2026-09-18T09:02:11Z', updated_at: '2026-09-18T09:13:40Z', state: 'waiting',
        story_binding: 'bound', ...boundToOneStory(story_doc_path, 'user-view-type-update'),
        capabilities: GROK_CAPABILITIES,
        current: { at: '2026-09-18T09:13:40Z', kind: 'tool_call', tool: 'run_terminal_command' },
        question: { question_id: 'q-4417', asked_at: '2026-09-18T09:13:40Z', prompt: 'Apply the rename across all 14 call sites?', options: ['Yes', 'No, just this one', 'Cancel'] },
        usage: USAGE,
    };
}

const CHILD_USAGE = { input_tokens: 2400, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.02, is_estimate: true };

/**
 * A coordinator carrying subagents, bound to the story the agent card spec draws: one running
 * subagent started long ago (so its run time reads in minutes whenever the spec runs) plus a number
 * of finished ones, each a few minutes long, oldest first as the analyser lists them.
 */
function claudeCoordinator(story_doc_path: string, finished_children = 1): Record<string, unknown> {
    const finished = Array.from({ length: finished_children }, (_, i) => ({
        child_id: `fin${i + 1}`, title: `Finished task ${i + 1}`, agent_type: 'general-purpose', model: 'claude-sonnet-5', state: 'ended',
        started_at: `2026-09-18T08:${String(10 + i * 5).padStart(2, '0')}:00Z`, updated_at: `2026-09-18T08:${String(14 + i * 5).padStart(2, '0')}:00Z`, active_ms: 4 * 60 * 1000,
        usage: CHILD_USAGE,
    }));
    const running = {
        child_id: 'run1', title: 'Map view code', agent_type: 'Explore', model: 'claude-haiku-5', state: 'working',
        started_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updated_at: new Date().toISOString(),
        current: { at: new Date().toISOString(), kind: 'tool_call', tool: 'Grep', arg: 'agentRail' },
        usage: CHILD_USAGE,
    };
    return {
        session_id: 'claude-coordinator', vendor: 'claude-code', project: 'notethink', session_name: 'coord-notethink',
        started_at: '2026-09-18T08:00:00Z', updated_at: '2026-09-18T09:14:30Z', state: 'working',
        story_binding: 'bound', ...boundToOneStory(story_doc_path, 'agent-activity-card'),
        capabilities: CLAUDE_CAPABILITIES,
        current: { at: '2026-09-18T09:14:30Z', kind: 'tool_call', tool: 'Bash', arg: 'pnpm run test-jest' },
        model: 'claude-opus-5',
        children: [...finished, running],
        usage: USAGE,
    };
}

function claudeNoStory(): Record<string, unknown> {
    return {
        session_id: 'claude-no-story', vendor: 'claude-code', project: 'notethink', session_name: 'coord-demo',
        started_at: '2026-09-18T09:06:40Z', updated_at: '2026-09-18T09:13:55Z', state: 'working',
        story_binding: 'none',
        capabilities: CLAUDE_CAPABILITIES,
        current: { at: '2026-09-18T09:13:55Z', kind: 'tool_call', tool: 'Bash', arg: 'pnpm run lint' },
        usage: USAGE,
    };
}

function codexNoQuestion(story_doc_path: string): Record<string, unknown> {
    return {
        session_id: 'codex-no-question', vendor: 'codex', project: 'notethink',
        started_at: '2026-09-18T09:05:00Z', updated_at: '2026-09-18T09:12:00Z', state: 'unknown',
        story_binding: 'bound', ...boundToOneStory(story_doc_path, 'code-layout-blank-lines'),
        capabilities: CODEX_CAPABILITIES,
        usage: USAGE,
    };
}

const REGISTRY_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };

/**
 * A registry-only row as the analyser builds one from an entry no vendor session joins: the agent's
 * name, its vendor and state, no capabilities, no usage, and a story binding only where the story
 * was in flight on the board.
 */
function registryOnly(session_id: string, overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        session_id, vendor: 'agy', project: 'notethink', registry_only: true,
        started_at: '2026-09-18T09:00:00Z', updated_at: '2026-09-18T09:00:00Z', state: 'idle',
        story_binding: 'none', capabilities: {}, usage: REGISTRY_USAGE,
        ...overrides,
    };
}

/** a coordinator bound to its story from the registry alone, before it has written a line: no transcript, so no live line, model or usage */
function registryCoordinator(story_doc_path: string): Record<string, unknown> {
    return registryOnly('registry:coord-demo:notethink', {
        vendor: 'claude-code', registry_name: 'coord-demo', state: 'working', registry_story: 'agent-activity-card',
        story_binding: 'bound', stories: [{ doc_path: story_doc_path, id: 'agent-activity-card' }], story_usage: [{ story: { doc_path: story_doc_path, id: 'agent-activity-card' }, usage: REGISTRY_USAGE }],
    });
}

// sessions only a spec naming them draws, so the default fixture's per-card row counts stay as the older specs assert
const OPT_IN_SESSIONS = new Set(['claude-coordinator', 'registry-coordinator', 'registry-agy', 'registry-stale', 'registry-stopped']);

const SESSION_BUILDERS: Record<string, (story_doc_path: string, options: InjectActivityOptions) => Record<string, unknown>> = {
    'claude-coordinator': (story_doc_path, options) => claudeCoordinator(story_doc_path, options.finished_children),
    'registry-coordinator': story_doc_path => registryCoordinator(story_doc_path),
    'registry-agy': () => registryOnly('registry:agy-helper:notethink', { registry_name: 'agy-helper', state: 'idle', registry_story: 'kanban-card-ratio-height' }),
    'registry-stale': () => registryOnly('registry:agy-stale:notethink', { registry_name: 'agy-stale', state: 'idle', registry_stale: true, registry_story: 'code-layout-blank-lines' }),
    'registry-stopped': () => registryOnly('registry:agy-stopped:notethink', { registry_name: 'agy-stopped', state: 'ended' }),
    'claude-bound-busy': claudeBoundBusy,
    'grok-bound-idle': grokBoundIdle,
    'grok-question': grokQuestion,
    'claude-no-story': () => claudeNoStory(),
    'codex-no-question': codexNoQuestion,
};

/** the tree one repository's working tree carries, keyed to the same session ids the sessions above declare */
const PENDING_COMMITS_DETAIL = [
    { short_sha: 'abc1234', files: 3, added: 100, removed: 4 },
    { short_sha: 'def5678', files: 1, added: 20, removed: 30 },
];

function activityTree(extra_uncommitted = 0, pending_commits: number | 'none' = 2, no_uncommitted = false, pending_detail?: Array<Record<string, unknown>> | 'none'): Record<string, unknown> {
    const detail = pending_detail ?? (pending_commits === 'none' ? 'none' : PENDING_COMMITS_DETAIL.slice(0, pending_commits));
    const extra = Array.from({ length: extra_uncommitted }, (_, i) => ({ path: `docs/extra-${i + 1}.md`, change: 'modified' }));
    return {
        generated_at: '2026-09-18T09:14:02Z',
        branch: 'staging',
        head_commit: 'ef11de8b1c9a4d2f6e5b0a3c7d8e9f01a2b3c4d5',
        uncommitted: no_uncommitted ? [] : [
            { path: 'client/extension/src/types/AgentActivity.ts', change: 'added', session_id: 'claude-bound-busy', added: 18, removed: 0 },
            { path: 'client/extension/src/lib/agentanalyserops.ts', change: 'added', session_id: 'claude-bound-busy', added: 6, removed: 0 },
            { path: 'package.json', change: 'modified' },
            { path: 'media/board-icon.png', change: 'modified', session_id: 'claude-no-story' },
            ...extra,
        ],
        committed: [
            { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4', subject: 'wire the sticky note group', session_id: 'grok-bound-idle' },
            { sha: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5', subject: 'rename axisops', session_id: 'grok-bound-idle' },
        ],
        ...(pending_commits === 'none' ? {} : { pending_commits }),
        ...(detail === 'none' || detail.length === 0 ? {} : { pending_detail: detail }),
    };
}

/** the snapshot the analyser posts, assembled from synthetic data shaped exactly as the real one is */
export function activityFixtureSnapshot(options: InjectActivityOptions = {}): Record<string, unknown> {
    const root_relative = options.root_relative ?? DEFAULT_ROOT_RELATIVE;
    const root_path = options.root_path ?? DEFAULT_ROOT_PATH;
    const story_doc_path = root_relative ? `${root_relative}/${TODO_PATH}` : TODO_PATH;
    const ids = options.sessions ?? Object.keys(SESSION_BUILDERS).filter(id => !OPT_IN_SESSIONS.has(id));
    const sessions = ids.map(id => ({
        root_path,
        session: { ...SESSION_BUILDERS[id](story_doc_path, options), ...(options.tail_read_sessions?.includes(id) ? { tail_read: true } : {}) },
    }));
    return {
        analyser: {
            state: options.state ?? (options.live === false ? 'unavailable' : 'live'),
            refusals: options.refusals ?? [],
            ...(options.scan_progress ? { progress: options.scan_progress } : {}),
            ...(options.repository_done ? { done_roots: [root_path] } : {}),
        },
        sessions,
        trees: [{ root_path, root_relative, tree: activityTree(options.extra_uncommitted, options.pending_commits, options.no_uncommitted, options.pending_detail) }],
        progress: (options.progress ?? []).map(entry => ({ root_relative, at: '2026-09-18T09:00:00Z', by: 'coordinator', ...entry })),
    };
}

/** post one activity snapshot to the webview */
export async function injectActivity(page: Page, options: InjectActivityOptions = {}): Promise<void> {
    const activity = activityFixtureSnapshot(options);
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: payload } }));
    }, activity);
}

/**
 * Post a snapshot spanning several repositories, each carrying only its own `claude-no-story`
 * unbound session, for the repository-scoping spec: a workspace rooted above several repositories
 * sees every one of them, so admission has to be proved against more than the single tree
 * `injectActivity` builds.
 */
export async function injectActivityAcrossRepos(page: Page, repos: Array<Pick<InjectActivityOptions, 'root_relative' | 'root_path'>>): Promise<void> {
    const snapshots = repos.map(repo => activityFixtureSnapshot({ ...repo, sessions: ['claude-no-story'] }));
    const activity = {
        analyser: { state: 'live', refusals: [] },
        sessions: snapshots.flatMap(snapshot => snapshot.sessions),
        trees: snapshots.flatMap(snapshot => snapshot.trees),
    };
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: payload } }));
    }, activity);
}

/** post a snapshot saying the analyser is live and has found nothing, which is what a workspace with no agent working looks like */
export async function injectNoProducer(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'activity', activity: { analyser: { state: 'live', refusals: [] }, sessions: [], trees: [] } },
        }));
    });
}

/** post a snapshot saying the analyser's first scan is still in flight, which is what the host posts the moment a panel first demands activity */
export async function injectScanning(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'activity', activity: { analyser: { state: 'scanning', refusals: [] }, sessions: [], trees: [] } },
        }));
    });
}

/** post the host's answer that a row's request could not be carried out */
export async function injectActivityUnavailable(page: Page, notice: { request: 'diff' | 'chat'; reason: string; path?: string; session_id?: string }): Promise<void> {
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activityUnavailable', ...payload } }));
    }, notice);
}

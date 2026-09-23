import type { Page } from '@playwright/test';

/*
 * Drive the agent card from a synthetic snapshot shaped exactly as `AgentAnalyser.ts` posts one, with
 * no live agent anywhere: five sessions across the three vendors, one repository's working tree, and
 * no on-disk fixture at all. There used to be a `.notethink/` contract this helper read from disk and
 * reassembled; it is retired (agent-activity-card story, superseded 2026-09-21), and the analyser's
 * payload needs no reassembly, since a spec can build the wire shape directly.
 *
 * The snapshot is per repository, so a spec can place the sessions at any `root_path`/`root_relative`
 * and the card's join has to resolve it from `root_relative` alone, exactly as `treeForDocPath` does.
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
 * - root_relative: where the analyser found the repository, relative to the workspace folder; '' when
 *   it IS the workspace folder
 * - sessions: session ids to keep, defaulting to every session this helper declares
 * - extra_uncommitted: this many more unattributed changed files in the working tree, enough to fold
 *   a card's uncommitted band
 */
interface InjectActivityOptions {
    root_relative?: string;
    root_path?: string;
    live?: boolean;
    refusals?: ActivityRefusalSpec[];
    sessions?: string[];
    extra_uncommitted?: number;
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

function claudeNoStory(): Record<string, unknown> {
    return {
        session_id: 'claude-no-story', vendor: 'claude-code', project: 'notethink',
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

const SESSION_BUILDERS: Record<string, (story_doc_path: string) => Record<string, unknown>> = {
    'claude-bound-busy': claudeBoundBusy,
    'grok-bound-idle': grokBoundIdle,
    'grok-question': grokQuestion,
    'claude-no-story': () => claudeNoStory(),
    'codex-no-question': codexNoQuestion,
};

/** the tree one repository's working tree carries, keyed to the same session ids the sessions above declare */
function activityTree(extra_uncommitted = 0): Record<string, unknown> {
    const extra = Array.from({ length: extra_uncommitted }, (_, i) => ({ path: `docs/extra-${i + 1}.md`, change: 'modified' }));
    return {
        generated_at: '2026-09-18T09:14:02Z',
        branch: 'staging',
        head_commit: 'ef11de8b1c9a4d2f6e5b0a3c7d8e9f01a2b3c4d5',
        uncommitted: [
            { path: 'client/extension/src/types/AgentActivity.ts', change: 'added', session_id: 'claude-bound-busy', added: 18, removed: 0 },
            { path: 'client/extension/src/lib/agentanalyserops.ts', change: 'added', session_id: 'claude-bound-busy', added: 6, removed: 0 },
            { path: 'package.json', change: 'modified' },
            { path: 'media/board-icon.png', change: 'modified', session_id: 'claude-no-story' },
            ...extra,
        ],
        committed: [
            { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4', subject: 'wire the sticky note lane', session_id: 'grok-bound-idle' },
            { sha: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5', subject: 'rename axisops', session_id: 'grok-bound-idle' },
        ],
    };
}

/** the snapshot the analyser posts, assembled from synthetic data shaped exactly as the real one is */
export function activityFixtureSnapshot(options: InjectActivityOptions = {}): Record<string, unknown> {
    const root_relative = options.root_relative ?? DEFAULT_ROOT_RELATIVE;
    const root_path = options.root_path ?? DEFAULT_ROOT_PATH;
    const story_doc_path = root_relative ? `${root_relative}/${TODO_PATH}` : TODO_PATH;
    const ids = options.sessions ?? Object.keys(SESSION_BUILDERS);
    const sessions = ids.map(id => ({
        root_path,
        session: SESSION_BUILDERS[id](story_doc_path),
    }));
    return {
        analyser: { state: options.live === false ? 'unavailable' : 'live', refusals: options.refusals ?? [] },
        sessions,
        trees: [{ root_path, root_relative, tree: activityTree(options.extra_uncommitted) }],
    };
}

/** post one activity snapshot to the webview */
export async function injectActivity(page: Page, options: InjectActivityOptions = {}): Promise<void> {
    const activity = activityFixtureSnapshot(options);
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

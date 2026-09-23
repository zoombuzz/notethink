import {
    AGENT_TRANSCRIPT_MAX_BYTES,
    type AgentApiCall,
    type AgentReadRefusal,
    type AgentSessionInput,
    type AgentSessionResult,
} from './agentvendorops';
import type { ActivityEventBody, ActivityQuestion, ActivityState } from '../../types/AgentActivity';

/**
 * Reads a Grok CLI session (`~/.grok/sessions/<url-encoded-cwd>/<session-id>/events.jsonl`, with a
 * sibling `usage.json` once a turn has completed) into the shared `AgentSessionResult` shape.
 *
 * `events.jsonl` is a pure event and tool timeline, append-only, in true write order: it carries a
 * tool's name and outcome but never its argument and never any conversation text, which is why
 * `capabilitiesForVendor` in `agentvendorops.ts` marks `file_attribution` unsupported for this vendor
 * and why `tool_invocations` is always empty below. `current` and `question` are both derived the same
 * way: pair `tool_started`/`tool_completed` (and `permission_requested`/`permission_resolved`) FIFO per
 * `tool_name`, since the file carries no id linking a start to its own completion, and whatever is left
 * pending after the scan is what is still running or still awaiting the operator.
 *
 * `usage.json` is the only source of token and cost figures; `calls` is built from its `turns` array
 * rather than the top-level `session` aggregate, which double-counts across turns.
 */

export interface GrokLine {
    ts?: string;
    type?: string;
    tool_name?: string;
    outcome?: string;
}

interface GrokParsedLines {
    lines: GrokLine[];
    dropped_trailing: boolean;
}

/** splits events.jsonl into JSON lines, dropping one torn trailing line silently; returns undefined when any non-trailing line fails to parse */
function parseGrokLines(text: string): GrokParsedLines | undefined {
    const raw_lines = text.split('\n').filter((line) => line.trim().length > 0);
    const lines: GrokLine[] = [];
    let dropped_trailing = false;
    for (let i = 0; i < raw_lines.length; i += 1) {
        const raw_line = raw_lines[i];
        try {
            lines.push(JSON.parse(raw_line) as GrokLine);
        } catch {
            const is_last = i === raw_lines.length - 1;
            if (is_last) { dropped_trailing = true; } else { return undefined; }
        }
    }
    return { lines, dropped_trailing };
}

/** true when a timestamp falls in the caller's read window; an unparseable timestamp is treated as out of window rather than guessed in */
function grokTsInWindow(ts: string, window_start_ms: number, now_ms: number): boolean {
    const at_ms = Date.parse(ts);
    if (Number.isNaN(at_ms)) { return false; }
    return at_ms >= window_start_ms && at_ms <= now_ms;
}

/** one tool_started still waiting on its tool_completed, or one permission_requested still waiting on its permission_resolved, queued FIFO per tool_name */
type GrokPendingByTool = Record<string, string[]>;

function pushPending(pending: GrokPendingByTool, tool_name: string, ts: string): void {
    (pending[tool_name] ??= []).push(ts);
}

/** pops the oldest pending entry for this tool_name, the FIFO pairing a tool_completed or permission_resolved resolves against */
function shiftPending(pending: GrokPendingByTool, tool_name: string): string | undefined {
    return pending[tool_name]?.shift();
}

/** the most recently opened entry still pending across every tool_name, since only the latest one is reported as current or as the pending question */
function latestPending(pending: GrokPendingByTool): { ts: string; tool_name: string } | undefined {
    let best: { ts: string; tool_name: string } | undefined;
    for (const [tool_name, queue] of Object.entries(pending)) {
        for (const ts of queue) {
            if (!best || Date.parse(ts) > Date.parse(best.ts)) { best = { ts, tool_name }; }
        }
    }
    return best;
}

function hasAnyPending(pending: GrokPendingByTool): boolean {
    return Object.values(pending).some((queue) => queue.length > 0);
}

interface GrokModelUsage {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
    costUsdTicks?: number;
}

interface GrokTurn {
    endedAt?: string;
    modelUsage?: Record<string, GrokModelUsage>;
}

interface GrokUsageFile {
    turns?: GrokTurn[];
}

/**
 * One `AgentApiCall` per model per in-window turn, read from `usage.json`'s own `turns` array.
 * `span_start_at` is the immediately preceding turn's own `endedAt` regardless of whether that turn
 * itself falls in the window, since it is the true wall-clock predecessor a time-windowed rate is
 * measured against, not merely the previous in-window entry. A malformed or absent usage file is not
 * a refusal for the whole session: the events timeline is the primary source of truth for session
 * state, and usage is supplementary, so this returns an empty list rather than failing the read.
 */
function grokApiCallsFromUsage(usage_text: string, window_start_ms: number, now_ms: number): AgentApiCall[] {
    let parsed: GrokUsageFile;
    try {
        const decoded: unknown = JSON.parse(usage_text);
        if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) { return []; }
        parsed = decoded as GrokUsageFile;
    } catch {
        return [];
    }
    const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
    const calls: AgentApiCall[] = [];
    for (let i = 0; i < turns.length; i += 1) {
        const turn = turns[i];
        if (!turn?.endedAt || !turn.modelUsage || Object.keys(turn.modelUsage).length === 0) { continue; }
        if (!grokTsInWindow(turn.endedAt, window_start_ms, now_ms)) { continue; }
        const span_start_at = i > 0 ? turns[i - 1]?.endedAt : undefined;
        for (const [model_id, usage] of Object.entries(turn.modelUsage)) {
            if (!usage) { continue; }
            // grok counts reasoning tokens separately from output tokens, and AgentApiCall has no separate slot, so this folds them together
            const output_tokens = (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
            // costUsdTicks is not published: no source confirms its unit, so this is never surfaced as the vendor's own authoritative figure; the price table prices this call as an estimate instead, like every other vendor
            calls.push({
                model_id,
                at: turn.endedAt,
                span_start_at,
                input_tokens: usage.inputTokens ?? 0,
                output_tokens,
                cache_read_tokens: usage.cachedReadTokens ?? 0,
                cache_write_tokens: usage.cacheCreationTokens ?? 0,
            });
        }
    }
    return calls;
}

/**
 * The model id on the session's own most recent turn, read from `usage.json`'s `turns` array: each
 * turn's `modelUsage` is keyed by model id, the only place a Grok session names one at all (`events.jsonl`
 * carries no model field). Walks from the end regardless of the read window, since the session's current
 * model outlives whatever window happens to be open; a turn with more than one model key (a mid-turn
 * model switch) reports its first key rather than guessing which one is "current".
 */
function grokLatestModelFromUsage(usage_text: string): string | undefined {
    let parsed: GrokUsageFile;
    try {
        const decoded: unknown = JSON.parse(usage_text);
        if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) { return undefined; }
        parsed = decoded as GrokUsageFile;
    } catch {
        return undefined;
    }
    const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
    for (let i = turns.length - 1; i >= 0; i--) {
        const model_ids = Object.keys(turns[i]?.modelUsage ?? {});
        if (model_ids.length > 0) { return model_ids[0]; }
    }
    return undefined;
}

/**
 * Parses `events.jsonl`'s text and checks it against the two whole-file refusal conditions
 * (too_large, invalid_shape). Exported so `AgentAnalyserWorker.ts` can run it once against a session's
 * current full bytes (first sight, a shrunk or rewritten file, or a session re-read after a worker
 * restart) and reuse the very same `lines` both to build the session's result and to seed the
 * incremental cache, rather than parsing the same text twice.
 */
export function parseGrokTranscript(text: string): { lines: GrokLine[]; refusal?: AgentReadRefusal } {
    const byte_length = new TextEncoder().encode(text).length;
    if (byte_length > AGENT_TRANSCRIPT_MAX_BYTES) {
        return { lines: [], refusal: { code: 'too_large', reason: `transcript is ${byte_length} bytes, over the ${AGENT_TRANSCRIPT_MAX_BYTES} byte limit` } };
    }
    const parsed = parseGrokLines(text);
    if (!parsed) {
        return { lines: [], refusal: { code: 'invalid_shape', reason: 'transcript has no parseable JSONL lines' } };
    }
    return { lines: parsed.lines };
}

/**
 * Builds one session's result from `events.jsonl`'s already-parsed lines and `usage.json`'s own text
 * (never tail-parsed: it is rewritten whole each turn rather than appended, so it carries no
 * incremental state of its own - `AgentAnalyser.ts`'s per-file `appendable` flag marks it so).
 * Pure and independent of how `lines` was assembled, so the same function serves a whole-file read
 * (`readGrokSession` below) and a resumed one (`AgentAnalyserWorker.ts`, which appends only the newly
 * tail-parsed lines to a cached array before calling this): there is exactly one code path building a
 * result from lines, whether the caller supplies a fresh parse or a resumed tail.
 */
export function buildGrokResult(input: AgentSessionInput, lines: GrokLine[]): AgentSessionResult {
    const tool_pending: GrokPendingByTool = {};
    const permission_pending: GrokPendingByTool = {};
    for (const line of lines) {
        if (!line.ts || typeof line.tool_name !== 'string') { continue; }
        switch (line.type) {
            case 'tool_started':
                pushPending(tool_pending, line.tool_name, line.ts);
                break;
            case 'tool_completed':
                shiftPending(tool_pending, line.tool_name);
                break;
            case 'permission_requested':
                pushPending(permission_pending, line.tool_name, line.ts);
                break;
            case 'permission_resolved':
                shiftPending(permission_pending, line.tool_name);
                break;
            default:
                // an unrecognised or non-actionable type (loop_started, first_token, phase_changed, turn_started, turn_ended, mcp_*) is skipped, not rejected
                break;
        }
    }
    const session_id = input.session_id;
    const cwd = input.cwd;
    const latest_pending_tool = latestPending(tool_pending);
    const current: ActivityEventBody | undefined = latest_pending_tool && grokTsInWindow(latest_pending_tool.ts, input.window_start_ms, input.now_ms)
        ? { at: latest_pending_tool.ts, kind: 'tool_call', tool: latest_pending_tool.tool_name }
        : undefined;
    const latest_pending_permission = latestPending(permission_pending);
    const question: ActivityQuestion | undefined = latest_pending_permission && grokTsInWindow(latest_pending_permission.ts, input.window_start_ms, input.now_ms)
        ? { question_id: `${latest_pending_permission.tool_name}:${latest_pending_permission.ts}`, asked_at: latest_pending_permission.ts, prompt: `Grant ${latest_pending_permission.tool_name} permission?` }
        : undefined;
    // waiting wins over working when both a pending tool and a pending permission request exist, since a pending permission blocks everything else
    const state: ActivityState = input.vendor_live === false
        ? 'ended'
        : input.vendor_live === true
            ? (hasAnyPending(permission_pending) ? 'waiting' : hasAnyPending(tool_pending) ? 'working' : 'idle')
            : 'unknown';
    const started_at = lines.find((line) => line.ts)?.ts ?? new Date(input.now_ms).toISOString();
    const last_line_with_ts = [...lines].reverse().find((line) => line.ts);
    const updated_at = last_line_with_ts?.ts ?? started_at;
    const usage_file = input.extra_files.find((file) => file.path.endsWith('usage.json'));
    const calls = usage_file ? grokApiCallsFromUsage(usage_file.text, input.window_start_ms, input.now_ms) : [];
    const model = usage_file ? grokLatestModelFromUsage(usage_file.text) : undefined;
    return {
        session_id,
        cwd,
        state,
        started_at,
        updated_at,
        ended_at: input.vendor_live === false ? updated_at : undefined,
        current,
        model,
        question,
        calls,
        // events.jsonl carries no command text to inspect, so neither a written file nor a git commit can ever be attributed from it
        tool_invocations: [],
    };
}

/**
 * Reads one Grok CLI session. Pure and synchronous: no `vscode`, no `fs`, so it runs unchanged inside
 * the analyser's nested web worker and in a plain Jest test.
 */
export function readGrokSession(input: AgentSessionInput): AgentSessionResult {
    const { lines, refusal } = parseGrokTranscript(input.transcript.text);
    if (refusal) { return emptyGrokResult(input, refusal); }
    return buildGrokResult(input, lines);
}

function emptyGrokResult(input: AgentSessionInput, refusal: AgentReadRefusal): AgentSessionResult {
    return {
        session_id: input.session_id,
        cwd: input.cwd,
        state: 'unknown',
        started_at: new Date(input.now_ms).toISOString(),
        updated_at: new Date(input.now_ms).toISOString(),
        calls: [],
        tool_invocations: [],
        refusal,
    };
}

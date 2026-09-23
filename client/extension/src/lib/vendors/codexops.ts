import {
    AGENT_EDIT_SNIPPET_MAX_CHARS,
    AGENT_TRANSCRIPT_MAX_BYTES,
    type AgentApiCall,
    type AgentReadRefusal,
    type AgentSessionInput,
    type AgentSessionResult,
    type AgentToolInvocation,
    type AgentToolInvocationEdit,
} from './agentvendorops';
import { ACTIVITY_ARG_MAX_CHARS, type ActivityEventBody } from '../../types/AgentActivity';

/**
 * Reads a Codex rollout transcript (`~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`)
 * into the shared `AgentSessionResult` shape. Codex writes no live-session list of its own, unlike
 * Claude Code and Grok, so liveness is not this reader's to decide: the caller derives it from the
 * rollout file's own mtime and hands it in as `input.vendor_live`, and this reader trusts it.
 *
 * The file is one JSON object per line, append-only, in true write order; `ordinal` and `timestamp`
 * are read back only as a tiebreak, never as the primary order. Every per-line-type parse stays
 * defensive (skip the line for that purpose rather than throw), since a producer can still be writing
 * while this reads, and a rollout spans CLI versions whose exact line shapes differ.
 *
 * Two line shapes exist across CLI versions, and this reader handles both:
 * - current (cli_version 0.153.2, `originator: codex-tui`): a tool call is a `response_item` line
 *   whose `payload.type` is `custom_tool_call`, named by `payload.name` (`exec`, `apply_patch`
 *   confirmed), carrying its own content directly in `payload.input` - a JS snippet for `exec`, the
 *   literal `apply_patch` patch body for `apply_patch`. Its usage is a separate `token_usage_record`
 *   line (not `token_count`), and its model id is carried on neither: it comes from the most recent
 *   `event_msg` line of type `thread_settings_applied`, `payload.thread_settings.model`.
 * - older: a tool call is `response_item`/`payload.type === 'function_call'`, `payload.name` the tool
 *   name, `payload.arguments` a JSON-ENCODED STRING of the call's arguments (e.g.
 *   `'{"cmd":"...","workdir":"..."}'`), not a bare command string. `apply_patch` is also seen invoked
 *   as its own `custom_tool_call` under this older shape, so the two shapes coexist across CLI
 *   versions rather than being strictly chronological; both are read.
 */

// one decoded line of a Codex rollout file, loosely typed since only `type` and `timestamp` are confirmed shape
export interface CodexLine {
    timestamp?: string;
    ordinal?: number;
    type?: string;
    payload?: Record<string, unknown>;
}

interface CodexParsedLines {
    lines: CodexLine[];
    dropped_trailing: boolean;
}

/** splits the transcript into JSON lines, dropping one torn trailing line silently; returns undefined when any non-trailing line fails to parse */
function parseCodexLines(text: string): CodexParsedLines | undefined {
    const raw_lines = text.split('\n').filter((line) => line.trim().length > 0);
    const lines: CodexLine[] = [];
    let dropped_trailing = false;
    for (let i = 0; i < raw_lines.length; i += 1) {
        const raw_line = raw_lines[i];
        try {
            lines.push(JSON.parse(raw_line) as CodexLine);
        } catch {
            const is_last = i === raw_lines.length - 1;
            if (is_last) { dropped_trailing = true; } else { return undefined; }
        }
    }
    return { lines, dropped_trailing };
}

/** true when a line's own timestamp falls in the caller's read window; a line with no parseable timestamp is treated as out of window rather than guessed in */
function codexLineInWindow(line: CodexLine, window_start_ms: number, now_ms: number): boolean {
    if (!line.timestamp) { return false; }
    const at_ms = Date.parse(line.timestamp);
    if (Number.isNaN(at_ms)) { return false; }
    return at_ms >= window_start_ms && at_ms <= now_ms;
}

// the numeric usage fields on a token_usage_record line's own `payload.usage` (also `turn_token_usage`/`thread_token_usage`, both cumulative rather than per-call, so neither is read)
interface CodexUsageFields {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
}

/**
 * The model id in effect for a `token_usage_record` line, tracked across the walk: a
 * `thread_settings_applied` event_msg line (`payload.thread_settings.model`) is the only place a
 * rollout names the model at all, so the most recent one seen before a usage record is its model.
 */
function codexModelFromLine(line: CodexLine): string | undefined {
    if (line.type !== 'event_msg' || line.payload?.type !== 'thread_settings_applied') { return undefined; }
    const settings = line.payload.thread_settings;
    if (typeof settings !== 'object' || settings === null) { return undefined; }
    const model = (settings as Record<string, unknown>).model;
    return typeof model === 'string' ? model : undefined;
}

/** one `token_usage_record` line's own (non-cumulative) `payload.usage`, priced against whichever model was last named by a `thread_settings_applied` line */
function codexApiCallFromTokenUsageRecord(line: CodexLine, current_model: string | undefined): AgentApiCall | undefined {
    if (line.type !== 'token_usage_record' || !line.payload || !line.timestamp) { return undefined; }
    const usage = line.payload.usage;
    if (typeof usage !== 'object' || usage === null) { return undefined; }
    const fields = usage as CodexUsageFields;
    if (fields.input_tokens === undefined && fields.output_tokens === undefined) { return undefined; }
    return {
        model_id: current_model ?? 'unknown',
        at: line.timestamp,
        // OpenAI bills a reasoning token at the output rate, and AgentApiCall has no separate slot for it, so it is folded into output_tokens exactly as grokops.ts folds Grok's own reasoning tokens
        input_tokens: fields.input_tokens ?? 0,
        output_tokens: (fields.output_tokens ?? 0) + (fields.reasoning_output_tokens ?? 0),
        cache_read_tokens: fields.cached_input_tokens ?? 0,
        cache_write_tokens: fields.cache_write_input_tokens ?? 0,
    };
}

// a tool call as this reader best-effort extracts it from a response_item line; `content` is the call's own body - the current CLI's custom_tool_call `payload.input` verbatim (a JS exec snippet, or an apply_patch patch body), or the older function_call shape's decoded `.cmd`/`.command`
interface CodexToolCall {
    at: string;
    tool: string;
    content?: string;
    arg?: string;
}

/** the older `function_call` shape's `payload.arguments`: a JSON-encoded object carrying the shell command under `cmd` or `command`, decoded rather than used as a raw string */
function codexCommandFromJsonArguments(raw_arguments: string): string | undefined {
    try {
        const decoded: unknown = JSON.parse(raw_arguments);
        if (typeof decoded !== 'object' || decoded === null) { return undefined; }
        const cmd = (decoded as Record<string, unknown>).cmd ?? (decoded as Record<string, unknown>).command;
        if (typeof cmd === 'string') { return cmd; }
        if (Array.isArray(cmd)) { return cmd.filter((part) => typeof part === 'string').join(' '); }
        return undefined;
    } catch {
        // an older rollout still writing a bare command string rather than JSON-encoded arguments
        return raw_arguments;
    }
}

/**
 * A tool call as a response_item line, in either shape (module header): the current CLI's
 * `custom_tool_call` (`payload.name`/`payload.input`), or the older `function_call`
 * (`payload.name`/`payload.arguments` as JSON, or `payload.command`).
 */
function codexToolCallFromLine(line: CodexLine): CodexToolCall | undefined {
    if (line.type !== 'response_item') { return undefined; }
    if (!line.payload || !line.timestamp) { return undefined; }
    const payload_type = line.payload.type;
    if (payload_type === 'custom_tool_call') {
        const name = typeof line.payload.name === 'string' ? line.payload.name : 'unknown';
        const content = typeof line.payload.input === 'string' ? line.payload.input : undefined;
        return { at: line.timestamp, tool: name, content, arg: content?.slice(0, ACTIVITY_ARG_MAX_CHARS) };
    }
    if (payload_type !== 'function_call' && payload_type !== 'tool_call' && payload_type !== 'local_shell_call') { return undefined; }
    const name = typeof line.payload.name === 'string' ? line.payload.name : payload_type;
    let content: string | undefined;
    const raw_command = line.payload.command;
    if (typeof raw_command === 'string') { content = raw_command; } else if (Array.isArray(raw_command)) { content = raw_command.filter((part) => typeof part === 'string').join(' '); }
    if (!content && typeof line.payload.arguments === 'string') { content = codexCommandFromJsonArguments(line.payload.arguments); }
    if (!content && typeof line.payload.input === 'string') { content = line.payload.input; }
    return { at: line.timestamp, tool: name, content, arg: content ? content.slice(0, ACTIVITY_ARG_MAX_CHARS) : undefined };
}

/** true for a response_item line whose payload.type is message or agent_message, so the walk can reset its tool-call/idle tracking on a conversational turn without carrying the turn's own text */
function isCodexMessageLine(line: CodexLine): boolean {
    if (line.type !== 'response_item') { return false; }
    if (!line.payload || !line.timestamp) { return false; }
    return line.payload.type === 'message' || line.payload.type === 'agent_message';
}

// bounds one apply_patch hunk's text to the shared carry limit, the same bound claudecodeops.ts applies to a Claude Code edit
function boundedSnippet(text: string): string {
    return text.length > AGENT_EDIT_SNIPPET_MAX_CHARS ? text.slice(0, AGENT_EDIT_SNIPPET_MAX_CHARS) : text;
}

// one file apply_patch's body names, and what happened to it
interface ApplyPatchFileChange {
    file_path: string;
    whole_file: boolean;
    edits: AgentToolInvocationEdit[];
}

// matches "*** Add File: <path>", "*** Update File: <path>" and "*** Delete File: <path>", the three change headers apply_patch's own format documents
const APPLY_PATCH_FILE_HEADER = /^\*\*\* (Add File|Update File|Delete File): (.+)$/;

/**
 * Parses an apply_patch call's own patch body into one entry per file it names. An "Update File"
 * section's `+`/`-` lines are grouped into one edit per
 * `@@` hunk, so a MultiEdit-shaped call (several hunks touching different parts of one file) resolves
 * the same way MultiEdit's own `edits` array does. An "Add File" section carries the whole new file as
 * `+` lines and is marked `whole_file` rather than read as located edits, matching a Write. A "Delete
 * File" section carries no content to locate a section by, so it is carried with no edits at all - an
 * honest gap rather than a guess.
 */
function parseApplyPatchBody(body: string): ApplyPatchFileChange[] {
    const changes: ApplyPatchFileChange[] = [];
    let current: ApplyPatchFileChange | undefined;
    let hunk_new: string[] = [];
    let hunk_old: string[] = [];
    const flushHunk = (): void => {
        if (current && !current.whole_file && (hunk_new.length > 0 || hunk_old.length > 0)) {
            current.edits.push({
                new_text: hunk_new.length > 0 ? boundedSnippet(hunk_new.join('\n')) : undefined,
                old_text: hunk_old.length > 0 ? boundedSnippet(hunk_old.join('\n')) : undefined,
            });
        }
        hunk_new = [];
        hunk_old = [];
    };
    for (const line of body.split('\n')) {
        const header = APPLY_PATCH_FILE_HEADER.exec(line);
        if (header) {
            flushHunk();
            current = { file_path: header[2].trim(), whole_file: header[1] === 'Add File', edits: [] };
            changes.push(current);
            continue;
        }
        if (line.startsWith('*** ')) { flushHunk(); continue; }
        if (!current) { continue; }
        if (line.startsWith('@@')) { flushHunk(); continue; }
        if (current.whole_file) { continue; }
        if (line.startsWith('+')) { hunk_new.push(line.slice(1)); } else if (line.startsWith('-')) { hunk_old.push(line.slice(1)); }
        // a context line (leading space) is neither added nor removed, so it contributes to neither side of the hunk
    }
    flushHunk();
    return changes;
}

/** every invocation one tool call is worth attributing to this session: a git commit, or one entry per file an apply_patch call named, or (best-effort) one shell-shaped file write */
function codexToolInvocationsFor(call: CodexToolCall): AgentToolInvocation[] {
    if (call.tool === 'apply_patch' && call.content !== undefined) {
        return parseApplyPatchBody(call.content).map((change) => ({
            at: call.at,
            file_path: change.file_path,
            whole_file: change.whole_file || undefined,
            edits: change.edits.length > 0 ? change.edits : undefined,
        }));
    }
    const command = call.content;
    const is_commit = command?.includes('git commit') ?? false;
    if (is_commit) {
        const subject_match = command?.match(/-m\s+"([^"]+)"/) ?? command?.match(/-m\s+'([^']+)'/);
        return [{ at: call.at, is_commit: true, commit_subject: subject_match?.[1] }];
    }
    // best-effort: a shell-shaped redirect or an apply_patch invoked as a literal command string rather than its own custom_tool_call (an older CLI shape not confirmed against a real rollout, so no edit content is extracted from it, only its target path)
    if (!command || (!command.includes('>') && !command.includes('apply_patch'))) { return []; }
    const redirect_match = command.match(/>>?\s*([^\s|&;]+)/);
    const patch_match = command.match(/apply_patch\s+([^\s|&;]+)/);
    const file_path = redirect_match?.[1] ?? patch_match?.[1];
    return file_path ? [{ at: call.at, file_path }] : [];
}

/**
 * Everything one pass over the in-window lines produces, before it is folded into an AgentSessionResult.
 * - latest_model_overall: the last thread_settings_applied model seen across the WHOLE file, regardless
 *   of window, since the session's current model outlives whatever window happens to be open
 * - latest_tool_call: the most recent in-window tool call, so `current` can draw its live line without
 *   keeping every call seen
 */
interface CodexWalkResult {
    latest_model_overall?: string;
    calls: AgentApiCall[];
    tool_invocations: AgentToolInvocation[];
    latest_tool_call?: CodexToolCall;
    latest_in_window_is_tool_call: boolean;
}

/**
 * Walks a rollout's decoded lines once, in write order, sorting each in-window line into a call, a
 * tool call or a message; an out-of-window or unrecognised line is skipped rather than rejected. The
 * model in effect is tracked across the whole file regardless of window, since a `thread_settings_applied`
 * line well before the window can still be the model an in-window usage record was billed against.
 */
function walkCodexLines(lines: CodexLine[], window_start_ms: number, now_ms: number): CodexWalkResult {
    const result: CodexWalkResult = { calls: [], tool_invocations: [], latest_in_window_is_tool_call: false };
    let current_model: string | undefined;
    for (const line of lines) {
        if (line.type === 'session_meta') {
            // the caller already derived session_id and cwd from the filename, which is authoritative; session_meta carries nothing else this reader uses
            continue;
        }
        const model = codexModelFromLine(line);
        if (model) { current_model = model; result.latest_model_overall = model; }
        if (!codexLineInWindow(line, window_start_ms, now_ms)) { continue; }
        const api_call = codexApiCallFromTokenUsageRecord(line, current_model);
        if (api_call) {
            result.calls.push(api_call);
            result.latest_in_window_is_tool_call = false;
            continue;
        }
        const tool_call = codexToolCallFromLine(line);
        if (tool_call) {
            result.latest_tool_call = tool_call;
            result.tool_invocations.push(...codexToolInvocationsFor(tool_call));
            result.latest_in_window_is_tool_call = true;
            continue;
        }
        if (isCodexMessageLine(line)) {
            result.latest_in_window_is_tool_call = false;
        }

        // an unrecognised or unhandled line type is skipped, not rejected: a transcript may contain line kinds this reader does not yet know
    }
    return result;
}

/**
 * Parses a rollout's text and checks it against the two whole-file refusal conditions (too_large,
 * invalid_shape). Exported so `AgentAnalyserWorker.ts` can run it once against a session's current
 * full bytes (first sight, a shrunk or rewritten file, or a session re-read after a worker restart)
 * and reuse the very same `lines` both to build the session's result and to seed the incremental
 * cache, rather than parsing the same text twice.
 */
export function parseCodexTranscript(text: string): { lines: CodexLine[]; refusal?: AgentReadRefusal } {
    const byte_length = new TextEncoder().encode(text).length;
    if (byte_length > AGENT_TRANSCRIPT_MAX_BYTES) {
        return { lines: [], refusal: { code: 'too_large', reason: `transcript is ${byte_length} bytes, over the ${AGENT_TRANSCRIPT_MAX_BYTES} byte limit` } };
    }
    const parsed = parseCodexLines(text);
    if (!parsed) {
        return { lines: [], refusal: { code: 'invalid_shape', reason: 'transcript has no parseable JSONL lines' } };
    }
    return { lines: parsed.lines };
}

/**
 * Builds one session's result from its already-parsed lines. Pure and independent of how `lines` was
 * assembled, so the same function serves a whole-file read (`readCodexSession` below) and a resumed
 * one (`AgentAnalyserWorker.ts`, which appends only the newly tail-parsed lines to a cached array
 * before calling this): there is exactly one code path building a result from lines, whether the
 * caller supplies a fresh parse or a resumed tail.
 */
export function buildCodexResult(input: AgentSessionInput, lines: CodexLine[]): AgentSessionResult {
    const session_id = input.session_id;
    const cwd = input.cwd;
    const walked = walkCodexLines(lines, input.window_start_ms, input.now_ms);
    const state = input.vendor_live === false ? 'ended' : input.vendor_live === true ? (walked.latest_in_window_is_tool_call ? 'working' : 'idle') : 'unknown';
    // a session that is not live has nothing happening right now, whatever its transcript last recorded
    let current: ActivityEventBody | undefined;
    if (input.vendor_live !== false && walked.latest_tool_call) {
        current = { at: walked.latest_tool_call.at, kind: 'tool_call', tool: walked.latest_tool_call.tool, arg: walked.latest_tool_call.arg };
    }
    const started_at = lines.find((line) => line.timestamp)?.timestamp ?? new Date(input.now_ms).toISOString();
    const last_line_with_timestamp = [...lines].reverse().find((line) => line.timestamp);
    const updated_at = last_line_with_timestamp?.timestamp ?? started_at;
    return {
        session_id,
        cwd,
        state,
        started_at,
        updated_at,
        ended_at: input.vendor_live === false ? updated_at : undefined,
        current,
        model: walked.latest_model_overall,
        // Codex records no permission-request signal, so question stays undefined rather than a guessed value
        calls: walked.calls,
        tool_invocations: walked.tool_invocations,
    };
}

/**
 * Reads one Codex rollout transcript. Pure and synchronous: no `vscode`, no `fs`, so it runs unchanged
 * inside the analyser's nested web worker and in a plain Jest test.
 */
export function readCodexSession(input: AgentSessionInput): AgentSessionResult {
    const { lines, refusal } = parseCodexTranscript(input.transcript.text);
    if (refusal) { return emptyCodexResult(input, refusal); }
    return buildCodexResult(input, lines);
}

function emptyCodexResult(input: AgentSessionInput, refusal: AgentReadRefusal): AgentSessionResult {
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

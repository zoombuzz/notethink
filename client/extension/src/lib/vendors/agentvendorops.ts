import {
    ACTIVITY_VENDOR_CLAUDE_CODE,
    ACTIVITY_VENDOR_CODEX,
    ACTIVITY_VENDOR_GROK,
    type ActivityCapabilities,
    type ActivityEventBody,
    type ActivityQuestion,
    type ActivityState,
} from '../../types/AgentActivity';

/**
 * The shape every vendor reader (`claudecodeops.ts`, `codexops.ts`, `grokops.ts`) produces, and the
 * capability table describing what each vendor can honestly report. A reader is a pure function over
 * decoded file text: it does no I/O, so `AgentAnalyserWorker.ts` and the readers themselves stay
 * testable without a filesystem or a vscode mock.
 *
 * A reader answers three questions a caller downstream cannot: what is this session doing right now
 * (`current`, `question`, `state`), what did it spend (`calls`, priced later by `agentpricingops.ts`
 * because pricing needs a shared, vendor-agnostic table), and which files and commits are its own
 * doing (`tool_invocations`, joined later against a story's write calls and the git tree by
 * `agentstorybindingops.ts` and the analyser's git reader). None of the three questions can be
 * answered from the other two, which is why they are three separate fields rather than one blob.
 */

// a reader drops the transcript entirely if it exceeds this many UTF-8 bytes, refusing the session as too_large rather than parsing partway into a truncated line; held to half of AgentAnalyserWorker.ts's AGENT_TAIL_CACHE_MAX_BYTES so one oversized transcript can never claim most of the worker's retained cache on its own, and well under the parse time a whole read of even the largest transcripts on record needs to clear the worker's own timeout
export const AGENT_TRANSCRIPT_MAX_BYTES = 64 * 1024 * 1024;
// an edit snippet carried on AgentToolInvocation is bounded to this many characters: it exists only so the story binder can locate which board section a write call changed, never to reproduce the edit, and this content is host/worker-only and never crosses to the webview
export const AGENT_EDIT_SNIPPET_MAX_CHARS = 4000;

/** one file a reader was handed: its path, for refusal reporting, and its already-decoded text */
export interface AgentSourceFile {
    path: string;
    text: string;
}

/**
 * Everything one vendor session's reader needs: its own transcript, and whatever else that vendor's
 * layout supplies.
 * - vendor_live: the vendor's own live/not-live signal where it publishes one (Claude Code, Grok);
 *   undefined where a reader has to infer it from recency (Codex)
 * - window_start_ms: sessions older than this are not read at all; a reader still honours it against
 *   its own timestamps so a huge old transcript is never opened
 */
export interface AgentSessionInput {
    session_id: string;
    cwd: string;
    vendor_live?: boolean;
    transcript: AgentSourceFile;
    extra_files: AgentSourceFile[];
    now_ms: number;
    window_start_ms: number;
}

/**
 * One API call, priced later by `agentpricingops.ts`.
 * - span_start_at: the previous record's own timestamp, which is what a time-windowed rate
 *   (DeepSeek's peak hours) is measured against
 * - vendor_cost_usd: the vendor's own authoritative dollar figure for this call; the price table is
 *   never consulted when it is set, and no reader sets it today, since Grok's `costUsdTicks` has no
 *   confirmed unit
 */
export interface AgentApiCall {
    model_id: string;
    at: string;
    span_start_at?: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    vendor_cost_usd?: number;
}

/**
 * One located edit inside a write call: the replacement text a binder searches the board's current
 * text for, so it can name the enclosing story heading. `old_text` is a second, weaker locator only
 * consulted when `new_text` (whole, then line by line) is not found anywhere: the text an edit
 * replaced usually no longer exists once the edit has landed, but can still identify the section when
 * a later edit has since altered `new_text` beyond exact matching. Both are bounded to
 * `AGENT_EDIT_SNIPPET_MAX_CHARS`; this content is host/worker-only and never crosses to the webview.
 */
export interface AgentToolInvocationEdit {
    new_text?: string;
    old_text?: string;
}

/**
 * One thing a session's own tool use did, kept only for what a caller downstream needs to attribute
 * work to this session: a story bound by its own write calls, a git file credited by its own write
 * calls, a commit credited by its own `git commit` call. Every other tool call is folded into the
 * live line instead, which a reader builds itself.
 * - file_path: the file this call wrote or edited, resolved to a path relative to `cwd` when the
 *   reader can, absolute otherwise; a caller resolves it against the workspace itself
 * - edits: one entry per distinct edit this call made to `file_path` (a single `Edit`, or one per
 *   `MultiEdit` edit), used only to locate which board section changed; absent when the call carried
 *   no locatable content
 * - whole_file: true when this call replaced `file_path`'s entire content (a `Write`, or an
 *   `apply_patch` "Add File"), so it cannot be used to locate one story section and a story binder
 *   must treat it as binding nothing
 */
export interface AgentToolInvocation {
    at: string;
    file_path?: string;
    is_commit?: boolean;
    commit_subject?: string;
    edits?: AgentToolInvocationEdit[];
    whole_file?: boolean;
}

export const AGENT_REFUSAL_CODES = ['too_large', 'unreadable', 'unsupported_version', 'invalid_shape'] as const;
export type AgentRefusalCode = typeof AGENT_REFUSAL_CODES[number];

export interface AgentReadRefusal {
    code: AgentRefusalCode;
    reason: string;
}

/**
 * What one vendor reader made of one session: the session facts a card draws, and the raw material
 * two later passes turn into cost and story/file attribution.
 * - model: the model id in effect on this session's most recent record; undefined when nothing the
 *   reader saw named one
 */
export interface AgentSessionResult {
    session_id: string;
    cwd: string;
    state: ActivityState;
    started_at: string;
    updated_at: string;
    ended_at?: string;
    current?: ActivityEventBody;
    question?: ActivityQuestion;
    model?: string;
    calls: AgentApiCall[];
    tool_invocations: AgentToolInvocation[];
    refusal?: AgentReadRefusal;
}

/*
 * What each vendor can honestly report, keyed by the names ACTIVITY_SESSION_CAPABILITIES declares.
 * Collapsing "cannot report" and "reported nothing" is the one failure this table exists to prevent,
 * so a reader is never asked to guess a capability from what one session happens to contain: it is a
 * fact about the vendor, fixed here.
 */
const AGENT_VENDOR_CAPABILITIES: Record<string, ActivityCapabilities> = {
    [ACTIVITY_VENDOR_CLAUDE_CODE]: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
    [ACTIVITY_VENDOR_CODEX]: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
    // Grok's events.jsonl carries tool names but never their arguments (tool_started/tool_completed carry only tool_name, duration_ms and outcome), so the live line can name the tool and never a file it touched
    [ACTIVITY_VENDOR_GROK]: { live_tool_call: 'supported', question: 'supported', file_attribution: 'unsupported' },
};

/** the capability map for a known vendor; an unknown vendor reports nothing, honestly, rather than guessing */
export function capabilitiesForVendor(vendor: string): ActivityCapabilities {
    return AGENT_VENDOR_CAPABILITIES[vendor] ?? {};
}

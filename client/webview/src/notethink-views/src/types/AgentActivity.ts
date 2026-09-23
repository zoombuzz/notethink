/**
 * The agent activity snapshot: the shapes an in-extension analyser builds by reading local Claude
 * Code, Codex and Grok session files directly, so a card can draw which AI agents are working on a
 * story and what each one is doing.
 *
 * Mirrored at `client/extension/src/types/AgentActivity.ts`, because the extension
 * and the webview are separate webpack bundles with no shared module graph, so there is no import
 * path to one source. The two files are byte-identical apart from this header's cross-reference, and
 * the whole of both is the shared subset: the analyser builds the snapshot and the webview renders
 * it, so every name, string value and numeric bound here has to agree across the boundary.
 *
 * The analyser reads each vendor's own session files itself, inside the same extension host that
 * renders the card, so every path it emits is already workspace-relative.
 */

// state owns the card's colour; `unknown` is the honest value for a vendor that exposes no live status, and anything unrecognised coerces to it
export const ACTIVITY_STATES = ['working', 'waiting', 'idle', 'ended', 'unknown'] as const;
export type ActivityState = typeof ACTIVITY_STATES[number];
export const ACTIVITY_STATE_UNKNOWN: ActivityState = 'unknown';

// vendor is an open string so an unknown vendor draws a generic monogram rather than being dropped; these are the three this analyser reads
export const ACTIVITY_VENDOR_CLAUDE_CODE = 'claude-code';
export const ACTIVITY_VENDOR_CODEX = 'codex';
export const ACTIVITY_VENDOR_GROK = 'grok';
export const ACTIVITY_KNOWN_VENDORS = [ACTIVITY_VENDOR_CLAUDE_CODE, ACTIVITY_VENDOR_CODEX, ACTIVITY_VENDOR_GROK] as const;

// event kinds a reader renders; `kind` is an open string, so a kind outside this list is carried and ignored rather than rejected
export const ACTIVITY_EVENT_KINDS = ['tool_call', 'tool_result', 'message', 'question', 'answer', 'notice'] as const;

// a session is bound to a story the moment one of its own write calls changes that story's section; `none` covers every session that has not, including one still running
export const ACTIVITY_STORY_BINDINGS = ['bound', 'none'] as const;
export type ActivityStoryBinding = typeof ACTIVITY_STORY_BINDINGS[number];

export const ACTIVITY_CHANGE_KINDS = ['added', 'modified', 'deleted', 'renamed'] as const;
export type ActivityChangeKind = typeof ACTIVITY_CHANGE_KINDS[number];

/*
 * A capability counts as available only when it is declared 'supported': 'unsupported' and an
 * absent key alike mean the vendor cannot report it, so a reader says "not reported" rather than
 * showing an empty result. Silence never reads as "all quiet" - a blank question band on a Codex
 * session must not read as "not waiting on you". The analyser fills this from a per-vendor table
 * (`agentvendorops.ts`), never from a session's own claim.
 */
export const ACTIVITY_CAPABILITY_SUPPORTED = 'supported';
export const ACTIVITY_CAPABILITY_UNSUPPORTED = 'unsupported';
export type ActivityCapabilityState = typeof ACTIVITY_CAPABILITY_SUPPORTED | typeof ACTIVITY_CAPABILITY_UNSUPPORTED;
export type ActivityCapabilities = Record<string, ActivityCapabilityState>;

// capability names meaningful on a session; a reader ignores a name outside this list, so a later addition does not break an older build
export const ACTIVITY_SESSION_CAPABILITIES = ['live_tool_call', 'question', 'file_attribution'] as const;

// a producer obligation rather than a reader check: a reader truncates a long argument for display instead of dropping the session
export const ACTIVITY_ARG_MAX_CHARS = 200;

/**
 * ActivityStoryRef is the pair NoteThink joins activity to a card on. A story id is unique within a
 * file and not across a workspace, so neither half identifies a story on its own.
 * - doc_path: posix path of the markdown file holding the story, workspace-relative. The analyser
 *   resolves this itself from the session's own write calls
 * - id: the story's stable id - its authored `[](?id=slug)` linetag value where one exists, else the
 *   same slug `storyStableIdSlug`/its extension-side mirror derive from the stripped headline text,
 *   so an untagged story still binds under the same key its card joins on
 */
export interface ActivityStoryRef {
    doc_path: string;
    id: string;
}

/**
 * ActivityStoryUsage is the token and cost figures a session's own activity contributes to one story
 * it is bound to. A session bound to more than one story splits its usage across them (`AgentAnalyser`
 * > `toActivitySession` states exactly how, and the approximation it makes), so this is never simply
 * the session's own whole `usage` repeated per story.
 * - first_at: ISO 8601 UTC of the earliest priced call counted toward this story, so a card can state
 *   the span its figure covers; undefined when no priced call was credited to it
 */
export interface ActivityStoryUsage {
    story: ActivityStoryRef;
    usage: ActivityUsage;
    first_at?: string;
}

/**
 * ActivityEventBody is one thing an agent did, shared by an event log line and by the live line on
 * a session.
 * - at: ISO 8601 UTC, a display value rather than a key. Events are ordered by write order, never
 *   re-sorted by this
 * - kind: one of ACTIVITY_EVENT_KINDS, or a kind a reader does not know and carries unrendered
 * - arg: a short argument, bounded by ACTIVITY_ARG_MAX_CHARS and truncated for display beyond it
 */
export interface ActivityEventBody {
    at: string;
    kind: string;
    tool?: string;
    arg?: string;
}

/**
 * ActivityQuestion is a question pending on the operator.
 * - question_id: stable while the question is pending, so a reader can tell a re-ask from a repaint
 * - prompt: short, one line, plain text
 * - options: the choices offered, where the vendor exposes them
 */
export interface ActivityQuestion {
    question_id: string;
    asked_at: string;
    prompt: string;
    options?: string[];
}

/**
 * ActivityUsage is one session's token and cost figures over the analyser's 30 day window.
 * - cost_usd: undefined means unpriced, an unknown model shown with its tokens and no dollar figure,
 *   never another model's rate
 * - is_estimate: false only when the vendor supplied its own authoritative cost figure, which no
 *   reader does today (Grok's `costUsdTicks` has no confirmed unit, so it is never published); every
 *   price-table figure is an estimate, including a subscription session priced at API list rates
 */
export interface ActivityUsage {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd?: number;
    is_estimate: boolean;
}

export function emptyActivityUsage(): ActivityUsage {
    return { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
}

export function addActivityUsage(a: ActivityUsage, b: ActivityUsage): ActivityUsage {
    const cost_usd = a.cost_usd === undefined && b.cost_usd === undefined ? undefined : (a.cost_usd ?? 0) + (b.cost_usd ?? 0);
    return {
        input_tokens: a.input_tokens + b.input_tokens,
        output_tokens: a.output_tokens + b.output_tokens,
        cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
        cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
        cost_usd,
        is_estimate: a.is_estimate || b.is_estimate,
    };
}

/**
 * ActivitySession is one live or recent agent session: its binding, its state, and the live line a
 * card draws.
 * - vendor: an open string, one of ACTIVITY_KNOWN_VENDORS or a vendor a reader does not know
 * - project: the cwd's directory name, which drives the card's project colour on a virtual note, not
 *   the join to a story
 * - state: owns the card's colour; `question` present means `waiting`, and the two are not allowed
 *   to disagree; `waiting` may stand alone, as Claude Code's own session status reports it with no
 *   question text
 * - story_binding: `bound` or `none`; `bound` iff `stories` is non-empty
 * - stories: every story this session's own write calls changed the section of, in write order; a
 *   session's activity can draw on more than one card at once
 * - story_usage: this session's own `usage` split across `stories`, present exactly when
 *   `story_binding` is `bound`
 * - capabilities: keyed by the names in ACTIVITY_SESSION_CAPABILITIES; an absent key reads as
 *   unsupported
 * - current: the latest event, so the live line draws from one small value without reading the log
 * - model: the model id in effect on this session's most recent record, undefined when no record the
 *   reader saw named one (Claude Code: `message.model`; Codex: the last `thread_settings_applied`
 *   line; Grok: the last usage turn's own model key). Never inferred from a price-table lookup
 * - usage: this session's own total tokens and estimated cost over the analyser's 30 day window,
 *   independent of how many stories it is bound to
 */
export interface ActivitySession {
    // --- identity and binding ---
    session_id: string;
    vendor: string;
    project: string;
    story_binding: ActivityStoryBinding;
    stories?: ActivityStoryRef[];
    story_usage?: ActivityStoryUsage[];
    // --- lifetime ---
    started_at: string;
    updated_at: string;
    ended_at?: string;
    // --- what it is doing ---
    state: ActivityState;
    capabilities: ActivityCapabilities;
    current?: ActivityEventBody;
    question?: ActivityQuestion;
    model?: string;
    // --- cost ---
    usage: ActivityUsage;
}

/**
 * ActivityChangedFile is one file in the uncommitted band of one repository's working tree.
 * - path: posix path relative to the repository root, as git reports it
 * - previous_path: present exactly when change is `renamed`, relative to the repository root like
 *   `path`
 * - session_id: the session whose write calls account for this file. Absent means unattributed,
 *   which is the safe reading and so the one left to an absent field: a file with no matching write
 *   call is never credited to a guessed agent
 * - added, removed: line counts from a HEAD-vs-working-tree diff, an added file counting every line
 *   added and a deleted file every line removed. Both absent when the analyser has not computed them
 *   yet, or declined to (a binary file, or one over its own size cap) - never a guessed zero
 */
export interface ActivityChangedFile {
    path: string;
    change: ActivityChangeKind;
    previous_path?: string;
    session_id?: string;
    added?: number;
    removed?: number;
}

/**
 * ActivityCommit is one commit in the committed band, attributed to whichever session's own
 * `git commit` calls made it. Unlike the uncommitted band this lists commits rather than files: the
 * band answers "what did this agent ship", and a commit's own file list is a `git show` away for a
 * reader who wants it, not a second table this card has to keep current.
 */
export interface ActivityCommit {
    sha: string;
    subject: string;
    session_id?: string;
}

/**
 * ActivityTree is one repository's working tree as the analyser last read it via the built-in git
 * extension.
 * - uncommitted: changed in the working tree and not yet committed, credited to a session only by
 *   that session's own write calls
 * - committed: commits on this branch, credited to a session only by that session's own commit calls
 */
export interface ActivityTree {
    generated_at: string;
    branch: string;
    head_commit: string;
    uncommitted: ActivityChangedFile[];
    committed: ActivityCommit[];
}

// why a session's own files could not be read; a caller asserts and branches on the code and logs the reason
export const ACTIVITY_REJECT_CODES = ['too_large', 'unreadable', 'unsupported_version', 'invalid_shape'] as const;
export type ActivityRejectCode = typeof ACTIVITY_REJECT_CODES[number];

/**
 * ActivityParseFailure is a refusal a caller can log and act on.
 * - code: the machine-readable reason, so a test asserts the guarantee rather than a message string
 * - reason: a human-readable detail naming the field at fault, for the log line
 */
export interface ActivityParseFailure {
    ok: false;
    code: ActivityRejectCode;
    reason: string;
}

/**
 * ActivityParseSuccess carries the parsed value and anything the parser had to throw away.
 * - dropped: one short reason per dropped line or entry, absent when nothing was dropped. A log
 *   quietly one entry short reads exactly like a complete one, so the caller logs these
 */
export interface ActivityParseSuccess<T> {
    ok: true;
    value: T;
    dropped?: string[];
}

export type ActivityParseResult<T> = ActivityParseSuccess<T> | ActivityParseFailure;

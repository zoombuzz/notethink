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

// state owns the card's colour; `unknown` fits a vendor with no live status, and unrecognised values coerce to it
export const ACTIVITY_STATES = ['working', 'waiting', 'idle', 'ended', 'unknown'] as const;
export type ActivityState = typeof ACTIVITY_STATES[number];
export const ACTIVITY_STATE_UNKNOWN: ActivityState = 'unknown';

// vendor is open so an unknown one draws a generic monogram; the known list is the vendors read (antigravity: drawn only)
export const ACTIVITY_VENDOR_CLAUDE_CODE = 'claude-code';
export const ACTIVITY_VENDOR_CODEX = 'codex';
export const ACTIVITY_VENDOR_GROK = 'grok';
export const ACTIVITY_VENDOR_ANTIGRAVITY = 'antigravity';
export const ACTIVITY_KNOWN_VENDORS = [ACTIVITY_VENDOR_CLAUDE_CODE, ACTIVITY_VENDOR_CODEX, ACTIVITY_VENDOR_GROK] as const;

/**
 * ActivityVendorDisplay is how one vendor is drawn wherever a session is named.
 * - monogram: the two-character mark a card, a session row and a band draw
 * - label: the vendor's full name, as the chat panel titles it
 * - colour: a CSS colour expression from the editor's chart palette, with a literal fallback, so it follows the light and dark theme
 */
export interface ActivityVendorDisplay {
    monogram: string;
    label: string;
    colour: string;
}

// the one vendor display table; a vendor missing from it still draws, from its slug
export const ACTIVITY_VENDOR_DISPLAY: Readonly<Record<string, ActivityVendorDisplay>> = {
    [ACTIVITY_VENDOR_CLAUDE_CODE]: { monogram: 'CC', label: 'Claude Code', colour: 'var(--vscode-charts-purple, #b180d7)' },
    [ACTIVITY_VENDOR_CODEX]: { monogram: 'CO', label: 'Codex', colour: 'var(--vscode-charts-blue, #3794ff)' },
    [ACTIVITY_VENDOR_GROK]: { monogram: 'GR', label: 'Grok', colour: 'var(--vscode-charts-yellow, #d7ba7d)' },
    [ACTIVITY_VENDOR_ANTIGRAVITY]: { monogram: 'AG', label: 'Antigravity', colour: 'var(--vscode-charts-green, #89d185)' },
};

// event kinds a reader renders; `kind` is open, so an unlisted kind is carried and ignored rather than rejected
export const ACTIVITY_EVENT_KINDS = ['tool_call', 'tool_result', 'message', 'question', 'answer', 'notice'] as const;

// a session binds to a story once its writes change that story's section; `none` covers one that has not
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

// capability names meaningful on a session; an unlisted name is ignored, so a later addition can't break an older build
export const ACTIVITY_SESSION_CAPABILITIES = ['live_tool_call', 'question', 'file_attribution'] as const;

// a producer obligation, not a reader check: a reader truncates a long argument rather than dropping the session
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
 * - last_at: ISO 8601 UTC of the latest write call that changed this story, so a group of cards can
 *   be ordered by when an agent last wrote to each story rather than by its session's whole span;
 *   undefined when no write call carried a parseable time
 */
export interface ActivityStoryUsage {
    story: ActivityStoryRef;
    usage: ActivityUsage;
    first_at?: string;
    last_at?: string;
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

// a session keeps every running child and only this many finished ones, the most recent, so the snapshot stays bounded
export const ACTIVITY_CHILDREN_MAX_FINISHED = 6;

/**
 * ActivityChildSession is one subagent a session launched, drawn as an indented row under its parent.
 * Every field but its id and times is optional, because a vendor's own record of a subagent varies.
 * - child_id: the subagent's own id, unique within its parent
 * - title: the short description the parent gave the subagent, which usually names the work
 * - agent_type: the kind of subagent the parent launched, such as `Explore`
 * - model: the model id seen on the subagent's own latest record, else the one its launch record named
 * - state: `working` while it runs and `ended` once finished; never `waiting`, which a subagent cannot report
 * - usage: the subagent's own tokens and estimated cost, which the parent's `usage` already includes
 */
export interface ActivityChildSession {
    child_id: string;
    title?: string;
    agent_type?: string;
    model?: string;
    state: ActivityState;
    started_at: string;
    updated_at: string;
    ended_at?: string;
    active_ms?: number;
    current?: ActivityEventBody;
    usage: ActivityUsage;
}

/**
 * ActivitySession is one live or recent agent session: its binding, its state, and the live line a
 * card draws.
 * - vendor: an open string, one of ACTIVITY_KNOWN_VENDORS or a vendor a reader does not know
 * - project: the cwd's directory name, which drives the card's project colour on a virtual note, not
 *   the join to a story
 * - session_name: the name the vendor itself gives the session (Claude Code's own `name` in its live
 *   session file), undefined when the vendor names none or the session is not live
 * - registry_name: the agent's name from the agent registry, the fallback when the vendor names
 *   none; set when a registry entry joins this session, and the name of a registry-only row
 * - registry_only: true for a row built from a registry entry alone, because no vendor session
 *   NoteThink can read matches it; it has no transcript to open, no usage and no live line
 * - registry_stale: true when the registry still says `working` but nothing since its last update
 *   shows work, so a row reads stale rather than working
 * - registry_story: the story id the registry entry names, shown on a registry-only row; a joined
 *   or registry-only session also takes it as its story binding when that story is in flight
 * - tail_read: true when the transcript was over the size bound, so this session's usage, active time
 *   and start cover only its newest part; absent otherwise
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
 * - active_ms: the sum of the gaps between consecutive events, leaving out any gap over five
 *   minutes entirely, over the session's whole lifetime regardless of window; undefined on a
 *   refusal, since no record was read to measure gaps between. The agent card's clock setting reads
 *   this for its "active" mode; `started_at`/`updated_at` alone drive the other two modes
 * - children: the subagents this session launched, oldest first, capped at every running one plus
 *   the latest ACTIVITY_CHILDREN_MAX_FINISHED finished ones; absent for a vendor with no subagents
 * - children_omitted: how many finished subagents the cap left out, absent when none; the parent's
 *   `usage` and `active_ms` still include them
 */
export interface ActivitySession {
    // --- identity and binding ---
    session_id: string;
    vendor: string;
    project: string;
    session_name?: string;
    registry_name?: string;
    registry_only?: boolean;
    registry_stale?: boolean;
    registry_story?: string;
    story_binding: ActivityStoryBinding;
    stories?: ActivityStoryRef[];
    story_usage?: ActivityStoryUsage[];
    // --- lifetime ---
    started_at: string;
    updated_at: string;
    ended_at?: string;
    active_ms?: number;
    tail_read?: boolean;
    // --- what it is doing ---
    state: ActivityState;
    capabilities: ActivityCapabilities;
    current?: ActivityEventBody;
    question?: ActivityQuestion;
    model?: string;
    // --- cost ---
    usage: ActivityUsage;
    // --- subagents ---
    children?: ActivityChildSession[];
    children_omitted?: number;
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
 * - pending_commits: local commits not yet pushed, the branch's ahead count against its upstream; undefined when the branch has no upstream
 */
export interface ActivityTree {
    generated_at: string;
    branch: string;
    head_commit: string;
    uncommitted: ActivityChangedFile[];
    committed: ActivityCommit[];
    pending_commits?: number;
}

/**
 * ActivityStoryProgress is one story's rough percentage as a coordinator recorded it, read from the
 * coordinator's own progress file and carried so a card can draw a pie and time its column.
 * - root_relative: workspace-relative posix path of the repository the entry belongs to, empty when the repository IS a workspace folder; the story's document path is matched against it
 * - story_id: the story's `id=` linetag slug, which is the join key within that repository
 * - pct: whole percent, 0 to 100
 * - at: ISO 8601 UTC of when the entry was written
 * - by: who wrote it, `agent` or `coordinator`, carried as the writer spelled it
 * - note: a short free-text remark the writer attached
 */
export interface ActivityStoryProgress {
    root_relative: string;
    story_id: string;
    pct: number;
    at: string;
    by: string;
    note?: string;
}

// why a session's own files could not be read; a caller asserts and branches on the code and logs the reason
export const ACTIVITY_REJECT_CODES = ['unreadable', 'unsupported_version', 'invalid_shape'] as const;
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

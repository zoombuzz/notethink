/**
 * The agent activity contract: the shapes NoteThink reads out of a `.notethink/` directory
 * that an external producer writes, so a card can draw which AI agents are working on a
 * story and what each one is doing.
 *
 * ACTIVITY_CONTRACT.md at the repo root is the specification and is authoritative for every
 * figure and every permanent name in this file. Change one there first.
 *
 * Mirrored at `client/extension/src/types/AgentActivity.ts`, because the
 * extension and the webview are separate webpack bundles with no shared module graph, so
 * there is no import path to one source. The two files are byte-identical apart from this
 * header's cross-reference, and the whole of both is the shared subset: the extension parses
 * the contract and the webview renders it, so every name, string value and numeric bound here
 * has to agree across the boundary. Treat the pair as one contract, as `globMatch.ts` is
 * treated.
 */

// the contract version this build writes and reads; a file's own contract_version is checked against it
export const ACTIVITY_CONTRACT_VERSION = '1.0.0';
export const ACTIVITY_CONTRACT_MAJOR = 1;
export const ACTIVITY_CONTRACT_MINOR = 0;

// the contract directory, and the paths inside it, all relative to the repository root that holds it
export const ACTIVITY_DIR = '.notethink';
export const ACTIVITY_MANIFEST_FILE = 'manifest.json';
export const ACTIVITY_TREE_FILE = 'tree.json';
export const ACTIVITY_SESSIONS_DIR = 'sessions';
export const ACTIVITY_BLOBS_DIR = 'blobs';
export const ACTIVITY_SESSION_SUFFIX = '.session.json';
export const ACTIVITY_EVENTS_SUFFIX = '.events.jsonl';
export const ACTIVITY_DIGEST_SUFFIX = '.digest.json';

/*
 * The two workspace-relative globs a watcher registers. `blobs/` is deliberately outside both:
 * blobs are fetched on demand when a diff is opened, and a changed package.json's stored side
 * would otherwise fire the watcher on every write.
 */
export const ACTIVITY_ROOT_GLOB = `**/${ACTIVITY_DIR}/*.json`;
export const ACTIVITY_SESSIONS_GLOB = `**/${ACTIVITY_DIR}/${ACTIVITY_SESSIONS_DIR}/*`;

// a session id becomes a path segment, so the pattern is also what stops one walking out of the contract directory
export const ACTIVITY_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// vendor is an open string so an unknown vendor draws a generic monogram rather than being dropped; these are the three measured today
export const ACTIVITY_VENDOR_CLAUDE_CODE = 'claude-code';
export const ACTIVITY_VENDOR_CODEX = 'codex';
export const ACTIVITY_VENDOR_GROK = 'grok';
export const ACTIVITY_KNOWN_VENDORS = [ACTIVITY_VENDOR_CLAUDE_CODE, ACTIVITY_VENDOR_CODEX, ACTIVITY_VENDOR_GROK] as const;

// state owns the card's colour; `unknown` is the honest value for a vendor that exposes no live status, and anything unrecognised coerces to it
export const ACTIVITY_STATES = ['working', 'waiting', 'idle', 'ended', 'unknown'] as const;
export type ActivityState = typeof ACTIVITY_STATES[number];
export const ACTIVITY_STATE_UNKNOWN: ActivityState = 'unknown';

// event kinds a reader renders; `kind` is an open string, so a kind outside this list is carried and ignored rather than rejected
export const ACTIVITY_EVENT_KINDS = ['tool_call', 'tool_result', 'message', 'question', 'answer', 'notice'] as const;

/*
 * Three-valued because the agent declares its binding and nothing guesses one. `none` is a
 * declaration that the session is on no story; `undeclared` is nobody having declared anything,
 * which is a gap in the tooling rather than a fact about the agent. A nullable `story` object
 * would collapse the two the moment a serialiser dropped the null.
 */
export const ACTIVITY_STORY_BINDINGS = ['bound', 'none', 'undeclared'] as const;
export type ActivityStoryBinding = typeof ACTIVITY_STORY_BINDINGS[number];

export const ACTIVITY_CHANGE_KINDS = ['added', 'modified', 'deleted', 'renamed'] as const;
export type ActivityChangeKind = typeof ACTIVITY_CHANGE_KINDS[number];

// why a side of a diff exists but was not stored, as distinct from there being no such side at all
export const ACTIVITY_OMITTED_REASONS = ['size', 'binary'] as const;
export type ActivityOmittedReason = typeof ACTIVITY_OMITTED_REASONS[number];

/*
 * A capability counts as available only when it is declared 'supported': 'unsupported' and an
 * absent key alike mean the producer cannot report it, so a reader says "not reported" rather
 * than showing an empty result. Silence never reads as "all quiet", which is the whole reason
 * the map exists - a blank question band on a Codex session must not read as "not waiting on you".
 */
export const ACTIVITY_CAPABILITY_SUPPORTED = 'supported';
export const ACTIVITY_CAPABILITY_UNSUPPORTED = 'unsupported';
export type ActivityCapabilityState = typeof ACTIVITY_CAPABILITY_SUPPORTED | typeof ACTIVITY_CAPABILITY_UNSUPPORTED;
export type ActivityCapabilities = Record<string, ActivityCapabilityState>;

// capability names meaningful on the manifest, describing the producer rather than any one session
export const ACTIVITY_PRODUCER_CAPABILITIES = ['tree_state', 'blob_base'] as const;

// capability names meaningful on a session; a reader ignores a name outside this list, so a minor version can add one
export const ACTIVITY_SESSION_CAPABILITIES = ['live_tool_call', 'question', 'digest', 'file_attribution'] as const;

/*
 * Size bounds in UTF-8 bytes, enforced by the reader before it decodes a file. Every read is of
 * a whole file (the VS Code file-system API takes no offset and no length), and agent transcripts
 * run past 100 MB, which is why the contract is many small files and why each one is capped.
 */
export const ACTIVITY_MANIFEST_MAX_BYTES = 8 * 1024;
export const ACTIVITY_SESSION_MAX_BYTES = 16 * 1024;
export const ACTIVITY_EVENTS_MAX_BYTES = 64 * 1024;
export const ACTIVITY_DIGEST_MAX_BYTES = 64 * 1024;
export const ACTIVITY_TREE_MAX_BYTES = 256 * 1024;
export const ACTIVITY_BLOB_MAX_BYTES = 1024 * 1024;
export const ACTIVITY_EVENTS_MAX_LINES = 200;

// a producer obligation rather than a reader check: a reader truncates a long argument for display instead of refusing the session
export const ACTIVITY_ARG_MAX_CHARS = 200;

// the producer is live while its manifest was written within this many heartbeat intervals; beyond it the board says the producer stopped, never that agents are idle
export const ACTIVITY_STALE_HEARTBEATS = 3;

/**
 * ActivityProducer identifies what is writing the contract, so a reader can name it when it
 * explains where its data came from or that the writing has stopped.
 */
export interface ActivityProducer {
    name: string;
    version: string;
}

/**
 * ActivityManifest is the one file that answers "is anything writing here at all".
 * - written_at: when the manifest was last written, as an ISO 8601 UTC instant. The producer rewrites it every heartbeat_seconds whether or not anything changed, which is what lets a reader tell a stopped producer from a quiet one
 * - heartbeat_seconds: how often the producer promises to rewrite; a reader calls the producer stale past ACTIVITY_STALE_HEARTBEATS intervals
 * - capabilities: producer-wide capabilities, keyed by the names in ACTIVITY_PRODUCER_CAPABILITIES
 * - sessions: the session ids that are live now, and authoritative. A session file not listed here is ignored, so a crashed producer's leftovers are never drawn as live agents
 */
export interface ActivityManifest {
    contract_version: string;
    producer: ActivityProducer;
    written_at: string;
    heartbeat_seconds: number;
    capabilities: ActivityCapabilities;
    sessions: string[];
}

/**
 * ActivityStoryRef is the pair NoteThink joins activity to a card on. A story id is unique
 * within a file and not across a workspace, so neither half identifies a story on its own.
 * - doc_path: posix path of the markdown file holding the story, relative to the CONTRACT ROOT, the directory holding `.notethink/`. Never workspace-relative: a producer cannot know whether the repository was opened on its own, as one folder of a multi-root workspace, or nested below a parent folder, so the reader resolves this against wherever it found the contract directory
 * - id: the story's authored `[](?id=slug)` linetag value, never a title-derived implicit id. A binding is a cross-session reference by definition, and only the authored linetag is frozen against a rename
 */
export interface ActivityStoryRef {
    doc_path: string;
    id: string;
}

/**
 * ActivityEventBody is one thing an agent did, shared by an event log line and by the live
 * line on a session.
 * - at: ISO 8601 UTC, a display value rather than a key. Events are ordered by write order, never re-sorted by this
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
 * ActivityEvent is one line of `<session_id>.events.jsonl`. The version and session id repeat on
 * every line rather than sitting on a header line, so each line stays independently valid: a
 * half-written trailing line then costs that one line instead of the whole file.
 */
export interface ActivityEvent extends ActivityEventBody {
    contract_version: string;
    session_id: string;
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
 * ActivitySession is one live agent session: its binding, its state, and the live line a card draws.
 * - vendor: an open string, one of ACTIVITY_KNOWN_VENDORS or a vendor a reader does not know
 * - project: the name of the directory holding `.notethink/`, which is the repository root's name. It drives the card's project colour, not the join to a story
 * - state: owns the card's colour; `question` present means `waiting`, and the two are not allowed to disagree
 * - story_binding: `bound`, `none` or `undeclared`, and the only thing that decides which story a session is drawn on
 * - story: present exactly when story_binding is `bound`
 * - capabilities: keyed by the names in ACTIVITY_SESSION_CAPABILITIES; an absent key reads as unsupported
 * - current: the latest event, so the live line draws from one small file without reading the log at all
 */
export interface ActivitySession {
    // --- identity and binding ---
    contract_version: string;
    session_id: string;
    vendor: string;
    project: string;
    story_binding: ActivityStoryBinding;
    story?: ActivityStoryRef;
    // --- lifetime ---
    started_at: string;
    updated_at: string;
    ended_at?: string;
    // --- what it is doing ---
    state: ActivityState;
    capabilities: ActivityCapabilities;
    current?: ActivityEventBody;
    question?: ActivityQuestion;
}

export interface ActivityDigestMessage {
    at: string;
    role: string;
    text: string;
}

export interface ActivityDigestToolCall {
    at: string;
    tool: string;
    arg?: string;
    outcome?: string;
}

/**
 * ActivityDigestWindow is a bounded slice that says it is bounded.
 * - kept: how many entries `items` holds
 * - dropped: how many older entries were left out, 0 when the slice is the whole session. A bounded list that does not say so gives a partial answer looking like a complete one, so the drawer states its window from these two numbers
 * - items: oldest first
 */
export interface ActivityDigestWindow<T> {
    kept: number;
    dropped: number;
    items: T[];
}

/**
 * ActivityDigest is what the agent drawer shows: the last few messages and tool calls, small
 * enough to read whole.
 * - facts: free-form string pairs shown as session facts, rendered without the reader knowing the keys
 *
 * Every string reaching a reader through this contract is rendered as text, never as markdown
 * and never as HTML: the content comes from a transcript the reader did not author.
 */
export interface ActivityDigest {
    contract_version: string;
    session_id: string;
    generated_at: string;
    messages: ActivityDigestWindow<ActivityDigestMessage>;
    tool_calls: ActivityDigestWindow<ActivityDigestToolCall>;
    facts?: Record<string, string>;
}

/**
 * ActivityChangedFile is one file in one band of the working tree.
 * - path: posix path relative to the contract root, as git reports it, never workspace-relative
 * - previous_path: present exactly when change is `renamed`, and relative to the contract root like `path`
 * - session_id: the session whose write calls account for this file. Absent means unattributed, which is the safe reading and so the one left to an absent field; a file with no matching write call is never credited to a guessed agent
 * - base_blob: path of the left-hand side of the diff, relative to the CONTRACT DIRECTORY (`.notethink/` itself) rather than the contract root; absent when there is no left-hand side, which is what `added` means
 * - head_blob: path of the right-hand side, on the same base as base_blob, present only when the right-hand side is not the file in the workspace. An uncommitted entry omits it; a committed entry supplies it, because the working file may carry further edits on top of the commit
 * - omitted: a side exists and the producer did not store it, as distinct from there being no such side. A reader then says the diff is unavailable rather than showing an empty pane
 */
export interface ActivityChangedFile {
    path: string;
    change: ActivityChangeKind;
    previous_path?: string;
    session_id?: string;
    base_blob?: string;
    head_blob?: string;
    omitted?: ActivityOmittedReason;
}

/**
 * ActivityTree is the working tree in two bands, written by the producer because a reader cannot
 * run git: NoteThink is a web extension with no child processes, and the built-in git extension
 * runs in an extension host it cannot reach.
 * - base_ref: what the committed band is measured against, such as a remote default branch
 * - uncommitted: changed in the working tree and not yet committed
 * - committed: changed by commits on this branch since base_ref
 */
export interface ActivityTree {
    contract_version: string;
    generated_at: string;
    branch: string;
    head_commit: string;
    base_ref?: string;
    uncommitted: ActivityChangedFile[];
    committed: ActivityChangedFile[];
}

// why a file was refused; a caller asserts and branches on the code and logs the reason
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
 * - dropped: one short reason per dropped line or entry, absent when nothing was dropped. A log quietly one entry short reads exactly like a complete one, so the caller logs these
 */
export interface ActivityParseSuccess<T> {
    ok: true;
    value: T;
    dropped?: string[];
}

export type ActivityParseResult<T> = ActivityParseSuccess<T> | ActivityParseFailure;

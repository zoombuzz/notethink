import {
    ACTIVITY_BLOBS_DIR,
    ACTIVITY_CAPABILITY_SUPPORTED,
    ACTIVITY_CAPABILITY_UNSUPPORTED,
    ACTIVITY_CHANGE_KINDS,
    ACTIVITY_CONTRACT_MAJOR,
    ACTIVITY_DIGEST_MAX_BYTES,
    ACTIVITY_DIGEST_SUFFIX,
    ACTIVITY_DIR,
    ACTIVITY_EVENTS_MAX_BYTES,
    ACTIVITY_EVENTS_MAX_LINES,
    ACTIVITY_EVENTS_SUFFIX,
    ACTIVITY_MANIFEST_FILE,
    ACTIVITY_MANIFEST_MAX_BYTES,
    ACTIVITY_OMITTED_REASONS,
    ACTIVITY_SESSION_ID_PATTERN,
    ACTIVITY_SESSION_MAX_BYTES,
    ACTIVITY_SESSION_SUFFIX,
    ACTIVITY_STALE_HEARTBEATS,
    ACTIVITY_STATES,
    ACTIVITY_STATE_UNKNOWN,
    ACTIVITY_STORY_BINDINGS,
    ACTIVITY_TREE_FILE,
    ACTIVITY_TREE_MAX_BYTES,
    type ActivityCapabilities,
    type ActivityChangeKind,
    type ActivityChangedFile,
    type ActivityDigest,
    type ActivityDigestMessage,
    type ActivityDigestToolCall,
    type ActivityDigestWindow,
    type ActivityEvent,
    type ActivityEventBody,
    type ActivityManifest,
    type ActivityOmittedReason,
    type ActivityParseFailure,
    type ActivityParseResult,
    type ActivityQuestion,
    type ActivityRejectCode,
    type ActivitySession,
    type ActivityState,
    type ActivityStoryBinding,
    type ActivityStoryRef,
    type ActivityTree,
} from '../types/AgentActivity';

/**
 * Parse and validate the agent activity contract NoteThink reads out of a `.notethink/`
 * directory. ACTIVITY_CONTRACT.md at the repo root is the specification.
 *
 * Every entry point takes a contract file's whole text and returns either the parsed value or a
 * refusal carrying a code and a reason, so a malformed or truncated file is rejected rather than
 * half-read. Truncation is the normal failure here, not an exceptional one: a producer writes
 * while the host reads. A caller logs the refusal and keeps the value it read last:
 *
 *     const parsed = parseActivitySession(text);
 *     if (!parsed.ok) { writeToErrorLog('<callerName>', `${path} refused: ${parsed.code} ${parsed.reason}`); return; }
 *
 * These functions are pure so they stay unit-testable; logging belongs to the watcher that calls
 * them, under its own log source.
 *
 * Two shapes drop rather than refuse, and both report what they dropped so a caller can log it:
 * an events file drops a single unparseable line (which is what a half-written append looks like,
 * and the reason the log is newline-delimited rather than a JSON array), and the working tree
 * drops an individual malformed entry. Anything quietly one entry short reads exactly like
 * something complete, so `dropped` is never swallowed.
 *
 * The size bounds are on UTF-8 bytes and a reader checks them before decoding; the check here is
 * against the decoded length, which for UTF-8 can only be smaller and so never admits a file the
 * byte check would have refused.
 */

type JsonRecord = Record<string, unknown>;

interface DecodedContractFile {
    record: JsonRecord;
    contract_version: string;
}

interface StoryBindingFields {
    story_binding: ActivityStoryBinding;
    story?: ActivityStoryRef;
}

const CONTRACT_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function refuse(code: ActivityRejectCode, reason: string): ActivityParseFailure {
    return {ok: false, code, reason};
}

function isParseFailure(value: object): value is ActivityParseFailure {
    return 'ok' in value && (value as {ok: unknown}).ok === false;
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

/** an ISO 8601 instant, as every timestamp in the contract is; rejects an epoch number written where a string belongs */
function isInstant(value: unknown): value is string {
    return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSafeSessionId(value: unknown): value is string {
    return isNonEmptyString(value) && ACTIVITY_SESSION_ID_PATTERN.test(value);
}

/**
 * Keep the capability declarations the contract recognises, discarding anything else. A key held
 * as 'supported' is the ONLY thing that means the producer can report that capability;
 * 'unsupported' and an absent key alike mean it cannot, which is why an unrecognised value is
 * discarded rather than carried: silence must never read as "all quiet".
 */
function readCapabilities(value: unknown): ActivityCapabilities {
    const capabilities: ActivityCapabilities = {};
    if (!isRecord(value)) { return capabilities; }
    for (const [name, state] of Object.entries(value)) {
        if (state === ACTIVITY_CAPABILITY_SUPPORTED || state === ACTIVITY_CAPABILITY_UNSUPPORTED) { capabilities[name] = state; }
    }
    return capabilities;
}

/** true only for a capability declared 'supported'; every other answer means the producer cannot report it */
export function hasActivityCapability(capabilities: ActivityCapabilities | undefined, name: string): boolean {
    return capabilities?.[name] === ACTIVITY_CAPABILITY_SUPPORTED;
}

/**
 * A different MAJOR is refused and named, rather than read on a guess: a board that silently
 * drops a file it cannot read looks exactly like a board with nothing happening on it. A MINOR
 * above this build's is read as it stands, because a minor bump is backward-compatible by
 * definition and its unknown fields are simply ignored.
 */
function checkContractVersion(value: unknown): ActivityParseFailure | undefined {
    if (!isNonEmptyString(value)) { return refuse('invalid_shape', 'contract_version is missing'); }
    const match = CONTRACT_VERSION_PATTERN.exec(value);
    if (!match) { return refuse('invalid_shape', `contract_version ${value} is not MAJOR.MINOR.PATCH`); }
    if (Number(match[1]) !== ACTIVITY_CONTRACT_MAJOR) { return refuse('unsupported_version', `producer writes contract version ${value}, this build reads version ${ACTIVITY_CONTRACT_MAJOR}`); }
    return undefined;
}

/**
 * Size, JSON and contract-version checks, in the order that keeps a big file cheap: the bound is
 * tested before the text is parsed at all.
 */
function decodeContractFile(text: string, max_bytes: number): DecodedContractFile | ActivityParseFailure {
    if (text.length > max_bytes) { return refuse('too_large', `file is ${text.length} characters, over the ${max_bytes} byte bound`); }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return refuse('unreadable', 'not valid JSON, which is what a file read mid-write looks like');
    }
    if (!isRecord(parsed)) { return refuse('invalid_shape', 'the file is not a JSON object'); }
    const contract_version = parsed.contract_version;
    const rejected = checkContractVersion(contract_version);
    if (rejected) { return rejected; }
    return {record: parsed, contract_version: contract_version as string};
}

/**
 * A blob reference is relative to the contract directory and confined to `blobs/`, the one base in
 * the contract that is not the contract root. The reference is turned into a file URI, so an
 * unchecked one walks out of the contract directory and opens whatever it names.
 */
export function isActivityBlobPath(path: unknown): path is string {
    if (!isNonEmptyString(path) || path.includes('\\')) { return false; }
    const segments = path.split('/');
    if (segments[0] !== ACTIVITY_BLOBS_DIR || segments.length < 2) { return false; }
    return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** which contract file a name is, so a watcher can route one event without re-deriving the suffixes */
export function activityFileKindFromFileName(file_name: string): 'manifest' | 'tree' | 'session' | 'events' | 'digest' | undefined {
    if (file_name === ACTIVITY_MANIFEST_FILE) { return 'manifest'; }
    if (file_name === ACTIVITY_TREE_FILE) { return 'tree'; }
    if (file_name.endsWith(ACTIVITY_SESSION_SUFFIX)) { return 'session'; }
    if (file_name.endsWith(ACTIVITY_EVENTS_SUFFIX)) { return 'events'; }
    if (file_name.endsWith(ACTIVITY_DIGEST_SUFFIX)) { return 'digest'; }
    return undefined;
}

/**
 * The session id a per-session file name carries, or undefined when the name is not one of the
 * three or the id would not be a safe path segment.
 */
export function activitySessionIdFromFileName(file_name: string): string | undefined {
    const suffix = [ACTIVITY_SESSION_SUFFIX, ACTIVITY_EVENTS_SUFFIX, ACTIVITY_DIGEST_SUFFIX].find((candidate) => file_name.endsWith(candidate));
    if (!suffix) { return undefined; }
    const session_id = file_name.slice(0, file_name.length - suffix.length);
    return isSafeSessionId(session_id) ? session_id : undefined;
}

/**
 * The producer is live while its manifest was written within ACTIVITY_STALE_HEARTBEATS of its
 * declared interval. Beyond that the board says the producer stopped writing, never that the
 * agents are idle. A clock ahead of the reader's counts as live; both clocks are local to the
 * machine the workspace is on.
 */
export function isActivityProducerLive(manifest: ActivityManifest, now_ms: number): boolean {
    const written_ms = Date.parse(manifest.written_at);
    if (Number.isNaN(written_ms)) { return false; }
    return now_ms - written_ms <= manifest.heartbeat_seconds * 1000 * ACTIVITY_STALE_HEARTBEATS;
}

export function parseActivityManifest(text: string): ActivityParseResult<ActivityManifest> {
    const decoded = decodeContractFile(text, ACTIVITY_MANIFEST_MAX_BYTES);
    if (isParseFailure(decoded)) { return decoded; }
    const {producer, written_at, heartbeat_seconds, sessions} = decoded.record;
    if (!isRecord(producer) || !isNonEmptyString(producer.name) || !isNonEmptyString(producer.version)) { return refuse('invalid_shape', 'producer needs a name and a version'); }
    if (!isInstant(written_at)) { return refuse('invalid_shape', 'written_at is not an ISO 8601 instant'); }
    if (!isPositiveNumber(heartbeat_seconds)) { return refuse('invalid_shape', 'heartbeat_seconds is not a positive number'); }
    if (!isStringArray(sessions)) { return refuse('invalid_shape', 'sessions is not an array of session ids'); }
    const live_sessions = sessions.filter(isSafeSessionId);
    const unsafe = sessions.length - live_sessions.length;
    const value: ActivityManifest = {
        contract_version: decoded.contract_version,
        producer: {name: producer.name, version: producer.version},
        written_at,
        heartbeat_seconds,
        capabilities: readCapabilities(decoded.record.capabilities),
        sessions: live_sessions,
    };
    return unsafe > 0 ? {ok: true, value, dropped: [`${unsafe} session ids are not safe path segments`]} : {ok: true, value};
}

/** an unrecognised state coerces to `unknown`, so a state added by a later minor version never draws as an idle agent */
function readState(value: unknown): ActivityState {
    return ACTIVITY_STATES.includes(value as ActivityState) ? value as ActivityState : ACTIVITY_STATE_UNKNOWN;
}

/**
 * `bound` must carry a story and nothing else may, because the pairing is the whole binding: a
 * `bound` session with no story joins to no card, and a story on an `undeclared` one is a guess
 * wearing a declaration's clothes.
 */
function readStoryBinding(record: JsonRecord): StoryBindingFields | ActivityParseFailure {
    const {story_binding, story} = record;
    if (!ACTIVITY_STORY_BINDINGS.includes(story_binding as ActivityStoryBinding)) { return refuse('invalid_shape', `story_binding must be one of ${ACTIVITY_STORY_BINDINGS.join(', ')}`); }
    const binding = story_binding as ActivityStoryBinding;
    if (binding !== 'bound') {
        if (story !== undefined) { return refuse('invalid_shape', `story is set on a session bound to ${binding}`); }
        return {story_binding: binding};
    }
    if (!isRecord(story) || !isNonEmptyString(story.doc_path) || !isNonEmptyString(story.id)) { return refuse('invalid_shape', 'a bound session needs story.doc_path and story.id'); }
    return {story_binding: binding, story: {doc_path: story.doc_path, id: story.id}};
}

function readEventBody(value: unknown): ActivityEventBody | undefined {
    if (!isRecord(value) || !isInstant(value.at) || !isNonEmptyString(value.kind)) { return undefined; }
    return {
        at: value.at,
        kind: value.kind,
        tool: isNonEmptyString(value.tool) ? value.tool : undefined,
        arg: typeof value.arg === 'string' ? value.arg : undefined,
    };
}

function readQuestion(value: unknown): ActivityQuestion | undefined {
    if (!isRecord(value) || !isNonEmptyString(value.question_id) || !isInstant(value.asked_at) || !isNonEmptyString(value.prompt)) { return undefined; }
    return {
        question_id: value.question_id,
        asked_at: value.asked_at,
        prompt: value.prompt,
        options: isStringArray(value.options) ? value.options : undefined,
    };
}

export function parseActivitySession(text: string): ActivityParseResult<ActivitySession> {
    const decoded = decodeContractFile(text, ACTIVITY_SESSION_MAX_BYTES);
    if (isParseFailure(decoded)) { return decoded; }
    const {session_id, vendor, project, started_at, updated_at, ended_at} = decoded.record;
    if (!isSafeSessionId(session_id)) { return refuse('invalid_shape', 'session_id is missing or is not a safe path segment'); }
    if (!isNonEmptyString(vendor) || !isNonEmptyString(project)) { return refuse('invalid_shape', 'vendor and project are both required'); }
    if (!isInstant(started_at) || !isInstant(updated_at)) { return refuse('invalid_shape', 'started_at and updated_at must be ISO 8601 instants'); }
    if (ended_at !== undefined && !isInstant(ended_at)) { return refuse('invalid_shape', 'ended_at is not an ISO 8601 instant'); }
    const binding = readStoryBinding(decoded.record);
    if (isParseFailure(binding)) { return binding; }
    const value: ActivitySession = {
        contract_version: decoded.contract_version,
        session_id,
        vendor,
        project,
        story_binding: binding.story_binding,
        story: binding.story,
        started_at,
        updated_at,
        ended_at: isInstant(ended_at) ? ended_at : undefined,
        state: readState(decoded.record.state),
        capabilities: readCapabilities(decoded.record.capabilities),
        current: readEventBody(decoded.record.current),
        question: readQuestion(decoded.record.question),
    };
    return {ok: true, value};
}

function readEventLine(line: string, index: number): ActivityEvent | string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return `line ${index + 1} is not valid JSON, which is what a half-written append looks like`;
    }
    if (!isRecord(parsed)) { return `line ${index + 1} is not a JSON object`; }
    const rejected = checkContractVersion(parsed.contract_version);
    if (rejected) { return `line ${index + 1}: ${rejected.reason}`; }
    const session_id = parsed.session_id;
    if (!isNonEmptyString(session_id)) { return `line ${index + 1} has no session_id`; }
    const body = readEventBody(parsed);
    if (!body) { return `line ${index + 1} has no usable at and kind`; }
    return {contract_version: parsed.contract_version as string, session_id, ...body};
}

/**
 * Lines are kept in write order and never re-sorted by `at`: two events in the same millisecond
 * are ordered by which was written first, so `at` is a display value rather than a key.
 */
export function parseActivityEvents(text: string): ActivityParseResult<ActivityEvent[]> {
    if (text.length > ACTIVITY_EVENTS_MAX_BYTES) { return refuse('too_large', `event log is ${text.length} characters, over the ${ACTIVITY_EVENTS_MAX_BYTES} byte bound`); }
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > ACTIVITY_EVENTS_MAX_LINES) { return refuse('too_large', `event log holds ${lines.length} lines, over the ${ACTIVITY_EVENTS_MAX_LINES} line bound`); }
    const value: ActivityEvent[] = [];
    const dropped: string[] = [];
    lines.forEach((line, index) => {
        const event = readEventLine(line, index);
        if (typeof event === 'string') { dropped.push(event); } else { value.push(event); }
    });
    return dropped.length > 0 ? {ok: true, value, dropped} : {ok: true, value};
}

function readDigestWindow<T>(value: unknown, readItem: (entry: unknown) => T | undefined): ActivityDigestWindow<T> | undefined {
    if (!isRecord(value) || !isCount(value.kept) || !isCount(value.dropped) || !Array.isArray(value.items)) { return undefined; }
    const items: T[] = [];
    for (const entry of value.items) {
        const item = readItem(entry);
        if (item !== undefined) { items.push(item); }
    }
    return {kept: value.kept, dropped: value.dropped, items};
}

function readDigestMessage(value: unknown): ActivityDigestMessage | undefined {
    if (!isRecord(value) || !isInstant(value.at) || !isNonEmptyString(value.role) || typeof value.text !== 'string') { return undefined; }
    return {at: value.at, role: value.role, text: value.text};
}

function readDigestToolCall(value: unknown): ActivityDigestToolCall | undefined {
    if (!isRecord(value) || !isInstant(value.at) || !isNonEmptyString(value.tool)) { return undefined; }
    return {
        at: value.at,
        tool: value.tool,
        arg: typeof value.arg === 'string' ? value.arg : undefined,
        outcome: isNonEmptyString(value.outcome) ? value.outcome : undefined,
    };
}

function readDigestFacts(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) { return undefined; }
    const facts: Record<string, string> = {};
    for (const [key, fact] of Object.entries(value)) {
        if (typeof fact === 'string') { facts[key] = fact; }
    }
    return facts;
}

/**
 * `kept` and `dropped` are required on both windows because they are what lets the drawer state
 * the window it is showing; a bounded list that does not say it is bounded gives a partial answer
 * looking like a complete one.
 */
export function parseActivityDigest(text: string): ActivityParseResult<ActivityDigest> {
    const decoded = decodeContractFile(text, ACTIVITY_DIGEST_MAX_BYTES);
    if (isParseFailure(decoded)) { return decoded; }
    const {session_id, generated_at} = decoded.record;
    if (!isNonEmptyString(session_id)) { return refuse('invalid_shape', 'session_id is missing'); }
    if (!isInstant(generated_at)) { return refuse('invalid_shape', 'generated_at is not an ISO 8601 instant'); }
    const messages = readDigestWindow(decoded.record.messages, readDigestMessage);
    if (!messages) { return refuse('invalid_shape', 'messages needs kept, dropped and items'); }
    const tool_calls = readDigestWindow(decoded.record.tool_calls, readDigestToolCall);
    if (!tool_calls) { return refuse('invalid_shape', 'tool_calls needs kept, dropped and items'); }
    const value: ActivityDigest = {
        contract_version: decoded.contract_version,
        session_id,
        generated_at,
        messages,
        tool_calls,
        facts: readDigestFacts(decoded.record.facts),
    };
    return {ok: true, value};
}

/** true when a contract-root-relative path falls inside a contract directory, catching a nested one as well as the repository's own */
function isInsideActivityDir(path: string): boolean {
    return path.split('/').includes(ACTIVITY_DIR);
}

/**
 * A changed-file entry, or a short reason it was dropped. The contract's own files are dropped
 * here as a backstop: `.notethink/` is kept out of git by the producer, and the contract must
 * never show up in the band it feeds.
 */
function readChangedFile(value: unknown, band: string, index: number): ActivityChangedFile | string {
    const at = `${band}[${index}]`;
    if (!isRecord(value) || !isNonEmptyString(value.path)) { return `${at} has no path`; }
    if (isInsideActivityDir(value.path)) { return `${at} ${value.path} is inside ${ACTIVITY_DIR}`; }
    if (!ACTIVITY_CHANGE_KINDS.includes(value.change as ActivityChangeKind)) { return `${at} has an unknown change kind`; }
    const change = value.change as ActivityChangeKind;
    if (change === 'renamed' && !isNonEmptyString(value.previous_path)) { return `${at} is renamed with no previous_path`; }
    if (value.base_blob !== undefined && !isActivityBlobPath(value.base_blob)) { return `${at} has a base_blob outside ${ACTIVITY_BLOBS_DIR}/`; }
    if (value.head_blob !== undefined && !isActivityBlobPath(value.head_blob)) { return `${at} has a head_blob outside ${ACTIVITY_BLOBS_DIR}/`; }
    return {
        path: value.path,
        change,
        previous_path: isNonEmptyString(value.previous_path) ? value.previous_path : undefined,
        session_id: isSafeSessionId(value.session_id) ? value.session_id : undefined,
        base_blob: isActivityBlobPath(value.base_blob) ? value.base_blob : undefined,
        head_blob: isActivityBlobPath(value.head_blob) ? value.head_blob : undefined,
        omitted: ACTIVITY_OMITTED_REASONS.includes(value.omitted as ActivityOmittedReason) ? value.omitted as ActivityOmittedReason : undefined,
    };
}

function readBand(value: unknown, band: string, dropped: string[]): ActivityChangedFile[] | undefined {
    if (!Array.isArray(value)) { return undefined; }
    const files: ActivityChangedFile[] = [];
    value.forEach((entry, index) => {
        const file = readChangedFile(entry, band, index);
        if (typeof file === 'string') { dropped.push(file); } else { files.push(file); }
    });
    return files;
}

export function parseActivityTree(text: string): ActivityParseResult<ActivityTree> {
    const decoded = decodeContractFile(text, ACTIVITY_TREE_MAX_BYTES);
    if (isParseFailure(decoded)) { return decoded; }
    const {generated_at, branch, head_commit, base_ref} = decoded.record;
    if (!isInstant(generated_at)) { return refuse('invalid_shape', 'generated_at is not an ISO 8601 instant'); }
    if (!isNonEmptyString(branch) || !isNonEmptyString(head_commit)) { return refuse('invalid_shape', 'branch and head_commit are both required'); }
    const dropped: string[] = [];
    const uncommitted = readBand(decoded.record.uncommitted, 'uncommitted', dropped);
    const committed = readBand(decoded.record.committed, 'committed', dropped);
    if (!uncommitted || !committed) { return refuse('invalid_shape', 'uncommitted and committed must both be arrays'); }
    const value: ActivityTree = {
        contract_version: decoded.contract_version,
        generated_at,
        branch,
        head_commit,
        base_ref: isNonEmptyString(base_ref) ? base_ref : undefined,
        uncommitted,
        committed,
    };
    return dropped.length > 0 ? {ok: true, value, dropped} : {ok: true, value};
}

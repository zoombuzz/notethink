import {
    ACTIVITY_ARG_MAX_CHARS,
    type ActivityEventBody,
    type ActivityState,
} from '../../types/AgentActivity';
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

/**
 * The Claude Code reader: turns one session's own `~/.claude/projects/<slug>/<session-id>.jsonl`
 * transcript (plus its subagent transcripts, handed in as `extra_files`) into the shape every vendor
 * reader produces. It is pure and does no I/O, so a nested web worker with no `vscode` API can run it
 * directly against decoded file text.
 *
 * Claude Code's own SDK shape varies release to release, so every record and content block is read
 * defensively: an unexpected or missing field degrades that one line or block rather than the read.
 * The one thing measured rather than assumed is that a `message.id` can repeat across several
 * transcript lines carrying identical `usage`, the SDK re-emitting an accumulating response in
 * chunks, so every usage figure is counted against its message id exactly once, on first sight.
 */

// Claude Code's built-in tools that write a file, keyed by their exact tool_use name
const CLAUDE_FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** one block inside a transcript message's `content` array, read defensively since the exact shape varies by SDK version */
interface ClaudeContentBlock {
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: unknown;
}

/** the usage figures on one assistant message, in the Anthropic Messages API's own field names */
interface ClaudeUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
}

/** the `message` object on an assistant (and some user) transcript lines */
interface ClaudeTranscriptMessage {
    id?: string;
    model?: string;
    role?: string;
    content?: unknown;
    usage?: ClaudeUsage;
}

/** one decoded line of a Claude Code transcript JSONL file */
export interface ClaudeTranscriptRecord {
    type?: string;
    timestamp?: string;
    message?: ClaudeTranscriptMessage;
}

/** a decoded record paired with the timestamp it parsed to, once it has passed the window check */
interface TimestampedRecord {
    record: ClaudeTranscriptRecord;
    timestamp: string;
    timestamp_ms: number;
}

/**
 * Parses one file's worth of transcript text and checks it against the two whole-file refusal
 * conditions (too_large, invalid_shape). Exported so `AgentAnalyserWorker.ts` can run it once against
 * a session's current full bytes (first sight, a shrunk or rewritten file, or a session re-read after
 * a worker restart) and reuse the very same `records` both to build the session's result and to seed
 * that file's own incremental cache, rather than parsing the same text twice.
 */
export function parseClaudeCodeTranscript(text: string): { records: ClaudeTranscriptRecord[]; refusal?: AgentReadRefusal } {
    const byte_length = new TextEncoder().encode(text).length;
    if (byte_length > AGENT_TRANSCRIPT_MAX_BYTES) {
        return { records: [], refusal: { code: 'too_large', reason: `${byte_length} bytes, over the ${AGENT_TRANSCRIPT_MAX_BYTES} byte bound` } };
    }
    const { records, total_lines } = parseTranscriptLines(text);
    if (total_lines > 0 && records.length === 0) {
        return { records: [], refusal: { code: 'invalid_shape', reason: 'no line in the transcript parsed as JSON' } };
    }
    return { records };
}

/**
 * Builds one session's result from its already-parsed records: the main transcript's, and each
 * subagent transcript's own. Pure and independent of how `records`/`extra_records` were assembled, so
 * the same function serves a whole-file read (`readClaudeCodeSession` below) and a resumed one
 * (`AgentAnalyserWorker.ts`, which appends only the newly tail-parsed lines to a cached array before
 * calling this): there is exactly one code path building a result from records, whether the caller
 * supplies a fresh parse or a resumed tail.
 */
export function buildClaudeCodeResult(input: AgentSessionInput, records: ClaudeTranscriptRecord[], extra_records: ClaudeTranscriptRecord[][]): AgentSessionResult {
    const calls = extractCalls(records, input.window_start_ms, input.now_ms);
    for (const extra of extra_records) { calls.push(...extractCalls(extra, input.window_start_ms, input.now_ms)); }
    const in_window = recordsWithTimestampInWindow(records, input.window_start_ms, input.now_ms);
    const current = currentFromRecords(in_window);
    const state = deriveState(input.vendor_live, current);
    const { started_at, updated_at } = sessionSpan(records, input.now_ms);
    return {
        session_id: input.session_id,
        cwd: input.cwd,
        state,
        started_at,
        updated_at,
        ended_at: state === 'ended' ? updated_at : undefined,
        current,
        model: lastModelInRecords(records),
        calls,
        tool_invocations: buildToolInvocations(in_window),
    };
}

/** reads one Claude Code session's transcript and subagent transcripts into the shared vendor-reader shape */
export function readClaudeCodeSession(input: AgentSessionInput): AgentSessionResult {
    const { records, refusal } = parseClaudeCodeTranscript(input.transcript.text);
    if (refusal) { return refusalResult(input, 'unknown', refusal); }
    const extra_records = input.extra_files.map(extra_file => parseTranscriptLines(extra_file.text).records);
    return buildClaudeCodeResult(input, records, extra_records);
}

/** the minimal result a refusal still owes a caller: enough to draw the row, none of what could not be safely produced */
function refusalResult(
    input: AgentSessionInput,
    state: ActivityState,
    refusal: AgentReadRefusal,
): AgentSessionResult {
    const now_iso = new Date(input.now_ms).toISOString();
    return {
        session_id: input.session_id,
        cwd: input.cwd,
        state,
        started_at: now_iso,
        updated_at: now_iso,
        calls: [],
        tool_invocations: [],
        refusal,
    };
}

/** decodes one JSONL file into its records; a line that fails to parse is dropped for that line only, a producer can be writing while this reads */
function parseTranscriptLines(text: string): { records: ClaudeTranscriptRecord[]; total_lines: number } {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const records: ClaudeTranscriptRecord[] = [];
    for (const line of lines) {
        try {
            records.push(JSON.parse(line) as ClaudeTranscriptRecord);
        } catch {
            // a torn trailing line is expected while the producer is still writing, so only this line is lost
        }
    }
    return { records, total_lines: lines.length };
}

function parseTimestampMs(timestamp: string): number | undefined {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? undefined : parsed;
}

function isClaudeContentBlock(value: unknown): value is ClaudeContentBlock {
    return typeof value === 'object' && value !== null;
}

/**
 * Sums API usage across one file's records, deduping by `message.id`: several lines can carry the
 * same id with identical usage, the SDK re-emitting an accumulating response in chunks, so only the
 * first sighting of an id is ever counted. `span_start_at` is the previous record's own timestamp,
 * of any record type, tracked across the whole file rather than only the windowed records.
 */
function extractCalls(records: ClaudeTranscriptRecord[], window_start_ms: number, now_ms: number): AgentApiCall[] {
    const calls: AgentApiCall[] = [];
    const seen_message_ids = new Set<string>();
    let previous_timestamp: string | undefined;
    for (const record of records) {
        const message = record.message;
        const usage = message?.usage;
        const message_id = message?.id;
        const timestamp = record.timestamp;
        const timestamp_ms = timestamp === undefined ? undefined : parseTimestampMs(timestamp);
        if (message_id !== undefined && usage !== undefined && !seen_message_ids.has(message_id)) {
            seen_message_ids.add(message_id);
            const in_window = timestamp !== undefined && timestamp_ms !== undefined
                && timestamp_ms >= window_start_ms && timestamp_ms <= now_ms;
            if (in_window && timestamp !== undefined) {
                calls.push({
                    model_id: message?.model ?? 'unknown',
                    at: timestamp,
                    span_start_at: previous_timestamp,
                    input_tokens: usage.input_tokens ?? 0,
                    output_tokens: usage.output_tokens ?? 0,
                    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
                    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
                });
            }
        }
        if (timestamp !== undefined && timestamp_ms !== undefined) {
            previous_timestamp = timestamp;
        }
    }
    return calls;
}

/** the records whose own timestamp parses and falls inside the caller's window, in transcript (write) order */
function recordsWithTimestampInWindow(
    records: ClaudeTranscriptRecord[],
    window_start_ms: number,
    now_ms: number,
): TimestampedRecord[] {
    const kept: TimestampedRecord[] = [];
    for (const record of records) {
        if (record.timestamp === undefined) { continue; }
        const timestamp_ms = parseTimestampMs(record.timestamp);
        if (timestamp_ms === undefined || timestamp_ms < window_start_ms || timestamp_ms > now_ms) { continue; }
        kept.push({ record, timestamp: record.timestamp, timestamp_ms });
    }
    return kept;
}

/** earliest and latest parseable timestamp across every record, regardless of window, since a session's lifetime is not bounded by the analyser's window */
function sessionSpan(records: ClaudeTranscriptRecord[], now_ms: number): { started_at: string; updated_at: string } {
    let earliest: { ts: string; ms: number } | undefined;
    let latest: { ts: string; ms: number } | undefined;
    for (const record of records) {
        if (record.timestamp === undefined) { continue; }
        const ms = parseTimestampMs(record.timestamp);
        if (ms === undefined) { continue; }
        if (earliest === undefined || ms < earliest.ms) { earliest = { ts: record.timestamp, ms }; }
        if (latest === undefined || ms > latest.ms) { latest = { ts: record.timestamp, ms }; }
    }
    const fallback = new Date(now_ms).toISOString();
    return { started_at: earliest?.ts ?? fallback, updated_at: latest?.ts ?? fallback };
}

/** the last tool_use block of the most recent in-window assistant message, or undefined when that message has none pending */
function currentFromRecords(in_window: TimestampedRecord[]): ActivityEventBody | undefined {
    for (let i = in_window.length - 1; i >= 0; i--) {
        const item = in_window[i];
        if (item.record.type !== 'assistant') { continue; }
        const content = item.record.message?.content;
        if (!Array.isArray(content)) { return undefined; }
        const tool_use = lastToolUseBlock(content);
        if (tool_use === undefined) { return undefined; }
        return { at: item.timestamp, kind: 'tool_call', tool: tool_use.name ?? 'unknown', arg: summarizeToolArg(tool_use.input) };
    }
    return undefined;
}

function lastToolUseBlock(content: unknown[]): ClaudeContentBlock | undefined {
    for (let i = content.length - 1; i >= 0; i--) {
        const block = content[i];
        if (isClaudeContentBlock(block) && block.type === 'tool_use') { return block; }
    }
    return undefined;
}

/** Claude Code is never asked for a question and never reports live_tool_call without vendor_live; not live always reads as ended, per its own capability table */
function deriveState(vendor_live: boolean | undefined, current: ActivityEventBody | undefined): ActivityState {
    if (vendor_live !== true) { return 'ended'; }
    return current !== undefined ? 'working' : 'idle';
}

/** a short display summary for a tool call's argument: its file path, its command, or its first string-valued field, truncated to the shared display bound */
function summarizeToolArg(call_input: Record<string, unknown> | undefined): string | undefined {
    if (call_input === undefined) { return undefined; }
    const first_string_value = Object.values(call_input).find((value): value is string => typeof value === 'string');
    const candidate = call_input.file_path ?? call_input.command ?? first_string_value;
    if (typeof candidate !== 'string') { return undefined; }
    return candidate.length > ACTIVITY_ARG_MAX_CHARS ? candidate.slice(0, ACTIVITY_ARG_MAX_CHARS) : candidate;
}

// the model on the session's own most recent record naming one, across the whole transcript rather than only a windowed slice: a session's current model outlives whatever window happens to be open
function lastModelInRecords(records: ClaudeTranscriptRecord[]): string | undefined {
    for (let i = records.length - 1; i >= 0; i--) {
        const model = records[i].message?.model;
        if (model !== undefined) { return model; }
    }
    return undefined;
}

/** best-effort commit subject: the text after a `-m` flag, its surrounding quotes stripped when present */
function parseCommitSubject(command: string): string | undefined {
    const match = /-m\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(command);
    if (match === null) { return undefined; }
    return match[1] ?? match[2] ?? match[3];
}

// a path a Bash script might write to, ending in todo.md or done.md, quoted (a Python string) or bare (a sed -i's trailing filename argument, unquoted since sed itself needs no shell quoting there)
const BASH_BOARD_PATH = /(['"])((?:[^'"]*\/)?(?:todo|done)\.md)\1|(?:^|\s)((?:\S*\/)?(?:todo|done)\.md)(?=\s|$)/;
// evidence the script actually writes the file it opened, not only reads it (`sed -n`, `cat`, `grep` never count, or a session that merely inspects a board would look bound to it, the exact over-counting the location-based binder exists to avoid)
const BASH_WRITE_EVIDENCE = /\.write\(|sed\s+-i\b/;
// a Python triple-quoted block: large inserted story text (a whole new section, or a multi-paragraph note) routinely quotes a UI label or another story's own wording inside its markdown prose, so it is extracted as ONE literal rather than scanned for nested single/double quotes - scanning inside it would split out a short quoted sub-phrase that can coincidentally match unrelated wording in some other story about a similar feature
const BASH_TRIPLE_QUOTED = /'''([\s\S]*?)'''|"""([\s\S]*?)"""/g;
// a quoted string literal in a Bash command, single- or double-quoted, its own escaped quotes tolerated
const BASH_STRING_LITERAL = /(['"])((?:\\.|(?!\1).)*)\1/g;
// a literal used only to LOCATE a position (`text.index('...')`, `text.find("...")`) never itself becomes part of what a script writes - it can as easily be some other, unrelated heading used purely as a slice boundary - so it is excluded from extraction rather than treated as this call's own edited content
const BASH_LOCATE_ONLY_LITERAL = /\.(?:index|find)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
// shorter than this is noise (a bare flag, a single word) even as a fallback locator - a more generous bar than AGENT_EDIT_SNIPPET's own distinctive-line threshold, since a script literal is freeform text, not curated board content
const BASH_LITERAL_MIN_LENGTH = 20;
// this workspace's own task-list marker convention (workspace AGENTS.md > Format rules): a script ticks a task by literally replacing this prefix, so the UNTICKED form survives in the script as a literal but the TICKED form does not - it is produced by the replace call, never written out as its own literal
const UNTICKED_TASK_PREFIX = '+ [ ] ';
const TICKED_TASK_PREFIX = '+ [X] ';

/** a Bash string literal's content, unescaped for the common cases a shell-quoted Python/sed script actually uses - not a full string-literal parser, just enough that a literal matches the real board text it names */
function unescapeBashLiteral(raw: string): string {
    return raw.replace(/\\(.)/g, (whole, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}

/**
 * The board write a `Bash` tool call made, when this workspace's own idiom for editing `todo.md`/
 * `done.md` outside the Edit/MultiEdit tool is recognisable in its command text: a Python heredoc (or
 * a `sed -i`) that reads the board, replaces literal string content, and writes it back - a real,
 * repeated pattern in this workspace's own sessions, such as an orchestrating session ticking several
 * stories' tasks in one script rather than one Edit call per line. Without this, such a session's
 * board write is invisible to `buildToolInvocations` entirely (`CLAUDE_FILE_WRITE_TOOLS` only
 * recognises the four built-in file-write tools), so it can never bind to any story no matter how
 * accurate the location-matching binder is.
 *
 * Every quoted string literal in the command at least `BASH_LITERAL_MIN_LENGTH` long, other than one
 * used only to locate a position (see `BASH_LOCATE_ONLY_LITERAL`), is a candidate located edit: most
 * are either text still present in the board (an anchor, or new content inserted alongside a ticked
 * task) or text the script replaced (no longer present, the same weaker-locator role `old_text`
 * already plays for the Edit tool - carried here as `new_text` since, unlike Edit's own
 * old_string/new_string, nothing here tells the two apart, and `locateEditInDoc` searches either field
 * identically). A literal that IS one of this workspace's own unticked task markers additionally gets
 * its ticked form synthesised (see `UNTICKED_TASK_PREFIX`'s header), the one shape this extraction
 * cannot otherwise recover from the literal alone.
 *
 * Deliberately conservative in both directions: a command with no recognised write evidence is not
 * treated as a write at all (see `BASH_WRITE_EVIDENCE`), and a script whose shape this does not
 * recognise binds nothing, the same as a whole-file write, rather than guessing at its content -
 * matching the precedent this file's header already sets for Codex's own unparsed `apply_patch`
 * heredoc shape.
 */
// pushes a candidate located edit for one extracted literal, unless it is the board's own path or too short to be distinctive; also synthesises the ticked form of an unticked task marker (see UNTICKED_TASK_PREFIX's header)
function pushLiteralEdit(edits: AgentToolInvocationEdit[], literal: string, file_path: string): void {
    // the path literal itself (assigned to a variable, or named directly) is a path reference, not board content - a short project-relative path is exactly the kind of generic substring that can falsely match an unrelated mention of some other project's same-shaped path elsewhere on the board
    if (literal === file_path || literal.length < BASH_LITERAL_MIN_LENGTH) { return; }
    edits.push({ new_text: boundedSnippet(literal) });
    if (literal.startsWith(UNTICKED_TASK_PREFIX)) {
        edits.push({ new_text: boundedSnippet(TICKED_TASK_PREFIX + literal.slice(UNTICKED_TASK_PREFIX.length)) });
    }
}

function boardEditFromBashCommand(command: string): { file_path: string; edits: AgentToolInvocationEdit[] } | undefined {
    const path_match = BASH_BOARD_PATH.exec(command);
    const file_path = path_match?.[2] ?? path_match?.[3];
    if (!file_path || !BASH_WRITE_EVIDENCE.test(command)) { return undefined; }
    const locate_only = new Set<string>();
    BASH_LOCATE_ONLY_LITERAL.lastIndex = 0;
    let locate_match: RegExpExecArray | null;
    while ((locate_match = BASH_LOCATE_ONLY_LITERAL.exec(command)) !== null) { locate_only.add(unescapeBashLiteral(locate_match[2])); }
    const edits: AgentToolInvocationEdit[] = [];
    // triple-quoted blocks first, each as one whole literal, then their spans are blanked out so the single/double-quote pass below never re-scans a quote nested inside one (see BASH_TRIPLE_QUOTED's header)
    let remainder = '';
    let cursor = 0;
    BASH_TRIPLE_QUOTED.lastIndex = 0;
    let triple_match: RegExpExecArray | null;
    while ((triple_match = BASH_TRIPLE_QUOTED.exec(command)) !== null) {
        const literal = unescapeBashLiteral(triple_match[1] ?? triple_match[2] ?? '');
        if (!locate_only.has(literal)) { pushLiteralEdit(edits, literal, file_path); }
        remainder += command.slice(cursor, triple_match.index);
        cursor = triple_match.index + triple_match[0].length;
    }
    remainder += command.slice(cursor);
    BASH_STRING_LITERAL.lastIndex = 0;
    let literal_match: RegExpExecArray | null;
    while ((literal_match = BASH_STRING_LITERAL.exec(remainder)) !== null) {
        const literal = unescapeBashLiteral(literal_match[2]);
        if (locate_only.has(literal)) { continue; }
        pushLiteralEdit(edits, literal, file_path);
    }
    return edits.length > 0 ? { file_path, edits } : undefined;
}

// bounds one edit snippet to the shared display/carry limit, so neither a huge Write's content nor a pathological Edit blows the worker's reply
function boundedSnippet(text: string): string {
    return text.length > AGENT_EDIT_SNIPPET_MAX_CHARS ? text.slice(0, AGENT_EDIT_SNIPPET_MAX_CHARS) : text;
}

/** one Edit call's located edit, or one MultiEdit entry's; either half missing is carried as undefined rather than an empty string, so a binder can tell "no content" from "empty replacement" */
function editFromStrings(old_string: unknown, new_string: unknown): AgentToolInvocationEdit {
    return {
        old_text: typeof old_string === 'string' ? boundedSnippet(old_string) : undefined,
        new_text: typeof new_string === 'string' ? boundedSnippet(new_string) : undefined,
    };
}

/** the located edits a file-write tool call carries: one per MultiEdit entry, one for Edit/NotebookEdit, none (whole-file content instead) for Write */
function editsFromCallInput(tool_name: string, call_input: Record<string, unknown>): { edits?: AgentToolInvocationEdit[]; whole_file?: boolean } {
    if (tool_name === 'MultiEdit' && Array.isArray(call_input.edits)) {
        const edits = call_input.edits
            .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
            .map(entry => editFromStrings(entry.old_string, entry.new_string));
        return edits.length > 0 ? { edits } : {};
    }
    if (tool_name === 'Write') {
        // a Write replaces the whole file, so its content cannot locate one story section; the content itself is never carried
        return { whole_file: true };
    }
    // Edit and NotebookEdit each carry exactly one located edit
    return { edits: [editFromStrings(call_input.old_string, call_input.new_string)] };
}

/** every in-window tool_use block worth attributing to this session: a file write, or a git commit, both resolved later by callers this reader never sees */
function buildToolInvocations(in_window: TimestampedRecord[]): AgentToolInvocation[] {
    const invocations: AgentToolInvocation[] = [];
    for (const item of in_window) {
        if (item.record.type !== 'assistant') { continue; }
        const content = item.record.message?.content;
        if (!Array.isArray(content)) { continue; }
        for (const block of content) {
            if (!isClaudeContentBlock(block) || block.type !== 'tool_use' || block.name === undefined) { continue; }
            const call_input = block.input ?? {};
            if (CLAUDE_FILE_WRITE_TOOLS.has(block.name)) {
                const file_path = block.name === 'NotebookEdit' ? call_input.notebook_path : call_input.file_path;
                invocations.push({
                    at: item.timestamp,
                    file_path: typeof file_path === 'string' ? file_path : undefined,
                    ...editsFromCallInput(block.name, call_input),
                });
                continue;
            }
            const command = call_input.command;
            if (block.name !== 'Bash' && block.name !== 'bash') { continue; }
            if (typeof command !== 'string') { continue; }
            if (command.includes('git commit')) {
                invocations.push({ at: item.timestamp, is_commit: true, commit_subject: parseCommitSubject(command) });
                continue;
            }
            const board_edit = boardEditFromBashCommand(command);
            if (board_edit) { invocations.push({ at: item.timestamp, file_path: board_edit.file_path, edits: board_edit.edits }); }
        }
    }
    return invocations;
}

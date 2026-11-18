import { registryVendorSlug, type RegistryEntry } from './agentregistryops';

/**
 * Reading what a coordinator writes today: the pure half. Each project keeps its coordinator's state
 * in a few files under the thinkersync home, written by other tooling and read here and never written,
 * so a missing, empty, oversize or malformed file, a bad line among good ones and any field a newer
 * writer adds are all ordinary: each function answers them with an omission, never an error.
 *
 * - `coordinator/<project>/sessions.jsonl`: append-only, one JSON object per line, one line per
 *   session event. A project is listed when it holds a line whose role is `coordinator`; its vendor and
 *   session ids come from those lines, newest first, and a newest line with the event `stop` means the
 *   coordinator is stopped. An empty session id is an unconfirmed launch and names no session.
 * - `coordinator/<project>/story-assignments.jsonl`: append-only; the last line's story is the story in
 *   flight, and an empty story (as after a hand back) means none.
 * - `coordinator/<project>/waiting.json`: `{ at, questions }` while questions are open, absent or with
 *   an empty list otherwise.
 * - `coordinator-homes.json`: an object mapping a project name to the machine its coordinator builds on.
 * - `mailboxes/coord-<project>/resume.json`: an envelope whose `origin_machine` is the machine the
 *   coordinator last wrote from and whose `body.open_convoys` lists its open convoys.
 *
 * What reaches a coordinator row is the entry `coordinatorEntryFrom` builds: the agent name, vendor, state,
 * story, machine, open convoys and session ids. A coordinator with no machine in either place has no
 * address, so its entry carries an empty machine and the rows skip it, while its session ids still join
 * the vendor sessions.
 */

// the file names and directories below the thinkersync home
export const COORDINATOR_HOMES_FILE = 'coordinator-homes.json';
export const COORDINATOR_AGENT_PREFIX = 'coord-';

// a ledger is read whole, so a larger one is read from its tail: the newest lines are the ones that matter
export const COORDINATOR_LEDGER_MAX_BYTES = 512 * 1024;

// the other files are a few short fields; anything larger is not one and is left unread
export const COORDINATOR_FILE_MAX_BYTES = 256 * 1024;

// the most session ids and open convoys carried, so a runaway writer cannot bloat every activity post
export const COORDINATOR_SESSION_IDS_MAX = 20;
export const COORDINATOR_CONVOYS_MAX = 50;

// the longest id, name or story carried
const COORDINATOR_TEXT_MAX_CHARS = 120;

const COORDINATOR_ROLE = 'coordinator';
const STOP_EVENT = 'stop';

/**
 * The text of each file one project's coordinator keeps, undefined where a file is absent or unreadable.
 * - sessions / assignments: the two ledgers
 * - waiting: the open questions file
 * - homes: the machine map shared by every project
 * - resume: the resume note in the coordinator's mailbox
 */
export interface CoordinatorFileTexts {
    sessions?: string;
    assignments?: string;
    waiting?: string;
    homes?: string;
    resume?: string;
}

/** the path segments of each file one project's coordinator keeps, below the thinkersync home */
export function coordinatorFileSegments(project: string): { sessions: string[]; assignments: string[]; waiting: string[]; homes: string[]; resume: string[] } {
    return {
        sessions: ['coordinator', project, 'sessions.jsonl'],
        assignments: ['coordinator', project, 'story-assignments.jsonl'],
        waiting: ['coordinator', project, 'waiting.json'],
        homes: [COORDINATOR_HOMES_FILE],
        resume: ['mailboxes', coordinatorAgentName(project), 'resume.json'],
    };
}

/** the agent name a project's coordinator goes by, which is also its mailbox directory */
export function coordinatorAgentName(project: string): string {
    return `${COORDINATOR_AGENT_PREFIX}${project}`;
}

/** the text of a ledger kept to its newest lines: a ledger over the bound is cut to its tail, dropping the partial line the cut lands in */
export function ledgerTail(text: string): string {
    if (text.length <= COORDINATOR_LEDGER_MAX_BYTES) { return text; }
    const tail = text.slice(text.length - COORDINATOR_LEDGER_MAX_BYTES);
    const newline = tail.indexOf('\n');
    return newline < 0 ? '' : tail.slice(newline + 1);
}

function textField(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, COORDINATOR_TEXT_MAX_CHARS) : '';
}

function validTime(value: unknown): string | undefined {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function latestTime(times: ReadonlyArray<string | undefined>): string | undefined {
    let latest: string | undefined;
    for (const time of times) {
        if (time !== undefined && (latest === undefined || Date.parse(time) > Date.parse(latest))) { latest = time; }
    }
    return latest;
}

/** the objects among a JSON lines file's lines, in file order; a blank line, a line that is not JSON and a line that is not an object are skipped */
export function parseJsonLines(text: string): Record<string, unknown>[] {
    const objects: Record<string, unknown>[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) { continue; }
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) { objects.push(parsed as Record<string, unknown>); }
        } catch { /* a torn or foreign line costs only itself */ }
    }
    return objects;
}

/**
 * What a session ledger says about its coordinator.
 * - vendor: the vendor slug of the newest line naming one, empty when none does
 * - session_ids: the distinct non-empty session ids of the coordinator's lines, newest first
 * - stopped: whether the newest coordinator line is a `stop`
 * - updated_at: the newest coordinator line's time
 */
export interface SessionLedgerSummary {
    vendor: string;
    session_ids: string[];
    stopped: boolean;
    updated_at?: string;
}

/** the summary of a session ledger, undefined when it holds no line for a coordinator, which is what leaves a project unlisted */
export function parseSessionLedger(text: string): SessionLedgerSummary | undefined {
    const lines = parseJsonLines(ledgerTail(text)).filter(line => line.role === COORDINATOR_ROLE);
    if (lines.length === 0) { return undefined; }
    const newest_first = [...lines].reverse();
    const ids = new Set<string>();
    for (const line of newest_first) {
        const id = textField(line.session);
        if (id) { ids.add(id); }
    }
    const vendor_line = newest_first.find(line => textField(line.vendor).length > 0);
    return {
        vendor: vendor_line ? registryVendorSlug(textField(vendor_line.vendor)) : '',
        session_ids: [...ids].slice(0, COORDINATOR_SESSION_IDS_MAX),
        stopped: newest_first[0].event === STOP_EVENT,
        updated_at: validTime(newest_first[0].ts),
    };
}

/** the story in flight and when it was last recorded, from an assignment ledger: the last line's story, empty when the line names none or the ledger is empty */
export function parseAssignmentLedger(text: string): { story: string; updated_at?: string } {
    const lines = parseJsonLines(ledgerTail(text));
    if (lines.length === 0) { return { story: '' }; }
    const last = lines[lines.length - 1];
    return { story: textField(last.story), updated_at: validTime(last.ts) };
}

/** the open questions file: whether it lists any, and when it was written */
export function parseWaitingFile(text: string): { waiting: boolean; at?: string } {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return { waiting: false }; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { return { waiting: false }; }
    const raw = parsed as { questions?: unknown; at?: unknown };
    return { waiting: Array.isArray(raw.questions) && raw.questions.length > 0, at: validTime(raw.at) };
}

/** the machine the homes file gives a project, empty when the file is not an object of strings or names none for it */
export function parseHomesFile(text: string, project: string): string {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return ''; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, project)) { return ''; }
    return textField((parsed as Record<string, unknown>)[project]);
}

/** the machine and open convoys a resume note carries, each empty when the note is malformed or names none; a convoy is a string, or an object naming its repository */
export function parseResumeFile(text: string): { machine: string; open_convoys: string[] } {
    const empty = { machine: '', open_convoys: [] };
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return empty; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { return empty; }
    const raw = parsed as { origin_machine?: unknown; body?: unknown };
    const body = raw.body !== null && typeof raw.body === 'object' && !Array.isArray(raw.body) ? raw.body as { open_convoys?: unknown } : {};
    const convoys = Array.isArray(body.open_convoys) ? body.open_convoys : [];
    const open_convoys = convoys
        .map(convoy => (convoy !== null && typeof convoy === 'object' ? textField((convoy as { repo?: unknown }).repo) : textField(convoy)))
        .filter(convoy => convoy.length > 0)
        .slice(0, COORDINATOR_CONVOYS_MAX);
    return { machine: textField(raw.origin_machine), open_convoys };
}

/**
 * The entry a project's coordinator files make, undefined when the sessions ledger is missing or holds no
 * coordinator line. State is `stopped` from a newest `stop` line, else `waiting` while the waiting file
 * lists questions, else `working` while an assignment names a story in flight, else `idle`. The machine is
 * the homes file's, else the resume note's, else empty.
 */
export function coordinatorEntryFrom(project: string, repo: string, files: CoordinatorFileTexts): RegistryEntry | undefined {
    const ledger = files.sessions === undefined ? undefined : parseSessionLedger(files.sessions);
    if (!ledger) { return undefined; }
    const assignment = files.assignments === undefined ? { story: '' } : parseAssignmentLedger(files.assignments);
    const waiting = files.waiting === undefined ? { waiting: false } : parseWaitingFile(files.waiting);
    const resume = files.resume === undefined ? { machine: '', open_convoys: [] } : parseResumeFile(files.resume);
    const homed = files.homes === undefined ? '' : parseHomesFile(files.homes, project);
    const state = ledger.stopped ? 'stopped' : waiting.waiting ? 'waiting' : assignment.story ? 'working' : 'idle';
    return {
        agent: coordinatorAgentName(project),
        vendor: ledger.vendor || registryVendorSlug(undefined),
        repo,
        state,
        story: ledger.stopped ? '' : assignment.story,
        session_ids: ledger.session_ids,
        updated_at: latestTime([ledger.updated_at, assignment.updated_at, waiting.at]),
        agent_kind: COORDINATOR_ROLE,
        machine: homed || resume.machine,
        open_convoys: resume.open_convoys,
    };
}

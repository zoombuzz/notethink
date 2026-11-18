import type { ActivityBoardLines, ActivityCoordinator, ActivityCoordinatorStory } from '../types/AgentActivity';
import type { ResolvedRegistryAgent } from './agentregistryops';
import type { StoryDocument } from './agentstorybindingops';

/**
 * Coordinators beside boards: the pure half. A coordinator is a long-lived agent that owns one
 * repository's board, read from the files coordinators write (`coordinatorfilesops.ts`). This module
 * turns those entries and the repository's own `todo.md` into the rows a view lists, works out where
 * the build and ship lines fall on a board, and builds the envelope a send writes into the agent's mailbox.
 *
 * NoteThink only ever shows and asks: it never starts, stops or restarts an agent. The one thing it
 * writes is an envelope dropped in an agent's inbox, on the user's explicit action. The envelope's layout
 * is thinkersync's public interface, version 0: one JSON file named `<id>.json` in
 * `mailboxes/<agent>/inbox/` under the thinkersync home, whose id is a compact UTC stamp and a short
 * random suffix.
 */

// the agent kind listed as a coordinator; an entry naming none is read as one
export const COORDINATOR_AGENT_KIND = 'coordinator';

// an agent or machine name is a mailbox path segment and half an envelope target, so it is pattern-checked first
const SAFE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

// the vendor names a coordinator's session ledger writes, which a vendor-change envelope names its target by
export const COORDINATOR_VENDOR_NAMES = ['claude', 'agy', 'codex', 'grok'] as const;
export type CoordinatorVendorName = typeof COORDINATOR_VENDOR_NAMES[number];

// the longest message a send carries, so a pasted log cannot fill an inbox
export const COORDINATOR_SEND_BODY_MAX_CHARS = 8000;

// the most stories one coordinator row lists, so a very long board cannot bloat every activity post
export const COORDINATOR_BOARD_MAX_STORIES = 300;

// the longest operator step or title carried
const BOARD_TEXT_MAX_CHARS = 160;

// an envelope's sender: NoteThink writes it on the user's explicit action, so it is the operator's own
export const ENVELOPE_SENDER = 'notethink';
export const ENVELOPE_SENDER_KIND = 'operator';
export const ENVELOPE_VERSION = 0;

const STORY_HEADING = /^### (.*)$/;
const LINETAG_PATTERN = /\[\]\(\?([^)]*)\)/g;
const OPEN_TASK = /^\s*[+*-]\s+\[ \]/;
const OPEN_QUESTION_LINE = /^\s*\+ open question(\s*\([^)]*\))?:/;
const BLOCKED_NOTE_LINE = /^\s*\+ blocked\b[^:]*:/;

// the id prefix of a story another repository's coordinator delegated to this board
const DELEGATED_ID_PREFIX = 'delegated-';

// statuses that wait on the operator, so a coordinator does not pick them up, and that have passed the release gate
const REVIEW_STATUSES = ['code-review', 'testing'];

/**
 * One story of a board as the build and ship lines see it.
 * - sent: whether the heading carries a `sent` linetag, which a coordinator's envelope writes when it hands the story over
 * - markers: the machines a `coord=` linetag names as allowed to build the story, none when it carries no tag
 * - open_question: whether the story holds an unanswered `+ open question` line
 * - blocked: whether the story holds a `+ blocked` note
 */
export interface BoardStory extends ActivityCoordinatorStory {
    sent: boolean;
    markers: string[];
    open_question: boolean;
    blocked: boolean;
}

/**
 * The fields every envelope NoteThink writes carries, in thinkersync's version 0 layout.
 * - sender / sender_kind: who sent it; a send here is the operator's own explicit action
 * - origin_machine: the machine the send was made from, which is the agent's own machine, since the mailbox is read from the host serving the workspace
 * - target: `<agent>@<machine>`
 * - task_id: the envelope's own id, since a send starts a new task
 */
interface CoordinatorEnvelopeBase {
    v: typeof ENVELOPE_VERSION;
    id: string;
    sender: string;
    sender_kind: string;
    origin_machine: string;
    target: string;
    task_id: string;
    reply_to: string;
    state: 'submitted';
    created_at: string;
}

/** a free-text request, whose body is the message as typed */
export interface CoordinatorRequestEnvelope extends CoordinatorEnvelopeBase {
    kind: 'request';
    body: string;
}

/** a vendor change, whose body names the vendor as thinkersync spells it */
export interface CoordinatorVendorEnvelope extends CoordinatorEnvelopeBase {
    kind: 'vendor';
    body: { vendor: CoordinatorVendorName };
}

export type CoordinatorEnvelope = CoordinatorRequestEnvelope | CoordinatorVendorEnvelope;

/** whether a name is a vendor a coordinator can be asked to change to */
export function isCoordinatorVendorName(name: unknown): name is CoordinatorVendorName {
    return typeof name === 'string' && (COORDINATOR_VENDOR_NAMES as ReadonlyArray<string>).includes(name);
}

/** whether a name is safe to use as a mailbox directory and an envelope target half */
export function isSafeCoordinatorName(name: string): boolean {
    return SAFE_NAME_PATTERN.test(name);
}

/** the path segments of an agent's inbox below the thinkersync home; the agent's name must already be safe */
export function mailboxInboxSegments(agent: string): string[] {
    return ['mailboxes', agent, 'inbox'];
}

/** whether an entry is one of the coordinators a view lists: an entry naming no kind is read as one, any other kind is not */
export function isCoordinatorEntry(entry: Pick<ResolvedRegistryAgent, 'agent_kind'>): boolean {
    const kind = entry.agent_kind ?? '';
    return kind === '' || kind === COORDINATOR_AGENT_KIND;
}

function slugify(text: string): string {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function clip(text: string): string {
    return text.length > BOARD_TEXT_MAX_CHARS ? text.slice(0, BOARD_TEXT_MAX_CHARS) : text;
}

function linetagParams(line: string): Record<string, string> {
    const params: Record<string, string> = {};
    for (const match of line.matchAll(LINETAG_PATTERN)) {
        for (const pair of match[1].split('&')) {
            if (!pair) { continue; }
            const eq = pair.indexOf('=');
            params[eq < 0 ? pair : pair.slice(0, eq)] = eq < 0 ? '' : pair.slice(eq + 1);
        }
    }
    return params;
}

/** an unticked task line as the text an operator reads: the box and every linetag taken off */
function taskText(line: string): string {
    return clip(line.replace(LINETAG_PATTERN, '').replace(/^\s*[+*-]\s+\[ \]\s*/, '').trim());
}

/**
 * Every `###` story of a board, top to bottom. An unticked task tagged `delegate=<repo>` is an open
 * convoy on its story, and one tagged `work=manual` is an operator step; a ticked task is neither.
 */
export function parseBoardStories(text: string): BoardStory[] {
    const stories: BoardStory[] = [];
    let current: BoardStory | undefined;
    for (const line of text.split('\n')) {
        const heading = STORY_HEADING.exec(line);
        if (heading) {
            const params = linetagParams(line);
            const title = clip(heading[1].replace(LINETAG_PATTERN, '').trim());
            current = {
                id: params.id || slugify(title),
                title,
                status: params.status ?? '',
                convoys: [],
                operator_steps: [],
                sent: params.sent !== undefined,
                markers: (params.coord ?? '').split(',').map(host => host.trim()).filter(host => host.length > 0),
                open_question: false,
                blocked: false,
            };
            stories.push(current);
        } else if (current) {
            if (OPEN_TASK.test(line)) {
                const params = linetagParams(line);
                if (params.delegate) { current.convoys.push(clip(params.delegate)); }
                if (params.work === 'manual') { current.operator_steps.push(taskText(line)); }
            } else if (OPEN_QUESTION_LINE.test(line)) {
                current.open_question = true;
            } else if (BLOCKED_NOTE_LINE.test(line)) {
                current.blocked = true;
            }
        }
    }
    return stories;
}

/**
 * What the board alone cannot say about where the lines fall, read from the coordinator's own files and
 * git. Every field is optional: with none, the lines come from the board's text alone.
 * - ready_ids: the stories of a ready marker that is not yet pushed, empty once it is
 * - in_flight: the stories the coordinator's assignment ledger shows in flight
 * - waiting_questions: the texts of the coordinator's open questions, which park the stories they name
 * - machine: the machine the coordinator builds on, when known, which a `coord=` tag is checked against
 */
export interface BoardLineFacts {
    ready_ids?: ReadonlyArray<string>;
    in_flight?: ReadonlyArray<string>;
    waiting_questions?: ReadonlyArray<string>;
    machine?: string;
}

// a machine name as a `coord=` tag spells it: the first label of the host name
function shortMachine(name: string): string {
    return name.trim().toLowerCase().split('.')[0];
}

/** whether a story's `coord=` tag names machines that leave out this one; a tag that names none, or an unknown machine, excludes nothing */
function excludesMachine(markers: ReadonlyArray<string>, machine: string | undefined): boolean {
    if (markers.length === 0 || !machine) { return false; }
    return !markers.map(shortMachine).includes(shortMachine(machine));
}

/** whether a story id appears whole in the text, a hyphen counting as part of a slug so `a-b` does not name `a` */
function namedWhole(id: string, text: string): boolean {
    return new RegExp(`(^|[^a-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9-])`).test(text);
}

/**
 * Whether a coordinator left to run would build this story: it was handed over (a `sent` linetag), is a
 * delegated story (a `delegated-` id) or is the story its ledger shows in flight, and is not waiting on the
 * operator or the gate. A story at `doing` that is none of those does not count. A story at `code-review`
 * or `testing` is left out, and so is a parked one: an open question or a blocked note, an open manual
 * task, an open delegated task, an id named whole in an open question of the coordinator, or (for a story
 * that is not in flight) a `coord=` tag that leaves out the coordinator's machine.
 */
export function isBuildable(story: Pick<BoardStory, 'id' | 'status' | 'sent' | 'open_question' | 'blocked' | 'convoys' | 'operator_steps' | 'markers'>, facts: BoardLineFacts = {}): boolean {
    if (REVIEW_STATUSES.includes(story.status)) { return false; }
    const in_flight = facts.in_flight?.includes(story.id) ?? false;
    if (!in_flight && !story.sent && !story.id.startsWith(DELEGATED_ID_PREFIX)) { return false; }
    if (!in_flight && excludesMachine(story.markers, facts.machine)) { return false; }
    if (story.open_question || story.blocked || story.operator_steps.length > 0 || story.convoys.length > 0) { return false; }
    return !namedWhole(story.id, (facts.waiting_questions ?? []).join('\n'));
}

/** whether a story has passed the release gate: the coordinator's unpushed ready marker names it, or it sits at `code-review` or `testing` */
export function isShippable(story: Pick<BoardStory, 'id' | 'status'>, ready_ids: ReadonlyArray<string>): boolean {
    return REVIEW_STATUSES.includes(story.status) || ready_ids.includes(story.id);
}

/**
 * How many stories sit at or above each line, 0 when a line marks none. The build line is the last
 * buildable story, whichever way the board is ordered between them. The ship line is the end of the
 * unbroken run of shippable stories from the top of the board, so everything above it has passed the
 * release gate, and it is 0 (no line) when the first story has not.
 */
export function boardLinePositions(stories: ReadonlyArray<BoardStory>, facts: BoardLineFacts = {}): { build_after: number; ship_after: number } {
    let build_after = 0;
    stories.forEach((story, index) => {
        if (isBuildable(story, facts)) { build_after = index + 1; }
    });
    let ship_after = 0;
    while (ship_after < stories.length && isShippable(stories[ship_after], facts.ready_ids ?? [])) { ship_after += 1; }
    return { build_after, ship_after };
}

/**
 * Whether a commit sha is the same commit as another, either of them possibly abbreviated: one is a prefix
 * of the other, and neither is shorter than seven digits.
 */
export function sameCommit(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b || a.length < 7 || b.length < 7) { return false; }
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left.startsWith(right) || right.startsWith(left);
}

/**
 * What git says about a repository's branch against its upstream.
 * - has_upstream: whether the branch tracks a remote branch
 * - ahead: commits on the branch not on its upstream
 * - upstream_sha: the commit the upstream branch points at
 * - pending_shas: the shas of the commits not on the upstream, newest first
 * - pending_complete: whether pending_shas is the whole list, so a sha missing from it is not pending
 */
export interface PushState {
    has_upstream: boolean;
    ahead?: number;
    upstream_sha?: string;
    pending_shas?: ReadonlyArray<string>;
    pending_complete?: boolean;
}

/**
 * Whether a ready marker's commit has been pushed. It has when the branch has an upstream and nothing
 * ahead of it, when the marker is the upstream's own commit, or when a complete list of the unpushed
 * commits leaves it out. When git cannot say (no state, no upstream, an incomplete list, a marker with no
 * sha) it has not, so the marker still counts.
 */
export function isMarkerPushed(marker_sha: string, state: PushState | undefined): boolean {
    if (!state) { return false; }
    if (state.has_upstream && (state.ahead ?? 0) === 0) { return true; }
    if (sameCommit(marker_sha, state.upstream_sha)) { return true; }
    return !!state.pending_complete && !!state.pending_shas && marker_sha.length >= 7 && !state.pending_shas.some(sha => sameCommit(marker_sha, sha));
}

/** the board a coordinator's repository keeps: the first `docstech/users/<name>/todo.md` under it, in path order */
export function boardDocFor(story_docs: ReadonlyArray<StoryDocument>, repo_relative: string): StoryDocument | undefined {
    const base = repo_relative ? `${repo_relative}/` : '';
    const boards = story_docs
        .filter(doc => doc.doc_path.startsWith(`${base}docstech/users/`) && /^[^/]+\/todo\.md$/.test(doc.doc_path.slice(`${base}docstech/users/`.length)))
        .sort((a, b) => (a.doc_path < b.doc_path ? -1 : a.doc_path > b.doc_path ? 1 : 0));
    return boards[0];
}

/**
 * The coordinator rows for the coordinator entries placed in the open folder, in name order. An entry that
 * is not a coordinator, or whose name or machine is not safe to address, is left out. Each row carries
 * its repository's board stories, which the card send action picks its story from.
 */
export function coordinatorsFrom(agents: ReadonlyArray<ResolvedRegistryAgent>, story_docs: ReadonlyArray<StoryDocument>): ActivityCoordinator[] {
    const rows: ActivityCoordinator[] = [];
    for (const agent of agents) {
        const machine = agent.machine ?? '';
        if (!isCoordinatorEntry(agent) || !isSafeCoordinatorName(agent.agent) || !isSafeCoordinatorName(machine)) { continue; }
        const board = boardDocFor(story_docs, agent.repo_relative);
        const stories = board ? parseBoardStories(board.text) : [];
        rows.push({
            agent: agent.agent,
            vendor: agent.vendor,
            state: agent.state,
            story: agent.story,
            machine,
            open_convoys: agent.open_convoys ?? [],
            root_relative: agent.repo_relative,
            board_doc_path: board?.doc_path,
            board_stories: stories.slice(0, COORDINATOR_BOARD_MAX_STORIES).map(({ id, title, status, convoys, operator_steps }) => ({ id, title, status, convoys, operator_steps })),
        });
    }
    return rows.sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
}

// a story board file, as opposed to done.md or any other document
const TODO_BOARD_PATH = /(^|\/)docstech\/users\/[^/]+\/todo\.md$/;

/**
 * Where the build and ship lines fall on every `docstech/users/<name>/todo.md` among the documents, in
 * path order. Each entry is computed from the board's own text, so it needs no coordinator and no agent
 * session. A board with no story gets no entry. `facts_by_doc` holds what the coordinator's files and git
 * add for each board, keyed by its document path; a board missing from it has none, which leaves the
 * lines to what the board says alone: only sent and delegated stories build, and only the `code-review`
 * and `testing` statuses ship.
 */
export function boardLinesFrom(story_docs: ReadonlyArray<StoryDocument>, facts_by_doc: ReadonlyMap<string, BoardLineFacts> = new Map()): ActivityBoardLines[] {
    const entries: ActivityBoardLines[] = [];
    for (const doc of story_docs) {
        if (!TODO_BOARD_PATH.test(doc.doc_path)) { continue; }
        const stories = parseBoardStories(doc.text);
        if (stories.length === 0) { continue; }
        const { build_after, ship_after } = boardLinePositions(stories, facts_by_doc.get(doc.doc_path) ?? {});
        const story_ids = stories.slice(0, COORDINATOR_BOARD_MAX_STORIES).map(story => story.id);
        entries.push({ doc_path: doc.doc_path, story_ids, build_after: Math.min(build_after, story_ids.length), ship_after: Math.min(ship_after, story_ids.length) });
    }
    return entries.sort((a, b) => (a.doc_path < b.doc_path ? -1 : a.doc_path > b.doc_path ? 1 : 0));
}

/** the compact UTC stamp an envelope id starts with, such as `20261111T093000Z` */
export function compactStamp(now: Date): string {
    return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * The fields of an envelope to build. A request carries a message; a vendor change carries the vendor
 * name as thinkersync spells it.
 * - rand_hex: the id's random suffix, six hex digits
 */
export type CoordinatorEnvelopeFields = { agent: string; machine: string; now: Date; rand_hex: string } & (
    | { kind?: 'request'; body: string }
    | { kind: 'vendor'; vendor: string }
);

/**
 * The envelope that asks a coordinator for something, or undefined when the agent or machine is not
 * safe to address, the random suffix is malformed, a request's message is empty or over the bound, or a
 * vendor change names a vendor outside COORDINATOR_VENDOR_NAMES. A request's message is carried as
 * typed, minus surrounding whitespace. A vendor change is the envelope kind `vendor` with the body
 * `{ "vendor": "<name>" }`; the receiving coordinator treats it as an update.
 */
export function buildCoordinatorEnvelope(fields: CoordinatorEnvelopeFields): CoordinatorEnvelope | undefined {
    if (!isSafeCoordinatorName(fields.agent) || !isSafeCoordinatorName(fields.machine) || !/^[0-9a-f]{6}$/.test(fields.rand_hex)) { return undefined; }
    const id = `${compactStamp(fields.now)}-${fields.rand_hex}`;
    const base: CoordinatorEnvelopeBase = {
        v: ENVELOPE_VERSION,
        id,
        sender: ENVELOPE_SENDER,
        sender_kind: ENVELOPE_SENDER_KIND,
        origin_machine: fields.machine,
        target: `${fields.agent}@${fields.machine}`,
        task_id: id,
        reply_to: '',
        state: 'submitted',
        created_at: fields.now.toISOString().replace(/\.\d+Z$/, 'Z'),
    };
    if (fields.kind === 'vendor') {
        if (!isCoordinatorVendorName(fields.vendor)) { return undefined; }
        return { ...base, kind: 'vendor', body: { vendor: fields.vendor } };
    }
    const body = fields.body.trim();
    if (body.length === 0 || body.length > COORDINATOR_SEND_BODY_MAX_CHARS) { return undefined; }
    return { ...base, kind: 'request', body };
}

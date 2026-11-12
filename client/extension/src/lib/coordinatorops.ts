import type { ActivityCoordinator, ActivityCoordinatorStory } from '../types/AgentActivity';
import type { ResolvedRegistryAgent } from './agentregistryops';
import type { StoryDocument } from './agentstorybindingops';

/**
 * Coordinators beside boards: the pure half. A coordinator is a long-lived agent that owns one
 * repository's board, registered in the thinkersync agent registry. This module turns registry
 * entries and the repository's own `todo.md` into the rows a view lists, rewrites a board's
 * `[](?coord=<host>)` target marker, and builds the envelope a send writes into the agent's mailbox.
 *
 * NoteThink only ever shows and asks: it never starts, stops or restarts an agent. The two things it
 * writes are both explicit user actions: an envelope dropped in an agent's inbox, and the target marker
 * on the board. The envelope's layout is thinkersync's public interface, version 0: one JSON file named
 * `<id>.json` in `mailboxes/<agent>/inbox/` under the thinkersync home, whose id is a compact UTC stamp
 * and a short random suffix.
 *
 * The target marker is the linetag key `coord` on a story heading, naming a host; one host has one
 * marker, and the range the host's coordinator may work is the top of the board down to the lowest
 * story carrying it.
 */

// the registry kinds listed as coordinators; an entry naming none is read as one
export const COORDINATOR_AGENT_KIND = 'coordinator';

// an agent or machine name is a mailbox path segment and half an envelope target, so it is pattern-checked first
const SAFE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

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

/**
 * One story of a board as the target line sees it, with where its heading sits.
 * - markers: the hosts named by the heading's `coord` linetag
 * - line_start: offset of the heading line's first character
 * - line: the heading line itself
 */
export interface BoardStory extends ActivityCoordinatorStory {
    markers: string[];
    line_start: number;
    line: string;
}

/** a replacement of one span of a document's text, the shape the panel's edit path applies */
export interface CoordinatorTextChange {
    from: number;
    to: number;
    insert: string;
}

/**
 * The fields of an envelope NoteThink writes, in thinkersync's version 0 layout.
 * - sender / sender_kind: who sent it; a send here is the operator's own explicit action
 * - origin_machine: the machine the send was made from, which is the agent's own machine, since the mailbox is read from the host serving the workspace
 * - target: `<agent>@<machine>`
 * - task_id: the envelope's own id, since a send starts a new task
 */
export interface CoordinatorEnvelope {
    v: typeof ENVELOPE_VERSION;
    id: string;
    sender: string;
    sender_kind: string;
    origin_machine: string;
    target: string;
    task_id: string;
    reply_to: string;
    kind: 'request';
    state: 'submitted';
    body: string;
    created_at: string;
}

/** whether a name is safe to use as a mailbox directory and an envelope target half */
export function isSafeCoordinatorName(name: string): boolean {
    return SAFE_NAME_PATTERN.test(name);
}

/** the path segments of an agent's inbox below the thinkersync home; the agent's name must already be safe */
export function mailboxInboxSegments(agent: string): string[] {
    return ['mailboxes', agent, 'inbox'];
}

/** whether a registry entry is one of the coordinators a view lists: an entry naming no kind is read as one, an overseer or a helper session is not */
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

function markerHosts(coord: string | undefined): string[] {
    return coord ? coord.split(',').map(host => host.trim()).filter(host => host.length > 0) : [];
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
    let offset = 0;
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
                markers: markerHosts(params.coord),
                line_start: offset,
                line,
            };
            stories.push(current);
        } else if (current && OPEN_TASK.test(line)) {
            const params = linetagParams(line);
            if (params.delegate) { current.convoys.push(clip(params.delegate)); }
            if (params.work === 'manual') { current.operator_steps.push(taskText(line)); }
        }
        offset += line.length + 1;
    }
    return stories;
}

/** how many stories sit at or above the lowest story carrying this host's marker, 0 when none carries it */
export function markerAfter(stories: ReadonlyArray<Pick<BoardStory, 'markers'>>, host: string): number {
    let found = 0;
    stories.forEach((story, index) => { if (story.markers.includes(host)) { found = index + 1; } });
    return found;
}

/** a heading line with its `coord` linetag set to these hosts: the key leaves its tag when the list is empty, and the tag leaves the line when nothing else is in it */
function withMarkerHosts(line: string, hosts: string[]): string {
    const tags = [...line.matchAll(LINETAG_PATTERN)];
    const holder = tags.find(tag => tag[1].split('&').some(pair => pair.startsWith('coord='))) ?? tags[tags.length - 1];
    const coord_pair = hosts.length > 0 ? `coord=${hosts.join(',')}` : '';
    if (!holder) { return coord_pair ? `${line.replace(/\s+$/, '')} [](?${coord_pair})` : line; }
    const pairs = holder[1].split('&').filter(pair => pair.length > 0 && !pair.startsWith('coord='));
    if (coord_pair) { pairs.push(coord_pair); }
    const before = line.slice(0, holder.index);
    const after = line.slice(holder.index + holder[0].length);
    if (pairs.length > 0) { return `${before}[](?${pairs.join('&')})${after}`; }
    const tail = after.trim();
    return `${before.replace(/ +$/, '')}${tail ? ` ${tail}` : ''}`;
}

/**
 * The edits that leave this host's marker on the `after`th story of a board, and on no other: `after`
 * of 0 takes the marker off the board. One host has one marker, so every heading carrying the host
 * loses it first. Only the heading lines that change are touched, so the rest of the file, and any
 * other host's marker, stays byte for byte. No edit comes back when the marker already sits there or
 * `after` names no story.
 */
export function coordMarkerChanges(text: string, host: string, after: number): CoordinatorTextChange[] {
    const stories = parseBoardStories(text);
    if (!Number.isInteger(after) || after < 0 || after > stories.length || !isSafeCoordinatorName(host)) { return []; }
    const changes: CoordinatorTextChange[] = [];
    stories.forEach((story, index) => {
        const has = story.markers.includes(host);
        const wants = index === after - 1;
        if (has === wants) { return; }
        const hosts = wants ? [...story.markers, host] : story.markers.filter(marker => marker !== host);
        changes.push({ from: story.line_start, to: story.line_start + story.line.length, insert: withMarkerHosts(story.line, hosts) });
    });
    return changes;
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
 * The coordinator rows for the registry entries placed in the open folder, in name order. An entry that
 * is not a coordinator, or whose name or machine is not safe to address, is left out. Each row carries
 * its repository's board stories, so the target line can be drawn without another read.
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
            version: agent.binary_version ?? '',
            machine,
            open_convoys: agent.open_convoys ?? [],
            root_relative: agent.repo_relative,
            board_doc_path: board?.doc_path,
            board_stories: stories.slice(0, COORDINATOR_BOARD_MAX_STORIES).map(({ id, title, status, convoys, operator_steps }) => ({ id, title, status, convoys, operator_steps })),
            marker_after: markerAfter(stories, machine),
        });
    }
    return rows.sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
}

/** the compact UTC stamp an envelope id starts with, such as `20261111T093000Z` */
export function compactStamp(now: Date): string {
    return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * The envelope that asks a coordinator for something, or undefined when the agent or machine is not
 * safe to address or the message is empty or over the bound. The message is carried as typed, minus
 * surrounding whitespace.
 * - rand_hex: the id's random suffix, six hex digits
 */
export function buildCoordinatorEnvelope(fields: { agent: string; machine: string; body: string; now: Date; rand_hex: string }): CoordinatorEnvelope | undefined {
    const body = fields.body.trim();
    if (!isSafeCoordinatorName(fields.agent) || !isSafeCoordinatorName(fields.machine)) { return undefined; }
    if (body.length === 0 || body.length > COORDINATOR_SEND_BODY_MAX_CHARS || !/^[0-9a-f]{6}$/.test(fields.rand_hex)) { return undefined; }
    const id = `${compactStamp(fields.now)}-${fields.rand_hex}`;
    return {
        v: ENVELOPE_VERSION,
        id,
        sender: ENVELOPE_SENDER,
        sender_kind: ENVELOPE_SENDER_KIND,
        origin_machine: fields.machine,
        target: `${fields.agent}@${fields.machine}`,
        task_id: id,
        reply_to: '',
        kind: 'request',
        state: 'submitted',
        body,
        created_at: fields.now.toISOString().replace(/\.\d+Z$/, 'Z'),
    };
}

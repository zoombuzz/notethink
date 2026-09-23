import type { ActivityStoryRef } from '../types/AgentActivity';
import type { AgentToolInvocationEdit } from './vendors/agentvendorops';

/**
 * Binding a session to a story: a session binds to every story whose section one of its own write
 * calls changed - a status change, a task tick, a moved section. A session whose write calls never
 * touch a board, or whose edits cannot be located in one, binds to nothing: it is drawn on a virtual
 * note rather than guessed onto a story.
 *
 * Locating an edit: for each write call's own located edit (`AgentToolInvocationEdit`, carried by a
 * vendor reader per `agentvendorops.ts`), this searches the target board's CURRENT text for the
 * edit's `new_text`, falling back to individual "distinctive" lines of it when the whole snippet is
 * not found verbatim (a later edit can have altered surrounding lines), and only then to `old_text`
 * the same way. The match's enclosing `##`-`####` heading is the bound story. If the edit's own text
 * contains a heading line itself (a section moved wholesale, e.g. into `done.md`), that heading's
 * story binds too, independently of whether the edit's location could also be found. A call whose
 * edit is not found in its own target document is retried against that document's sibling board
 * (`todo.md`<->`done.md` in the same directory), so a story moved to `done.md` in the same write
 * keeps its credit rather than losing its binding the moment it left `todo.md`. A `whole_file` call
 * (a `Write`, or an `apply_patch` "Add File") carries no located content and binds nothing.
 *
 * The story key: a heading's stable id is its authored `[](?id=slug)` linetag value where one exists,
 * else the slug `storyStableIdSlug` (webview `lib/noteops.ts`) derives from the stripped headline
 * text, so an untagged heading still gets a stable, joinable key rather than being invisible to the
 * binder. `slugify`/`stripHeadlineLinetags`/`storyStableIdSlug` below are a byte-for-byte mirror of
 * that module's own functions of the same name and MUST be kept identical to them: the extension and
 * the webview are separate webpack bundles with no shared module graph (globMatch.ts's header carries
 * the same convention), so there is no import path from here to there, and a drift between the two
 * makes the webview's card key ($doc_path, id) disagree with what this binder produces for the same
 * heading. `agentstorybindingops.test.ts`'s "mirrors the webview's slug derivation" suite is the check.
 *
 * Join key survives a todo.md -> done.md move: `ActivityStoryRef` stays `{doc_path, id}` because the
 * webview's own card key (`storyKeyForNote`, `agentactivityops.ts`) is built the same way, from the
 * note's own current document path and stable id, not from where a session's write call happened to
 * land. A session bound here to `{done.md, some-id}` therefore joins the card the webview draws for
 * the note now living in `done.md` under that id, which is exactly the note whose section moved.
 */

/**
 * One board document the binder searches.
 * - doc_path: workspace-relative posix path, exactly as a note's own origin carries it
 */
export interface StoryDocument {
    doc_path: string;
    text: string;
}

/**
 * One write call this binder can use: the board-relative path it targeted, and its own located edits
 * (absent or empty when the call carried none).
 * - whole_file: a whole-file write (a Write, or an apply_patch Add File) carries no locatable content
 *   and binds nothing, whatever `edits` happens to hold
 */
export interface StoryBindingWriteCall {
    doc_path: string;
    edits?: ReadonlyArray<AgentToolInvocationEdit>;
    whole_file?: boolean;
}

// --- mirrored from client/webview/src/notethink-views/src/lib/noteops.ts ---

function slugify(text: string): string {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function stripHeadlineLinetags(headline_raw: string): string {
    let stripped = headline_raw.replace(/^#+\s*/, '');
    const trailing = /\s*\[[^\]]*\]\(\?[^)]*\)\s*$/;
    while (trailing.test(stripped)) {
        stripped = stripped.replace(trailing, '');
    }
    return stripped.trim();
}

/** the story-level stable id for one heading line: its authored id if it has one, else the slug of its stripped headline text, else a position fallback - mirrors `storyStableIdSlug` exactly (see module header) */
function storyStableIdSlug(heading_raw: string, id_value: string | undefined, line_index_1based: number): string {
    if (id_value) { return id_value; }
    const stripped = stripHeadlineLinetags(heading_raw);
    return slugify(stripped) || `headline-${line_index_1based}`;
}

// --- end mirrored section ---

function parseLinetag(query: string): Record<string, string> {
    const params: Record<string, string> = {};
    for (const pair of query.split('&')) {
        const [key, value] = pair.split('=');
        if (key) { params[key] = value ?? ''; }
    }
    return params;
}

// one heading line found in a board document: its stable id (authored or derived), the 0-based line it sits on, and whether the id came from an authored linetag rather than a derived fallback
interface DocHeading {
    id: string;
    line_index: number;
    id_authored: boolean;
}

// a `##` to `####` markdown heading, with or without a trailing `[](?...)` linetag block - untagged headings (a backlog story with no status set yet) are real headings too
const HEADING_LINE = /^#{2,4}\s+(.*)$/;
const TRAILING_LINETAG = /\[\]\(\?([^)]*)\)\s*$/;
// an opening linetag marker with no matching TRAILING_LINETAG close is not an untagged heading, it is a truncated fragment: Claude Code's own Edit old_string/new_string is trimmed to only as much of a line as uniqueness needs, and can end mid-linetag (a heading's `[](?status=...&id=...)` linetag with no closing paren)
const OPEN_LINETAG = /\[\]\(\?/;

/** every heading in one board document, in file order, each carrying the stable id a session binds to it under. A line that opens a linetag but never closes it is a truncated fragment, not a real heading (see OPEN_LINETAG), and is skipped rather than slugified into a nonsense id. */
function headingsInDoc(text: string): DocHeading[] {
    const lines = text.split('\n');
    const headings: DocHeading[] = [];
    for (let i = 0; i < lines.length; i++) {
        const match = HEADING_LINE.exec(lines[i]);
        if (!match) { continue; }
        const linetag_match = TRAILING_LINETAG.exec(match[1]);
        if (!linetag_match && OPEN_LINETAG.test(match[1])) { continue; }
        const id_value = linetag_match ? parseLinetag(linetag_match[1]).id : undefined;
        headings.push({ id: storyStableIdSlug(lines[i], id_value, i + 1), line_index: i, id_authored: id_value !== undefined });
    }
    return headings;
}

/** the nearest heading at or before this line, or undefined when the line sits above every heading in the document (a preamble) */
function enclosingHeading(headings: ReadonlyArray<DocHeading>, line_index: number): DocHeading | undefined {
    let best: DocHeading | undefined;
    for (const heading of headings) {
        if (heading.line_index > line_index) { break; }
        best = heading;
    }
    return best;
}

function isBoardPath(path: string): boolean {
    return path.endsWith('/todo.md') || path.endsWith('/done.md') || path === 'todo.md' || path === 'done.md';
}

/** the sibling board in the same directory (todo.md <-> done.md), so a story moved between them in the same write is still found; undefined for a path this binder does not recognise as a board at all */
function siblingBoardPath(doc_path: string): string | undefined {
    if (doc_path.endsWith('/todo.md')) { return `${doc_path.slice(0, -'/todo.md'.length)}/done.md`; }
    if (doc_path.endsWith('/done.md')) { return `${doc_path.slice(0, -'/done.md'.length)}/todo.md`; }
    if (doc_path === 'todo.md') { return 'done.md'; }
    if (doc_path === 'done.md') { return 'todo.md'; }
    return undefined;
}

function documentAt(story_docs: ReadonlyArray<StoryDocument>, doc_path: string): StoryDocument | undefined {
    return story_docs.find(doc => doc.doc_path === doc_path);
}

// a line short enough to be noise (a bare task-list marker, a blank line) is skipped as a fallback locator, since it is likely to match somewhere irrelevant
const MIN_DISTINCTIVE_LINE_LENGTH = 12;
// this workspace's own story convention repeats a small set of bare section-divider bullets across nearly every story ("+ goal", "+ scope", "+ background", "+ out of scope", "+ acceptance criteria", STORY_STANDARDS.md > Content shape): long enough to clear MIN_DISTINCTIVE_LINE_LENGTH but never distinctive on their own, so a fallback match on one almost always lands on the wrong story - a divider bullet inserted by one story's own edit can fallback-match an identically-worded divider under a different, unrelated story elsewhere in the board. A bare 1-3 word bullet with no digit, backtick or colon-then-content is this shape; a real content bullet is either longer or carries something specific (a number, a code ref, a "label: detail" split) that survives this filter.
const GENERIC_SECTION_BULLET = /^\+\s+(?:[a-z][a-z'-]*\s*){1,3}:?$/i;

function locateInText(text: string, snippet: string): number | undefined {
    if (!snippet) { return undefined; }
    const index = text.indexOf(snippet);
    if (index === -1) { return undefined; }
    return text.slice(0, index).split('\n').length - 1;
}

/** the snippet's own lines, trimmed, long enough and specific enough to be a fallback locator - neither too short nor one of this workspace's own generic section-divider bullets (see GENERIC_SECTION_BULLET's header) */
function distinctiveLines(snippet: string): string[] {
    return snippet.split('\n').map(line => line.trim()).filter(line => line.length >= MIN_DISTINCTIVE_LINE_LENGTH && !GENERIC_SECTION_BULLET.test(line));
}

/** where in `doc.text` one edit can be found: its `new_text` whole, then line by line, then `old_text` the same way - undefined when none of that locates anything */
function locateEditInDoc(doc: StoryDocument, edit: AgentToolInvocationEdit): number | undefined {
    for (const candidate of [edit.new_text, edit.old_text]) {
        if (candidate === undefined) { continue; }
        const direct = locateInText(doc.text, candidate);
        if (direct !== undefined) { return direct; }
        for (const line of distinctiveLines(candidate)) {
            const found = locateInText(doc.text, line);
            if (found !== undefined) { return found; }
        }
    }
    return undefined;
}

/**
 * Every story one located edit binds to: headings carried inside its own text ("the edited text
 * itself contains a story heading line", module header - `headingsInDoc` reads a heading line the
 * same way whether `text` is a whole document or a short snippet), plus the one enclosing heading at
 * the first document the edit's own content is found in.
 *
 * A heading match that is BOTH the candidate's own last line AND has no authored id is excluded here:
 * an Edit's old_string/new_string is trimmed to only as much of a line as uniqueness needs, so a large
 * insertion's boundary can end exactly at an unrelated heading's TITLE, with its linetag (and so its
 * real id) left outside the edited region entirely - a bare heading title with no trailing `[](?...)`
 * at all, because the edit only needed that much text to mark where new content stops. Slugifying
 * that bare title fragment derives a wrong id instead of the heading's real authored one. A real,
 * freshly-authored heading is not excluded by this: it is either not the snippet's last line (a new
 * story is essentially never authored with nothing below it) or, more directly, its own authored id
 * survives the exclusion regardless of position.
 */
function storiesForEdit(call_doc_path: string, edit: AgentToolInvocationEdit, story_docs: ReadonlyArray<StoryDocument>): ActivityStoryRef[] {
    const refs: ActivityStoryRef[] = [];
    for (const candidate of [edit.new_text, edit.old_text]) {
        if (candidate === undefined) { continue; }
        const last_line_index = candidate.split('\n').length - 1;
        for (const heading of headingsInDoc(candidate)) {
            if (heading.line_index === last_line_index && !heading.id_authored) { continue; }
            refs.push({ doc_path: call_doc_path, id: heading.id });
        }
    }
    const sibling = siblingBoardPath(call_doc_path);
    for (const doc_path of [call_doc_path, sibling].filter((path): path is string => path !== undefined)) {
        const doc = documentAt(story_docs, doc_path);
        if (!doc) { continue; }
        const line_index = locateEditInDoc(doc, edit);
        if (line_index === undefined) { continue; }
        const heading = enclosingHeading(headingsInDoc(doc.text), line_index);
        if (heading) { refs.push({ doc_path, id: heading.id }); }
        break;
    }
    return refs;
}

/**
 * Every story ONE write call binds to on its own, given the current text of every story board the
 * host knows about: headings named inside the call's own edited text, plus the section each of its
 * edits' own location encloses (see module header for exactly how a call is located). A call whose
 * path is not a board, or that carried no locatable content (`whole_file`, or no `edits`), binds to
 * nothing. Deduplicated by `{doc_path, id}` within this one call, in the order its own edits found
 * them.
 *
 * Exported (alongside `bindSessionToStory`, which folds this over a whole session) for a caller that
 * needs per-call rather than per-session granularity: attributing a session's priced usage to a story
 * by the turn it happened in (`AgentAnalyser.ts`) needs to know which call, at which timestamp, bound
 * to which story - the session-wide union alone cannot answer that.
 */
export function storiesForWriteCall(call: StoryBindingWriteCall, story_docs: ReadonlyArray<StoryDocument>): ActivityStoryRef[] {
    if (!isBoardPath(call.doc_path) || call.whole_file) { return []; }
    const bound = new Map<string, ActivityStoryRef>();
    for (const edit of call.edits ?? []) {
        for (const ref of storiesForEdit(call.doc_path, edit, story_docs)) {
            bound.set(`${ref.doc_path}\u0000${ref.id}`, ref);
        }
    }
    return [...bound.values()];
}

/**
 * The stories one session binds to, given every workspace-relative write call its own tool use made
 * and the current text of every story board the host knows about. A session whose write calls touch
 * no story board, or whose calls carry no locatable content, binds to nothing: it is drawn on a
 * virtual note rather than guessed onto a story. Every story a session touched binds, in the order its
 * calls found them, deduplicated by `{doc_path, id}`.
 */
export function bindSessionToStory(write_calls: ReadonlyArray<StoryBindingWriteCall>, story_docs: ReadonlyArray<StoryDocument>): ActivityStoryRef[] {
    const bound = new Map<string, ActivityStoryRef>();
    for (const call of write_calls) {
        for (const ref of storiesForWriteCall(call, story_docs)) {
            bound.set(`${ref.doc_path}\u0000${ref.id}`, ref);
        }
    }
    return [...bound.values()];
}

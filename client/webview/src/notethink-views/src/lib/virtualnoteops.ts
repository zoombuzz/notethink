import Debug from "debug";
import type { NoteOrigin, NoteProps } from "../types/NoteProps";
import type { ViewApi } from "../types/ViewProps";

const debug = Debug("nodejs:notethink-views:virtualnoteops");

/**
 * Virtual notes: notes no markdown file holds, carrying the same NoteProps shape as a parsed one.
 *
 * A card draws one note, so anything that has to be drawn as a card but has no story behind it needs
 * a note to hang off. An agent that declared it is on no story is the first such thing. The
 * abstraction is deliberately central: GenericView admits virtual notes once, on behalf of every
 * view, before the view context is derived, so no view branches on the distinction and none of them
 * can tell a virtual note from a parsed one.
 *
 * The single correctness property, and the reason for most of what follows, is that a virtual note
 * must never reach a write path. A drag that wrote one into a user's markdown would be data
 * corruption, so the refusals here are layered rather than singular:
 *
 * 1. `locked` is set on every admitted virtual note, which is the existing gate the shared drag
 *    adapter already checks before it builds a kanban or line drop payload.
 * 2. `origin.doc_path` is a reserved sentinel, so nothing can fall back to the view's real doc path
 *    the way a note with no origin would.
 * 3. `guardVirtualNoteWrites` wraps the view's handler surface, dropping any message naming the
 *    sentinel and any `revealNote` of a virtual note, before the handlers reach useViewHandlers.
 * 4. The note carries no body text, so the checkbox edit path computes no changes from it.
 *
 * Identity: a virtual stable_id is `nt-virtual:<namespace>:<key>`. It cannot collide with a parsed
 * note's, because every parsed stable_id begins with a doc_id, and a doc_id is the 64-character
 * lowercase hex SHA-256 of the document's path (`generateIdentifier` in the extension host's
 * cryptoops). `nt-virtual` is neither 64 characters long nor hex, so no parsed story
 * (`<doc_id>:<slug>`), descendant (`<story_stable_id>:<child_path>`) or root-hung note
 * (`<doc_id>:__root__:<child_path>`) can produce one.
 */

// the reserved namespace every virtual identifier is built from; not hex and not 64 characters, so it cannot be a doc_id
export const VIRTUAL_NOTE_ID_PREFIX = 'nt-virtual:';
export const VIRTUAL_NOTE_DOC_ID = 'nt-virtual';

// the sentinel a virtual note's origin carries in place of a file path, so no write path can fall back to a real one
export const VIRTUAL_NOTE_DOC_PATH = 'nt-virtual:/no-file';

/*
 * Synthetic source offsets, far past the end of any markdown file a workspace holds. The offset-based
 * caret matcher clamps the caret to the rendered root's end before it walks the tree, so a range this
 * far out can never be resolved by a real caret; the stride keeps each virtual note's range disjoint
 * from its siblings'.
 */
export const VIRTUAL_NOTE_POSITION_BASE = 1_000_000_000;
export const VIRTUAL_NOTE_POSITION_STRIDE = 1_000;

/**
 * VirtualNoteSpec is everything a caller supplies to mint one virtual note.
 * - namespace: the kind of virtual note, which with `key` forms its stable_id; `agent` is the first
 * - key: unique within the namespace for as long as the thing it stands for exists, since it is the identity React keys and FLIP rect-capture match on across updates
 * - headline: plain text drawn as the note's headline, rendered as text and never as markdown, because it carries a name this codebase did not author
 * - project: the project name the note belongs to, which colours its origin pill; omitted leaves the note without a project link
 */
export interface VirtualNoteSpec {
    namespace: string;
    key: string;
    headline: string;
    project?: string;
    project_hue?: number;
    project_label?: string;
}

/** the stable_id a virtual note of this namespace and key carries, and the only place that format is built */
export function virtualNoteStableId(namespace: string, key: string): string {
    return `${VIRTUAL_NOTE_ID_PREFIX}${namespace}:${key}`;
}

/** true when a stable_id was minted by virtualNoteStableId rather than derived from a parsed document */
export function isVirtualStableId(stable_id: string | undefined): boolean {
    return typeof stable_id === 'string' && stable_id.startsWith(VIRTUAL_NOTE_ID_PREFIX);
}

/** true when a path is the reserved sentinel rather than a path any file system could resolve */
export function isVirtualDocPath(path: unknown): boolean {
    return typeof path === 'string' && path.startsWith(VIRTUAL_NOTE_ID_PREFIX);
}

/** true when a note is virtual, judged on either half of its identity so a partially-copied note still reads as one */
export function isVirtualNote(note: NoteProps | undefined): boolean {
    if (!note) { return false; }
    return isVirtualStableId(note.stable_id) || isVirtualDocPath(note.origin?.doc_path);
}

/** the key a virtual note of this namespace was minted with, or undefined when the note belongs to another namespace */
export function virtualNoteKeyOf(note: NoteProps | undefined, namespace: string): string | undefined {
    const prefix = virtualNoteStableId(namespace, '');
    if (!note?.stable_id?.startsWith(prefix)) { return undefined; }
    return note.stable_id.slice(prefix.length);
}

/**
 * Mint one virtual note. The result satisfies NoteProps fully enough for every view, card and
 * traversal to treat it as ordinary: a heading with mdast children so the shared headline renderer
 * draws it, an origin so the project pill has a hue, and a position in the synthetic offset range.
 *
 * `seq`, `level`, `depth` and the final position are stamped by admitVirtualNotes against the tree
 * the note is about to join, because all four only mean anything relative to that tree.
 */
export function makeVirtualNote(spec: VirtualNoteSpec): NoteProps {
    const origin: NoteOrigin = {
        doc_id: VIRTUAL_NOTE_DOC_ID,
        doc_path: VIRTUAL_NOTE_DOC_PATH,
        project_hue: spec.project_hue,
        project_label: spec.project_label,
    };
    const position = { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } };
    return {
        seq: 0,
        level: 1,
        depth: 3,
        type: 'heading',
        stable_id: virtualNoteStableId(spec.namespace, spec.key),
        headline_raw: spec.headline,
        body_raw: '',
        locked: true,
        origin,
        position,
        children: [{ type: 'text', value: spec.headline, children: [], position }],
        children_body: [],
        child_notes: [],
    };
}

/** the highest seq in a note list, so an admitted note can be numbered past every parsed one and sort last */
function highestSeq(notes: ReadonlyArray<NoteProps>): number {
    let highest = 0;
    for (const note of notes) {
        if (note.seq > highest) { highest = note.seq; }
    }
    return highest;
}

/** stamp one virtual note into the tree it is joining: its number, its level, and its own slot in the synthetic offset range */
function stampVirtualNote(note: NoteProps, index: number, seq: number, level: number, depth: number): NoteProps {
    const start_offset = VIRTUAL_NOTE_POSITION_BASE + (index * VIRTUAL_NOTE_POSITION_STRIDE);
    const end_offset = start_offset + VIRTUAL_NOTE_POSITION_STRIDE - 1;
    const position = {
        start: { offset: start_offset, line: 1 },
        end: { offset: end_offset, line: 1 },
    };
    return {
        ...note,
        seq,
        level,
        depth,
        locked: true,
        position,
        children: note.children.map(child => ({ ...child, position })),
    };
}

/**
 * Admit virtual notes into a view's note set, once, on behalf of every view.
 *
 * Returns the input array unchanged (same identity, so the downstream sort memo does not churn) when
 * there is nothing to admit, and a new set otherwise. The notes are hung off the tree's root, which
 * is what every view lays out: the flat list feeds the kanban and line views, while the document view
 * renders the root's body, so an admitted note joins `child_notes` and `children_body` alike.
 *
 * Idempotent by stable_id, because a view type resolved through AutoView renders GenericView twice
 * over props that already carry the first pass's admissions.
 */
export function admitVirtualNotes(notes: Array<NoteProps> | undefined, virtual_notes: ReadonlyArray<NoteProps>): Array<NoteProps> | undefined {
    if (virtual_notes.length === 0) { return notes; }
    const existing = new Set((notes ?? []).map(note => note.stable_id).filter((id): id is string => id !== undefined));
    const admitting = virtual_notes.filter(note => note.stable_id !== undefined && !existing.has(note.stable_id));
    if (admitting.length === 0) { return notes; }
    const source = notes ?? [];
    const root = source.find(note => note.type === 'root') ?? source.find(note => note.seq === 0);
    const siblings = root?.child_notes ?? source.filter(note => note !== root);
    const level = siblings[0]?.level ?? 1;
    const depth = siblings[0]?.depth ?? 3;
    const first_seq = highestSeq(source) + 1;
    const stamped = admitting.map((note, index) => stampVirtualNote(note, index, first_seq + index, level, depth));
    debug('admitting %d virtual note(s) at level %d from seq %d', stamped.length, level, first_seq);
    if (!root) { return [...source, ...stamped]; }
    const admitted_root: NoteProps = {
        ...root,
        child_notes: [...(root.child_notes ?? []), ...stamped],
        children_body: [...(root.children_body ?? []), ...stamped],
    };
    for (const note of stamped) {
        note.parent_notes = [admitted_root];
    }
    return source.map(note => (note === root ? admitted_root : note)).concat(stamped);
}

/** every string on an outgoing message that could name a document: the top-level values plus the per-document change map's keys */
function candidateDocPaths(message: Record<string, unknown>): string[] {
    const paths: string[] = [];
    for (const value of Object.values(message)) {
        if (typeof value === 'string') { paths.push(value); }
    }
    const changes_by_doc = message.changes_by_doc;
    if (changes_by_doc !== null && typeof changes_by_doc === 'object') {
        paths.push(...Object.keys(changes_by_doc as Record<string, unknown>));
    }
    return paths;
}

/**
 * True when an outgoing extension message names the virtual sentinel anywhere a document path can
 * appear. Deliberately broad: the sentinel is reserved and must never leave the webview, so any
 * message carrying it is a bug in a caller rather than something to route around.
 */
export function messageTargetsVirtualDoc(message: unknown): boolean {
    if (message === null || typeof message !== 'object') { return false; }
    return candidateDocPaths(message as Record<string, unknown>).some(isVirtualDocPath);
}

/**
 * Wrap a view's handler surface so a virtual note cannot reach a write path through it. Applied by
 * GenericView to the props handed to useGenericView, which is upstream of every consumer: the click
 * dispatcher's own closures read the wrapped surface, as do the views, the cards and the drawers.
 *
 * Two handlers are guarded, and nothing else is: postMessage, which carries every edit and every
 * editor reveal, and revealNote, which resolves a note to a source range to jump to. The view-managed
 * state writers are left alone deliberately - they write stable_ids into webview state and never
 * touch a file, so focusing or expanding a virtual note is ordinary behaviour.
 *
 * A HANDLER THE SOURCE DOES NOT HAVE MUST STAY ABSENT, not become a key holding undefined. The two
 * are not the same thing downstream: useViewHandlers merges this surface over its own built handlers
 * with Object.assign, which copies an own key whose value is undefined and so would overwrite a real
 * implementation with nothing. `revealNote` is built there rather than passed in, so a spread that
 * minted the key unconditionally silently disabled it and every jump to a story stopped working. That
 * is why the guarded object is assembled by assignment under a test rather than by one object
 * literal, which reads more cleanly and is wrong.
 */
export function guardVirtualNoteWrites(handlers: ViewApi | undefined): ViewApi | undefined {
    if (!handlers) { return handlers; }
    const postMessage = handlers.postMessage;
    const revealNote = handlers.revealNote;
    const guarded: ViewApi = { ...handlers };
    if (postMessage) {
        guarded.postMessage = (message: unknown): void => {
            if (messageTargetsVirtualDoc(message)) {
                debug('refused a message naming the virtual sentinel: %O', message);
                return;
            }
            postMessage(message);
        };
    }
    if (revealNote) {
        guarded.revealNote = (note: NoteProps): void => {
            if (isVirtualNote(note)) {
                debug('refused revealNote for virtual note %s', note.stable_id);
                return;
            }
            revealNote(note);
        };
    }
    return guarded;
}

import {
    VIRTUAL_NOTE_DOC_PATH,
    VIRTUAL_NOTE_POSITION_BASE,
    admitVirtualNotes,
    guardVirtualNoteWrites,
    isVirtualDocPath,
    isVirtualNote,
    isVirtualStableId,
    makeVirtualNote,
    messageTargetsVirtualDoc,
    virtualNoteKeyOf,
    virtualNoteStableId,
} from './virtualnoteops';
import type { NoteProps } from '../types/NoteProps';
import type { ViewApi } from '../types/ViewProps';

// the shape every parsed stable_id starts with: generateIdentifier hashes the document path to 64 lowercase hex characters
const DOC_ID = 'a'.repeat(64);

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 1,
        depth: 3,
        type: 'heading',
        stable_id: `${DOC_ID}:a-real-story`,
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '### A real story',
        body_raw: '+ [ ] a task',
        origin: { doc_id: DOC_ID, doc_path: '/workspace/notethink/todo.md', relative_path: 'notethink/todo.md' },
        ...overrides,
    };
}

function makeRoot(children: NoteProps[]): NoteProps {
    return makeNote({
        seq: 0,
        level: 0,
        type: 'root',
        stable_id: undefined,
        headline_raw: '',
        origin: undefined,
        child_notes: children,
        children_body: [...children],
    });
}

function makeVirtual(key = 'claude-no-story'): NoteProps {
    return makeVirtualNote({ namespace: 'agent', key, headline: 'claude-code in notethink' });
}

describe('virtual note identity', () => {

    it('cannot collide with a parsed stable_id, because a parsed one opens with a 64-character hex doc_id', () => {
        const virtual_id = virtualNoteStableId('agent', 'claude-no-story');
        const parsed_story = `${DOC_ID}:agent-activity-card`;
        const parsed_descendant = `${parsed_story}:0.2`;
        const parsed_root_hung = `${DOC_ID}:__root__:1`;
        for (const parsed of [parsed_story, parsed_descendant, parsed_root_hung]) {
            expect(parsed.split(':')[0]).toMatch(/^[0-9a-f]{64}$/);
            expect(isVirtualStableId(parsed)).toBe(false);
            expect(virtual_id).not.toBe(parsed);
        }
        expect(virtual_id.split(':')[0]).not.toMatch(/^[0-9a-f]{64}$/);
        expect(isVirtualStableId(virtual_id)).toBe(true);
    });

    it('round-trips the key it was minted with, and answers undefined for another namespace', () => {
        const note = makeVirtual('grok-7712');
        expect(virtualNoteKeyOf(note, 'agent')).toBe('grok-7712');
        expect(virtualNoteKeyOf(note, 'something-else')).toBeUndefined();
        expect(virtualNoteKeyOf(makeNote(), 'agent')).toBeUndefined();
    });

    it('recognises a virtual note by either half of its identity, and a parsed one as neither', () => {
        expect(isVirtualNote(makeVirtual())).toBe(true);
        expect(isVirtualNote({ ...makeVirtual(), stable_id: undefined })).toBe(true);
        expect(isVirtualNote(makeNote())).toBe(false);
        expect(isVirtualNote(undefined)).toBe(false);
        expect(isVirtualDocPath('/workspace/notethink/todo.md')).toBe(false);
        expect(isVirtualDocPath(VIRTUAL_NOTE_DOC_PATH)).toBe(true);
    });
});

describe('admitting virtual notes', () => {

    it('leaves the note set untouched, by identity, when there is nothing to admit', () => {
        const notes = [makeRoot([makeNote()])];
        expect(admitVirtualNotes(notes, [])).toBe(notes);
    });

    it('hangs an admitted note off the root in both the tree and the body, and in the flat list', () => {
        const story = makeNote({ seq: 4 });
        const admitted = admitVirtualNotes([makeRoot([story]), story], [makeVirtual()])!;
        const root = admitted[0];
        const virtual = admitted[admitted.length - 1];
        expect(isVirtualNote(virtual)).toBe(true);
        expect(root.child_notes).toContain(virtual);
        expect(root.children_body).toContain(virtual);
        expect(virtual.parent_notes).toEqual([root]);
    });

    it('numbers an admitted note past every parsed one and matches its siblings level, so every view lays it out the same way', () => {
        const story = makeNote({ seq: 40, level: 2, depth: 4 });
        const admitted = admitVirtualNotes([makeRoot([story]), story], [makeVirtual()])!;
        const virtual = admitted[admitted.length - 1];
        expect(virtual.seq).toBe(41);
        expect(virtual.level).toBe(2);
        expect(virtual.depth).toBe(4);
        expect(virtual.type).toBe('heading');
    });

    it('places an admitted note past the end of any document, so an editor caret can never resolve to one', () => {
        const admitted = admitVirtualNotes([makeRoot([makeNote()]), makeNote()], [makeVirtual()])!;
        const virtual = admitted[admitted.length - 1];
        expect(virtual.position.start.offset).toBeGreaterThanOrEqual(VIRTUAL_NOTE_POSITION_BASE);
        expect(virtual.position.end.offset).toBeGreaterThan(virtual.position.start.offset);
        expect(virtual.children[0].position.start.offset).toBe(virtual.position.start.offset);
    });

    it('gives two admitted notes disjoint offset ranges', () => {
        const admitted = admitVirtualNotes([makeRoot([])], [makeVirtual('one'), makeVirtual('two')])!;
        const [first, second] = admitted.slice(-2);
        expect(second.position.start.offset).toBeGreaterThan(first.position.end.offset);
    });

    it('is idempotent, because AutoView renders GenericView again over props the first pass already admitted', () => {
        const once = admitVirtualNotes([makeRoot([makeNote()]), makeNote()], [makeVirtual()])!;
        const twice = admitVirtualNotes(once, [makeVirtual()])!;
        expect(twice).toBe(once);
        expect(once.filter(isVirtualNote)).toHaveLength(1);
    });

    it('appends to a flat set with no root at all, so a view that never built one still lays the note out', () => {
        const admitted = admitVirtualNotes([makeNote({ seq: 7 })], [makeVirtual()])!;
        expect(admitted).toHaveLength(2);
        expect(admitted[1].seq).toBe(8);
    });
});

describe('a virtual note cannot reach a write path', () => {

    it('is locked, which is the gate the shared kanban and line drag adapter checks before it builds a payload', () => {
        const admitted = admitVirtualNotes([makeRoot([])], [makeVirtual()])!;
        expect(admitted[admitted.length - 1].locked).toBe(true);
    });

    it('carries a reserved origin path, so no edit can fall back to the view document the way a note with no origin would', () => {
        const virtual = makeVirtual();
        expect(virtual.origin?.doc_path).toBe(VIRTUAL_NOTE_DOC_PATH);
        expect(isVirtualDocPath(virtual.origin?.doc_path)).toBe(true);
    });

    it('carries no body text, so the checkbox edit path computes nothing from it', () => {
        expect(makeVirtual().body_raw).toBe('');
    });

    it.each([
        ['a checkbox or linetag edit', { type: 'editText', changes: [{ from: 0, to: 1, insert: 'x' }], docPath: VIRTUAL_NOTE_DOC_PATH }],
        ['a single-document drag payload', { type: 'editText', changes: [], docPath: VIRTUAL_NOTE_DOC_PATH }],
        ['a multi-document drag payload', { type: 'editText', changes_by_doc: { [VIRTUAL_NOTE_DOC_PATH]: [] } }],
        ['an editor reveal', { type: 'revealRange', from: 0, docPath: VIRTUAL_NOTE_DOC_PATH }],
        ['an editor range selection', { type: 'selectRange', from: 0, to: 1, docPath: VIRTUAL_NOTE_DOC_PATH }],
        ['a file open', { type: 'openFile', path: VIRTUAL_NOTE_DOC_PATH }],
    ])('refuses %s naming the sentinel', (_label, message) => {
        expect(messageTargetsVirtualDoc(message)).toBe(true);
        const postMessage = jest.fn();
        guardVirtualNoteWrites({ postMessage } as unknown as ViewApi)!.postMessage!(message);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('lets a message about a real document through untouched', () => {
        const postMessage = jest.fn();
        const message = { type: 'editText', changes: [], docPath: '/workspace/notethink/todo.md' };
        guardVirtualNoteWrites({ postMessage } as unknown as ViewApi)!.postMessage!(message);
        expect(postMessage).toHaveBeenCalledWith(message);
    });

    it('refuses to reveal a virtual note in the editor, and still reveals a parsed one', () => {
        const revealNote = jest.fn();
        const guarded = guardVirtualNoteWrites({ revealNote } as unknown as ViewApi)!;
        guarded.revealNote!(makeVirtual());
        expect(revealNote).not.toHaveBeenCalled();
        const real = makeNote();
        guarded.revealNote!(real);
        expect(revealNote).toHaveBeenCalledWith(real);
    });

    /*
     * The guard is merged over useViewHandlers' own built handlers with Object.assign, which copies an
     * own key whose value is undefined. So a handler the source does not have has to stay ABSENT
     * rather than become a key holding undefined: the second overwrites a real implementation with
     * nothing, and `revealNote` is built in that merge rather than passed into it. Asserting the
     * VALUE is undefined would pass on the broken form, which is why these ask whether the key is
     * there at all.
     */
    it('mints no handler key the source does not have, because an undefined one overwrites a real implementation', () => {
        const guarded = guardVirtualNoteWrites({ setViewManagedState: jest.fn() } as unknown as ViewApi)!;
        expect('revealNote' in guarded).toBe(false);
        expect('postMessage' in guarded).toBe(false);
    });

    it('survives the merge it is handed to, leaving a built revealNote in place rather than blanking it', () => {
        const built_reveal = jest.fn();
        const built_post = jest.fn();
        const guarded = guardVirtualNoteWrites({ setViewManagedState: jest.fn() } as unknown as ViewApi);
        // the shape of useViewHandlers' own merge: its built handlers first, the guarded surface over them
        const merged = Object.assign({ revealNote: built_reveal, postMessage: built_post }, guarded) as unknown as ViewApi;
        merged.revealNote!(makeNote());
        merged.postMessage!({ type: 'revealRange', from: 0 });
        expect(built_reveal).toHaveBeenCalledTimes(1);
        expect(built_post).toHaveBeenCalledTimes(1);
    });

    it('keeps a handler the source does have, wrapped and still refusing, through the same merge', () => {
        const postMessage = jest.fn();
        const revealNote = jest.fn();
        const guarded = guardVirtualNoteWrites({ postMessage, revealNote } as unknown as ViewApi);
        const merged = Object.assign({ revealNote: jest.fn(), postMessage: jest.fn() }, guarded) as unknown as ViewApi;
        expect('revealNote' in merged).toBe(true);
        expect('postMessage' in merged).toBe(true);
        merged.revealNote!(makeVirtual());
        merged.postMessage!({ type: 'editText', changes: [], docPath: VIRTUAL_NOTE_DOC_PATH });
        expect(revealNote).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
        merged.revealNote!(makeNote());
        expect(revealNote).toHaveBeenCalledTimes(1);
    });

    it('carries every other handler through untouched, so guarding costs the surface nothing', () => {
        const setViewManagedState = jest.fn();
        const setNoteExpanded = jest.fn();
        const source = { setViewManagedState, setNoteExpanded, postMessage: jest.fn() } as unknown as ViewApi;
        const guarded = guardVirtualNoteWrites(source)!;
        expect(guarded.setViewManagedState).toBe(setViewManagedState);
        expect(guarded.setNoteExpanded).toBe(setNoteExpanded);
        expect(Object.keys(guarded).sort()).toEqual(Object.keys(source).sort());
    });

    it('leaves the view-managed state writers alone, because focusing or expanding a virtual note writes no file', () => {
        const setViewInteractionState = jest.fn();
        const setNoteExpanded = jest.fn();
        const guarded = guardVirtualNoteWrites({ setViewInteractionState, setNoteExpanded } as unknown as ViewApi)!;
        guarded.setViewInteractionState!(['nt-virtual:agent:x'], []);
        guarded.setNoteExpanded!('nt-virtual:agent:x', true);
        expect(setViewInteractionState).toHaveBeenCalled();
        expect(setNoteExpanded).toHaveBeenCalled();
    });
});

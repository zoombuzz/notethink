import { act, renderHook } from '@testing-library/react';
import { useGenericView } from './useGenericView';
import { resetActivitySnapshot, setActivitySnapshot } from '../../../lib/activityhooks';
import { VIRTUAL_NOTE_DOC_PATH, isVirtualNote } from '../../../lib/virtualnoteops';
import type { ActivitySessionState, ActivitySnapshot } from '../../../lib/agentactivityops';
import type { ActivitySession } from '../../../types/AgentActivity';
import type { NoteProps } from '../../../types/NoteProps';
import type { ViewApi, ViewProps } from '../../../types/ViewProps';

/*
 * The virtual-note seam, driven through the hook that owns it rather than through a rendered board:
 * every view renders through GenericView, and GenericView derives everything it hands a view from
 * this hook, so what the hook returns is what a view sees.
 */

const UNBOUND_SESSION: ActivitySession = {
    contract_version: '1.0.0',
    session_id: 'claude-no-story',
    vendor: 'claude-code',
    project: 'notethink',
    started_at: '2026-09-18T09:06:40Z',
    updated_at: '2026-09-18T09:13:55Z',
    state: 'working',
    story_binding: 'none',
    capabilities: { live_tool_call: 'supported', question: 'supported', digest: 'supported', file_attribution: 'supported' },
};

const UNBOUND_STATE: ActivitySessionState = {
    root_path: '/w/notethink',
    root_relative: 'notethink',
    session: UNBOUND_SESSION,
    events: [],
};

const SEEDED_SNAPSHOT: ActivitySnapshot = {
    contract_version: '1.0.0',
    producers: [{
        root_path: '/w/notethink',
        root_relative: 'notethink',
        project: 'notethink',
        producer: { name: 'p', version: '1' },
        live: true,
        capabilities: {},
        declared_session_ids: [UNBOUND_SESSION.session_id],
        unreadable_session_ids: [],
        refusals: [],
    }],
    sessions: [UNBOUND_STATE],
    trees: [],
};

function seedUnboundAgent(): void {
    setActivitySnapshot(SEEDED_SNAPSHOT);
}

function makeStory(): NoteProps {
    return {
        seq: 1,
        level: 1,
        depth: 3,
        type: 'heading',
        stable_id: 'doc:a-story',
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 20, line: 2 } },
        headline_raw: '### A story',
        body_raw: '',
    };
}

function makeProps(card_type: string, story: NoteProps, handlers?: Partial<ViewApi>): ViewProps {
    const root: NoteProps = {
        seq: 0,
        level: 0,
        type: 'root',
        children_body: [story],
        children: [],
        child_notes: [story],
        position: { start: { offset: 0, line: 1 }, end: { offset: 100, line: 10 } },
        headline_raw: '',
        body_raw: '',
    };
    return {
        id: 'v1',
        type: 'document',
        display_options: { settings: { cardType: card_type } },
        notes: [root, story],
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
            ...handlers,
        },
    };
}

afterEach(() => {
    resetActivitySnapshot();
});

describe('the virtual-note seam', () => {

    it('admits an unbound agent once, where every view sees it and none can tell it from a parsed note', () => {
        seedUnboundAgent();
        const story = makeStory();
        const { result } = renderHook(() => useGenericView(makeProps('agent', story)));
        const laid_out = result.current.view_context.notes_within_parent_context;
        expect(laid_out).toHaveLength(2);
        const virtual = laid_out.find(isVirtualNote)!;
        expect(virtual).toBeDefined();
        // the shape a view reads is the shape a parsed note has: a level, a document-order number, a heading and a position
        expect(virtual.level).toBe(story.level);
        expect(virtual.type).toBe(story.type);
        expect(virtual.seq).toBeGreaterThan(story.seq);
        expect(virtual.position.start.offset).toBeGreaterThan(story.position.end.offset);
        expect(result.current.view_props.notes).toContain(virtual);
    });

    it('sorts an admitted note after the stories it joins, so it never displaces one', () => {
        seedUnboundAgent();
        const { result } = renderHook(() => useGenericView(makeProps('agent', makeStory())));
        const laid_out = result.current.view_context.notes_within_parent_context;
        expect(isVirtualNote(laid_out[0])).toBe(false);
        expect(isVirtualNote(laid_out[1])).toBe(true);
    });

    it('admits nothing on a board drawing the full card, so an agent is never put among the stories uninvited', () => {
        seedUnboundAgent();
        const props = makeProps('card', makeStory());
        const { result } = renderHook(() => useGenericView(props));
        expect(result.current.view_context.notes_within_parent_context).toHaveLength(1);
        expect(result.current.view_props.notes).toBe(props.notes);
    });

    it('keeps the note set identity across a re-render, so the sort memo below it does not churn', () => {
        seedUnboundAgent();
        const props = makeProps('agent', makeStory());
        const { result, rerender } = renderHook(() => useGenericView(props));
        const first = result.current.view_props.notes;
        rerender();
        expect(result.current.view_props.notes).toBe(first);
    });

    it('re-admits when the snapshot changes, so an agent that stops is drawn no longer', () => {
        seedUnboundAgent();
        const props = makeProps('agent', makeStory());
        const { result } = renderHook(() => useGenericView(props));
        expect(result.current.view_context.notes_within_parent_context).toHaveLength(2);
        act(() => { resetActivitySnapshot(); });
        expect(result.current.view_context.notes_within_parent_context).toHaveLength(1);
    });

    it('guards the handler surface every view and every card is handed', () => {
        seedUnboundAgent();
        const postMessage = jest.fn();
        const revealNote = jest.fn();
        const { result } = renderHook(() => useGenericView(makeProps('agent', makeStory(), { postMessage, revealNote })));
        const virtual = result.current.view_context.notes_within_parent_context.find(isVirtualNote)!;
        result.current.handlers.postMessage!({ type: 'editText', changes: [], docPath: VIRTUAL_NOTE_DOC_PATH });
        result.current.view_props.handlers!.postMessage!({ type: 'revealRange', from: 0, docPath: VIRTUAL_NOTE_DOC_PATH });
        result.current.handlers.revealNote!(virtual);
        expect(postMessage).not.toHaveBeenCalled();
        expect(revealNote).not.toHaveBeenCalled();
        result.current.handlers.postMessage!({ type: 'editText', changes: [], docPath: '/workspace/todo.md' });
        expect(postMessage).toHaveBeenCalledTimes(1);
    });
});

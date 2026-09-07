import { renderHook, act } from '@testing-library/react';
import { useViewToolbar } from './useViewToolbar';
import { FOLDER_VIEW_STATE_ID } from '../../../lib/mergeAggregateRoot';
import type { NoteDisplayOptions, NoteProps } from '../../../types/NoteProps';
import type { ViewApi, ViewProps } from '../../../types/ViewProps';

function makeHandlers(): { handlers: ViewApi; set_view_managed_state: jest.Mock; post_message: jest.Mock } {
    const set_view_managed_state = jest.fn();
    const post_message = jest.fn();
    const handlers: ViewApi = {
        setViewManagedState: set_view_managed_state,
        deleteViewFromManagedState: jest.fn(),
        revertAllViewsToDefaultState: jest.fn(),
        postMessage: post_message,
    };
    return { handlers, set_view_managed_state, post_message };
}

// two lane values plus the untagged bucket deriveNaturalColumnOrder always appends
function makeStatusNote(seq: number, status: string): NoteProps {
    return {
        seq, level: 1, children_body: [], children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '', body_raw: '',
        linetags: { status: { key: 'status', key_offset: 0, value: status, value_offset: 0, linktext_offset: 0, note_seq: seq } },
    };
}

const LANE_NOTES: NoteProps[] = [makeStatusNote(1, 'doing'), makeStatusNote(2, 'done')];

function makeProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'doc-id-1',
        type: 'document',
        doc_path: '/repo/sub/file.md',
        display_options: { integration_mode: 'folder' },
        ...overrides,
    };
}

describe('useViewToolbar.handle_integration_change', () => {

    it('flipping to current_file sets the canonical key explicitly to current_file', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids: [FOLDER_VIEW_STATE_ID] }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file'); });
        expect(set_view_managed_state).toHaveBeenCalledTimes(1);
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        const canonical = updates.find((u) => u.id === FOLDER_VIEW_STATE_ID);
        expect(canonical).toBeDefined();
        expect((canonical!.display_options as NoteDisplayOptions).integration_mode).toBe('current_file');
        expect((canonical!.display_options as NoteDisplayOptions).integration_path).toBeUndefined();
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'current_file' });
    });

    it('flipping to current_file with a target file posts that path so the extension opens it', () => {
        const { handlers, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids: [FOLDER_VIEW_STATE_ID] }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file', '/ws/orbit/docstech/done.md'); });
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'current_file', path: '/ws/orbit/docstech/done.md' });
    });

    it('flipping integration mode clears per-view focused/selected interaction state on every persisted view key', () => {
        const { handlers, set_view_managed_state } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const view_state_ids = [FOLDER_VIEW_STATE_ID, '/repo/sub/file.md', '__default'];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        // every dispatched update carries an explicit undefined for the interaction-state ids, so the persisted state's stale focused/selected from the previous mode is cleared on the flip
        for (const update of updates) {
            const dopts = update.display_options as NoteDisplayOptions;
            expect(dopts.view_focused_ids).toBeUndefined();
            expect(dopts.view_selected_ids).toBeUndefined();
        }
    });

    it('flipping to current_file also clears stranded folder tags on every non-canonical viewState key', () => {
        const { handlers, set_view_managed_state } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const view_state_ids = [FOLDER_VIEW_STATE_ID, '/repo/sub/file.md', '/repo/sub/other.md', '__default'];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        // simulate the dispatcher's shallow merge over the supplied updates against a starting state that has stranded folder tags on every non-canonical key
        const starting_state: Record<string, { display_options?: NoteDisplayOptions }> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
            '/repo/sub/file.md': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
            '/repo/sub/other.md': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
            '__default': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
        };
        const next: Record<string, { display_options?: NoteDisplayOptions }> = { ...starting_state };
        for (const update of updates) {
            const id = update.id as string;
            next[id] = {
                ...next[id],
                display_options: {
                    ...next[id]?.display_options,
                    ...(update.display_options as NoteDisplayOptions | undefined),
                },
            };
        }
        for (const id of Object.keys(next)) {
            expect(next[id].display_options?.integration_mode).not.toBe('folder');
        }
    });

    it('explicit "auto" re-select resets to the file: persists auto + the declared folder scope and re-aggregates', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'current_file' };
        const notes: NoteProps[] = [];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({
                view_state_ids: [FOLDER_VIEW_STATE_ID],
                file_declared_integration: { mode: 'folder', integration_path: '/repo/portfolio' },
            }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('auto'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        const canonical = updates.find((u) => u.id === FOLDER_VIEW_STATE_ID);
        expect((canonical!.display_options as NoteDisplayOptions).integration_mode).toBe('auto');
        expect((canonical!.display_options as NoteDisplayOptions).integration_path).toBe('/repo/portfolio');
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/portfolio' });
    });

    it('explicit "auto" re-select on a file that declares current_file resets to auto with no folder scope', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({
                view_state_ids: [FOLDER_VIEW_STATE_ID],
                file_declared_integration: { mode: 'current_file' },
            }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('auto'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        const canonical = updates.find((u) => u.id === FOLDER_VIEW_STATE_ID);
        expect((canonical!.display_options as NoteDisplayOptions).integration_mode).toBe('auto');
        expect((canonical!.display_options as NoteDisplayOptions).integration_path).toBeUndefined();
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'current_file' });
    });

    it('flipping to folder dispatches the canonical-key integration update plus per-view interaction-state clears (no integration-mode tag sweep)', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'current_file' };
        const notes: NoteProps[] = [];
        const view_state_ids = [FOLDER_VIEW_STATE_ID, '/repo/sub/file.md'];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('folder'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        // canonical key sets integration_mode/path + clears interaction state; non-canonical keys clear interaction state only (no integration_mode tag written)
        const canonical = updates.find((u) => u.id === FOLDER_VIEW_STATE_ID);
        expect(canonical).toBeDefined();
        expect((canonical!.display_options as NoteDisplayOptions).integration_mode).toBe('folder');
        expect((canonical!.display_options as NoteDisplayOptions).integration_path).toBe('/repo/sub');
        expect((canonical!.display_options as NoteDisplayOptions).view_focused_ids).toBeUndefined();
        expect((canonical!.display_options as NoteDisplayOptions).view_selected_ids).toBeUndefined();
        // non-canonical key: no integration_mode tag set (no stranded-tag sweep), only interaction-state clearance
        const non_canonical = updates.find((u) => u.id === '/repo/sub/file.md');
        expect(non_canonical).toBeDefined();
        const non_canonical_dopts = non_canonical!.display_options as NoteDisplayOptions;
        expect(non_canonical_dopts.integration_mode).toBeUndefined();
        expect(non_canonical_dopts.integration_path).toBeUndefined();
        expect(non_canonical_dopts.view_focused_ids).toBeUndefined();
        expect(non_canonical_dopts.view_selected_ids).toBeUndefined();
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/sub' });
    });

});

describe('useViewToolbar integration_mode / integration_selection', () => {

    it('exposes the resolved concrete mode and the persisted selection separately (auto folder)', () => {
        const { handlers } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder', integration_mode_selection: 'auto', integration_path: '/repo/portfolio' };
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ display_options }), handlers, display_options, []),
        );
        expect(result.current.integration_mode).toBe('folder');
        expect(result.current.integration_selection).toBe('auto');
    });

    it('defaults the selection to auto and resolves current_file when nothing is stamped', () => {
        const { handlers } = makeHandlers();
        const display_options: NoteDisplayOptions = {};
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ display_options }), handlers, display_options, []),
        );
        expect(result.current.integration_mode).toBe('current_file');
        expect(result.current.integration_selection).toBe('auto');
    });

    it('reflects a concrete pin in both the resolved mode and the selection', () => {
        const { handlers } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder', integration_mode_selection: 'folder', integration_path: '/repo' };
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ display_options }), handlers, display_options, []),
        );
        expect(result.current.integration_mode).toBe('folder');
        expect(result.current.integration_selection).toBe('folder');
    });

});

describe('useViewToolbar view-type dropdown (parity with the integration-mode dropdown)', () => {

    it('exposes the persisted selection and the auto-resolved type, mirroring integration selection/mode', () => {
        const { handlers } = makeHandlers();
        const props = makeProps({ type: 'kanban', nested: { replaced_attributes: { type: 'auto' }, auto_resolved_type: 'kanban' } });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, []));
        expect(result.current.view_type_selection).toBe('auto');
        expect(result.current.auto_resolved_type).toBe('kanban');
    });

    it('falls back to props.type as the selection when nested carries no replaced type', () => {
        const { handlers } = makeHandlers();
        const props = makeProps({ type: 'document' });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, []));
        expect(result.current.view_type_selection).toBe('document');
        expect(result.current.auto_resolved_type).toBeUndefined();
    });

    it('handle_view_type_change dispatches the type to the view id and cascade-writes viewType (mirrors handle_integration_change)', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const props = makeProps({ id: 'doc-id-1' });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, []));
        act(() => { result.current.handle_view_type_change('kanban'); });
        expect(set_view_managed_state).toHaveBeenCalledWith([{ id: 'doc-id-1', type: 'kanban' }]);
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'viewType', value: 'kanban' });
    });

    it('handle_setting_change posts one updateSetting for the key it was handed, whatever node owns it', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const props = makeProps();
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, []));
        act(() => { result.current.handle_setting_change('showLinetagsInHeadlines', true); });
        act(() => { result.current.handle_setting_change('showLineNumbers', true); });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'showLinetagsInHeadlines', value: true });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'showLineNumbers', value: true });
        // no per-view settings copy survives: config is the only place a setting lands
        expect(set_view_managed_state).not.toHaveBeenCalled();
    });

    it('handle_column_order_change cascade-writes only, and spells natural order as an empty array', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const props = makeProps();
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, []));
        act(() => { result.current.handle_column_order_change(['done', 'doing']); });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'columnOrder', value: ['done', 'doing'] });
        // natural_column_order is [] for a non-kanban view, so an empty next_order matches natural
        act(() => { result.current.handle_column_order_change([]); });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'columnOrder', value: [] });
        expect(set_view_managed_state).not.toHaveBeenCalled();
    });

    it('natural_column_order is derived for every lane view, not only kanban, so the drawer can offer the row from any node', () => {
        const { handlers } = makeHandlers();
        const line_props = makeProps({ type: 'line' });
        const { result } = renderHook(() => useViewToolbar(line_props, handlers, line_props.display_options!, LANE_NOTES));
        expect(result.current.natural_column_order).toEqual(['doing', 'done', 'untagged']);
    });

    it('handle_make_default / handle_reset_to_default / handle_restore_builtin_default each post their cascade message', () => {
        const { handlers, post_message } = makeHandlers();
        const props = makeProps();
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, []));
        act(() => { result.current.handle_make_default(); });
        expect(post_message).toHaveBeenCalledWith({ type: 'promoteSettingsToUser' });
        act(() => { result.current.handle_reset_to_default(); });
        expect(post_message).toHaveBeenCalledWith({ type: 'resetSettingsToDefault' });
        act(() => { result.current.handle_restore_builtin_default(); });
        expect(post_message).toHaveBeenCalledWith({ type: 'restoreSettingsToBuiltinDefault' });
    });

});

/*
 * One note per originating file, carrying that file's nt_card vote. majorityFileVote counts one vote per
 * doc_id, so the notes only have to differ by origin for the tally to be over files rather than notes.
 */
function makeVotingNote(seq: number, doc_id: string, file_card_type?: string): NoteProps {
    return {
        seq, level: 1, children_body: [], children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '', body_raw: '', linetags: {},
        origin: { doc_id, doc_path: `/ws/${doc_id}.md`, file_card_type },
    };
}

/** a parent context isAggregateRoot accepts: two or more distinct originating files under one root */
function makeAggregateRoot(notes: NoteProps[]): NoteProps {
    return {
        seq: 0, level: 0, children_body: [], children: [], child_notes: notes,
        position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } },
        headline_raw: '', body_raw: '', linetags: {},
    };
}

describe('useViewToolbar card type', () => {

    /*
     * The regression this guards was shipped and seen. AutoView runs the vote, and AutoView renders for
     * `auto` ALONE - so pinning any view type unmounted the only thing voting, and every sticky on a
     * folder that had voted for one expanded back into the view's default card. The two axes are meant to
     * be independent, so the card answer cannot be a side effect of the view answer being `auto`.
     */
    it('votes for itself on an aggregate root with the view type pinned, since no AutoView is mounted to vote', () => {
        const { handlers } = makeHandlers();
        const notes = [
            makeVotingNote(1, 'alpha', 'sticky'),
            makeVotingNote(2, 'beta', 'sticky'),
            makeVotingNote(3, 'gamma'),
        ];
        const props = makeProps({ type: 'kanban', notes, nested: { parent_context: makeAggregateRoot(notes) } });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, notes));
        expect(result.current.card_type_selection).toBe('auto');
        expect(result.current.resolved_card_type).toBe('sticky');
    });

    it('takes AutoView\'s answer when one is published, rather than voting a second time', () => {
        const { handlers } = makeHandlers();
        const notes = [makeVotingNote(1, 'alpha', 'sticky'), makeVotingNote(2, 'beta', 'sticky')];
        const props = makeProps({ type: 'kanban', notes, nested: { parent_context: makeAggregateRoot(notes), auto_resolved_card_type: 'card' } });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, notes));
        expect(result.current.resolved_card_type).toBe('card');
    });

    it('a pinned card type wins over the vote, which is what pinning means', () => {
        const { handlers } = makeHandlers();
        const notes = [makeVotingNote(1, 'alpha', 'sticky'), makeVotingNote(2, 'beta', 'sticky')];
        const props = makeProps({ type: 'kanban', notes, nested: { parent_context: makeAggregateRoot(notes), replaced_attributes: { card_type: 'card' } } });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, notes));
        expect(result.current.card_type_selection).toBe('card');
        expect(result.current.resolved_card_type).toBe('card');
    });

    it('an even split is a tie and falls back to the view default rather than picking a side', () => {
        const { handlers } = makeHandlers();
        const notes = [makeVotingNote(1, 'alpha', 'sticky'), makeVotingNote(2, 'beta', 'card')];
        const props = makeProps({ type: 'kanban', notes, nested: { parent_context: makeAggregateRoot(notes) } });
        const { result } = renderHook(() => useViewToolbar(props, handlers, props.display_options!, notes));
        expect(result.current.resolved_card_type).toBe('card');
    });
});

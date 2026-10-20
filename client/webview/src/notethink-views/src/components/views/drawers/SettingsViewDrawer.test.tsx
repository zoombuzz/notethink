import React from 'react';
import { render, screen, fireEvent, within, act, type RenderResult } from '@testing-library/react';
import type { DropResult } from '@hello-pangea/dnd';
import type { UserViewType } from '../../../types/Messages';
import type { NoteProps } from '../../../types/NoteProps';
import SettingsViewDrawer, { mintUserViewTypeId, newViewTypeNameHint } from './SettingsViewDrawer';
import { VIEW_REGISTRY } from '../../../lib/viewregistryops';
import { CARD_SETTING_ROWS, VIEW_SETTING_ROWS } from '../settingRows';
import { setBreadthDraft } from '../kanban/useBreadthDraft';
import { resetActivitySnapshot, setActivitySnapshot } from '../../../lib/activityhooks';
import { AGENT_CARD_TYPE, DEFAULT_CARD_TYPE } from '../../notes/cardregistryops';
import type { ActivitySession } from '../../../types/AgentActivity';

function makeGroupNote(id: string, status: string, file_mtime?: number): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: `### Story [](?id=${id})`,
        body_raw: '',
        linetags: {
            id: { key: 'id', value: id, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 },
            status: { key: 'status', value: status, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 },
        },
        origin: { doc_id: 'x', doc_path: '/workspace/todo.md', relative_path: 'todo.md', file_mtime },
    };
}

function makeSession(session_id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
    return {
        session_id,
        vendor: 'claude-code',
        project: 'project',
        story_binding: 'bound',
        started_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        state: 'working',
        capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
        ...overrides,
    };
}

/*
 * The group-order chips drag through @hello-pangea/dnd, which needs real layout to run a gesture. The
 * mock renders the chips as the component asks and hands the test the context's onDragEnd, so a drop can
 * be delivered directly and the mapping from a drop to a written order is what gets asserted. The gesture
 * itself is covered in the browser by playwright/specs/view-settings-drawer.spec.ts.
 */
let captured_drag_end: ((result: DropResult) => void) | undefined;
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (result: DropResult) => void }) => {
        captured_drag_end = onDragEnd;
        return <div data-testid="drag-drop-context">{children}</div>;
    },
    Droppable: ({ children }: { children: (provided: unknown) => React.ReactNode }) =>
        (children as (provided: { droppableProps: Record<string, unknown>; innerRef: () => void; placeholder: null }) => React.ReactNode)({
            droppableProps: {},
            innerRef: () => {},
            placeholder: null,
        }),
    Draggable: ({ children }: { children: (provided: unknown) => React.ReactNode }) =>
        (children as (provided: { draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown>; innerRef: () => void }) => React.ReactNode)({
            draggableProps: {},
            dragHandleProps: {},
            innerRef: () => {},
        }),
}));

/** deliver a completed drag from one chip index to another, the way the library would */
function dropChip(from_index: number, to_index: number): void {
    act(() => {
        captured_drag_end?.({
            source: { index: from_index, droppableId: 'v1-group-display' },
            destination: { index: to_index, droppableId: 'v1-group-display' },
        } as DropResult);
    });
}

/** the group chips in the order the control lists them */
function renderedChipValues(): string[] {
    return screen.getAllByTestId(/^group-display-chip-/).map(el => el.getAttribute('data-testid')!.replace('group-display-chip-', ''));
}

// one saved type, used wherever a case needs a node the user owns rather than a built-in rung
const MINTED: UserViewType = { id: 'user-kanban-by-owner', label: 'Kanban by Owner', parent: 'kanban', overrides: { groupBy: 'owner' } };

// a saved type parented on kanban holding no groupBy of its own, so it falls through to kanban's built-in default
const MINTED_NO_GROUPBY: UserViewType = { id: 'user-kanban-plain', label: 'Kanban plain', parent: 'kanban', overrides: {} };

const default_props = {
    viewId: 'v1',
    settings: {} as Record<string, unknown>,
    diverged: [] as string[],
    userTypes: [] as UserViewType[],
    currentType: 'kanban',
    viewTypeSelection: 'kanban',
    autoResolvedType: 'kanban',
    onViewTypeChange: jest.fn(),
    onSettingChange: jest.fn(),
    naturalColumnOrder: ['doing', 'done', 'untagged'],
    onGroupDisplayChange: jest.fn(),
    groupByResolvedKey: 'status',
    groupByCandidateKeys: ['assignee', 'status'],
    notesWithinParentContext: [] as NoteProps[],
    resolvedCardType: DEFAULT_CARD_TYPE,
    onMakeDefault: jest.fn(),
    onResetToDefault: jest.fn(),
    canResetToDefault: true,
};

function renderDrawer(overrides: Partial<typeof default_props> = {}): RenderResult {
    return render(<SettingsViewDrawer {...default_props} {...overrides} />);
}

/** the bag a "Save as new view type" click wrote: the create op's node id and its complete new entry */
function mintedBag(on_setting_change: jest.Mock): { node_id: string; bag: Record<string, unknown> } | undefined {
    const calls = on_setting_change.mock.calls.filter(([key]) => key === 'views');
    for (let i = calls.length - 1; i >= 0; i--) {
        const sets = (calls[i][1] as { sets: Array<{ node_id: string; key: string | null; value: unknown }> }).sets;
        const create = sets.find(op => op.key === null && op.value !== undefined);
        if (create) { return { node_id: create.node_id, bag: create.value as Record<string, unknown> }; }
    }
    return undefined;
}

function renderedRowKeys(): string[] {
    return screen.getAllByTestId(/^setting-row-/).map(el => el.getAttribute('data-testid')!.replace('setting-row-', ''));
}

describe('SettingsViewDrawer tree', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the whole registry hierarchy, abstract nodes included', () => {
        renderDrawer();
        for (const node of VIEW_REGISTRY.nodes) {
            expect(screen.getByTestId(`view-node-${node.id}`)).toBeInTheDocument();
        }
        // grouped nests under root and kanban under line, so the tree is a hierarchy not a flat list
        const grouped_item = screen.getByTestId('view-node-grouped').closest('li')!;
        expect(within(grouped_item).getByTestId('view-node-line')).toBeInTheDocument();
        expect(within(grouped_item).getByTestId('view-node-kanban')).toBeInTheDocument();
    });

    it('gives a radio only to types that can render, plus the root, where it stands for auto', () => {
        renderDrawer();
        expect(screen.getByTestId('view-radio-document')).toBeInTheDocument();
        expect(screen.getByTestId('view-radio-line')).toBeInTheDocument();
        expect(screen.getByTestId('view-radio-kanban')).toBeInTheDocument();
        expect(screen.getByTestId('view-radio-auto')).toBeInTheDocument();
        expect(screen.queryByTestId('view-radio-grouped')).not.toBeInTheDocument();
        expect(screen.queryByTestId('view-radio-root')).not.toBeInTheDocument();
    });

    it('checks the radio for the persisted selection, and the auto radio when nothing is pinned', () => {
        const { unmount } = renderDrawer();
        expect(screen.getByTestId('view-radio-kanban')).toBeChecked();
        expect(screen.getByTestId('view-radio-auto')).not.toBeChecked();
        unmount();
        renderDrawer({ viewTypeSelection: 'auto' });
        expect(screen.getByTestId('view-radio-auto')).toBeChecked();
    });

    it('shows the count of settings each node owns', () => {
        const settings = Object.fromEntries(VIEW_SETTING_ROWS.map(def => [def.key, undefined]));
        renderDrawer({ settings });
        expect(screen.getByTestId('view-node-count-root')).toHaveTextContent('(1)');
        expect(screen.getByTestId('view-node-count-document')).toHaveTextContent('(0)');
        // groupDisplay and groupOrder now home at grouped alongside groupBy
        expect(screen.getByTestId('view-node-count-grouped')).toHaveTextContent('(3)');
        expect(screen.getByTestId('view-node-count-line')).toHaveTextContent('(2)');
        // kanban's own groupBy now lives in the viewOverrides map, not a flat kanban-homed key
        expect(screen.getByTestId('view-node-count-kanban')).toHaveTextContent('(3)');
    });

    it('clicking an abstract node shows its settings and leaves the rendered view alone', () => {
        const on_view_type_change = jest.fn();
        renderDrawer({ onViewTypeChange: on_view_type_change });
        expect(renderedRowKeys()).toContain('groupBy');
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        expect(on_view_type_change).not.toHaveBeenCalled();
        expect(renderedRowKeys()).toContain('groupBy');
        expect(screen.getByTestId('view-node-grouped').closest('li')).toHaveAttribute('aria-selected', 'true');
    });

    it('clicking a radio switches the board, which clicking the row alone never does', () => {
        const on_view_type_change = jest.fn();
        renderDrawer({ onViewTypeChange: on_view_type_change });
        fireEvent.click(screen.getByTestId('view-radio-document'));
        expect(on_view_type_change).toHaveBeenCalledWith('document');
    });

    it('renders a minted view type under its parent, with a radio, exactly like a built-in', () => {
        renderDrawer({
            userTypes: [{ id: 'user-kanban-by-assignee', label: 'Kanban by Assignee', parent: 'kanban', overrides: { groupBy: 'assignee' } }],
        });
        const kanban_item = screen.getByTestId('view-node-kanban').closest('li')!;
        expect(within(kanban_item).getByTestId('view-node-user-kanban-by-assignee')).toHaveTextContent('Kanban by Assignee');
        expect(screen.getByTestId('view-radio-user-kanban-by-assignee')).toBeInTheDocument();
    });
});

describe('SettingsViewDrawer rows', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('bands the rows by owner - kanban, then line, then grouped, then root - and pills each by where its value actually comes from', () => {
        renderDrawer();
        expect(renderedRowKeys()).toEqual([
            'cardRatio',
            'animateTransitions',
            'defaultCardType',
            'groupBy',
            'orientation',
            'lineBreadth',
            'groupOrder',
            'groupDisplay',
            'scrollNoteIntoView',
            'watchUnopenedFilesInViewer',
            'openNewEditorIfNoneOpen',
        ]);
        // kanban always holds at least its own built-in status default for groupBy, so its pill names Kanban itself
        expect(screen.getByTestId('setting-pill-groupBy')).toHaveTextContent('Kanban');
        expect(screen.getByTestId('setting-pill-groupDisplay')).toHaveTextContent('Grouped');
        expect(screen.getByTestId('setting-pill-groupOrder')).toHaveTextContent('Grouped');
        expect(screen.getByTestId('setting-pill-defaultCardType')).toHaveTextContent('Kanban');
        expect(screen.getByTestId('setting-pill-orientation')).toHaveTextContent('Line');
        expect(screen.getByTestId('setting-pill-scrollNoteIntoView')).toHaveTextContent('All views');
    });

    it('rules a thin line wherever the OWNER changes, and none between rows of one owner', () => {
        renderDrawer();
        const sequence = Array.from(screen.getByTestId('settings-rows').children).map(el => el.getAttribute('data-testid'));
        const opened_by_divider = sequence.flatMap((id, index) => (id === 'settings-owner-divider' ? [sequence[index + 1]] : []));
        // kanban's band ends after groupBy, line's after lineBreadth, grouped's after groupDisplay
        expect(opened_by_divider).toEqual(['setting-row-orientation', 'setting-row-groupOrder', 'setting-row-scrollNoteIntoView']);
    });

    /*
     * A saved type under kanban holding its own groupBy (homed at grouped) and orientation (homed at
     * line) lists both first under its own name, rather than leaving each in the band of the view that
     * declares it, so every setting the selected view holds itself reads together at the top.
     */
    it('lifts every row a saved type holds itself to the top, ahead of kanban, line, grouped and root', () => {
        const minted: UserViewType = { id: 'user-next-up', label: 'Next up', parent: 'kanban', overrides: { groupBy: 'assignee', orientation: 'rows' } };
        renderDrawer({ userTypes: [minted], viewTypeSelection: minted.id, currentType: minted.id });
        // within one owner the rows keep their home order, so line's orientation precedes grouped's groupBy
        expect(renderedRowKeys()).toEqual([
            'orientation',
            'groupBy',
            'cardRatio',
            'animateTransitions',
            'defaultCardType',
            'lineBreadth',
            'groupOrder',
            'groupDisplay',
            'scrollNoteIntoView',
            'watchUnopenedFilesInViewer',
            'openNewEditorIfNoneOpen',
        ]);
        expect(screen.getByTestId('setting-pill-groupBy')).toHaveTextContent('Next up');
        expect(screen.getByTestId('setting-pill-orientation')).toHaveTextContent('Next up');
        expect(screen.getByTestId('setting-pill-cardRatio')).toHaveTextContent('Kanban');
    });

    /*
     * Kanban's own built-in status default (BUILTIN_NODE_DEFAULTS) is not something settings.json holds,
     * so VS (view specific) would be a false claim: the row reads as inherited, with a hover
     * naming the default rather than an ancestor that holds nothing.
     */
    it('shows the inherited pill, not VS, for kanban\'s groupBy while nothing is actually stored', () => {
        renderDrawer();
        expect(screen.queryByTestId('setting-pill-specific-groupBy')).not.toBeInTheDocument();
        const pill = screen.getByTestId('setting-pill-inherited-groupBy');
        expect(pill).toHaveAttribute('title', "Kanban's built-in default");
    });

    it('shows VS for kanban\'s groupBy once kanban genuinely stores its own value', () => {
        renderDrawer({ settings: { viewOverrides: { kanban: { groupBy: 'assignee' } } } });
        expect(screen.queryByTestId('setting-pill-inherited-groupBy')).not.toBeInTheDocument();
        expect(screen.getByTestId('setting-pill-specific-groupBy')).toBeInTheDocument();
    });

    it('shows the inherited pill, naming kanban\'s built-in default, for a saved type under kanban holding no groupBy of its own', () => {
        renderDrawer({ userTypes: [MINTED_NO_GROUPBY], viewTypeSelection: MINTED_NO_GROUPBY.id, currentType: MINTED_NO_GROUPBY.id });
        expect(screen.queryByTestId('setting-pill-specific-groupBy')).not.toBeInTheDocument();
        const pill = screen.getByTestId('setting-pill-inherited-groupBy');
        expect(pill).toHaveAttribute('title', "Kanban's built-in default");
    });

    it('keeps groupBy in kanban\'s band once kanban stores its own value, since kanban already owned it by default', () => {
        renderDrawer({ settings: { viewOverrides: { kanban: { groupBy: 'assignee' } } } });
        expect(renderedRowKeys()).toEqual([
            'cardRatio',
            'animateTransitions',
            'defaultCardType',
            'groupBy',
            'orientation',
            'lineBreadth',
            'groupOrder',
            'groupDisplay',
            'scrollNoteIntoView',
            'watchUnopenedFilesInViewer',
            'openNewEditorIfNoneOpen',
        ]);
        expect(screen.getByTestId('setting-pill-groupBy')).toHaveTextContent('Kanban');
    });

    it('lists no card-drawn setting, since those moved onto the card tab', () => {
        renderDrawer({ settings: Object.fromEntries(CARD_SETTING_ROWS.map(def => [def.key, true])) });
        for (const def of CARD_SETTING_ROWS) {
            expect(screen.queryByTestId(`setting-row-${def.key}`)).not.toBeInTheDocument();
        }
    });

    it('names each pane over its own content and heads no column with either name', () => {
        renderDrawer();
        expect(screen.getByTestId('view-types-heading')).toHaveTextContent('View types');
        expect(screen.getByTestId('view-settings-heading')).toHaveTextContent('View settings');
        // the title is the short form, so the pane headings are where the axis is spelled out
        expect(screen.getAllByText('View settings')).toHaveLength(1);
        expect(screen.queryByText('View type')).not.toBeInTheDocument();
    });

    it('groups the pill-less settings under Global settings', () => {
        renderDrawer();
        expect(screen.getByTestId('global-settings-heading')).toHaveTextContent('Global settings');
        // a global belongs to no type, so its pill cell is present for alignment but names nothing
        expect(screen.queryByTestId('setting-pill-watchUnopenedFilesInViewer')).not.toBeInTheDocument();
    });

    it('never renders a Files-drawer or internal-state setting as a row', () => {
        renderDrawer({ settings: { includeFilter: '**/*.md', excludeFilter: '', maxNotesPerFile: 10, viewUserTypes: [] } });
        for (const key of ['includeFilter', 'excludeFilter', 'maxNotesPerFile', 'viewUserTypes', 'viewType']) {
            expect(screen.queryByTestId(`setting-row-${key}`)).not.toBeInTheDocument();
        }
    });

    it('retires the view-type select, since the tree is the selector', () => {
        renderDrawer();
        expect(screen.queryByTestId('view-type-selector')).not.toBeInTheDocument();
    });

    it('marks every diverged row with an M and tallies exactly the marked rows', () => {
        // scrollNoteIntoView is only inheriting at kanban, so its M answers to root's own cell, not a bare key
        renderDrawer({ diverged: ['views:kanban:groupBy', 'views:root:scrollNoteIntoView', 'includeFilter'] });
        const marked = screen.getAllByTestId(/^setting-row-/).filter(row => row.getAttribute('data-diverged') === 'true');
        expect(marked.map(row => row.getAttribute('data-testid'))).toEqual(['setting-row-groupBy', 'setting-row-scrollNoteIntoView']);
        expect(screen.getAllByTestId(/^setting-marker-/)).toHaveLength(2);
        // includeFilter diverges but renders no row here: the tally is of M-marked rows
        expect(screen.getByTestId('diverged-count')).toHaveTextContent('(2 settings diverged)');
    });

    it('tallies zero when nothing has diverged, so the summary reads the same either way', () => {
        renderDrawer({ diverged: [] });
        expect(screen.getByTestId('diverged-count')).toHaveTextContent('(0 settings diverged)');
    });

    it('states the tally on the collapsed summary and the sentence explaining it inside', () => {
        renderDrawer({ diverged: ['views:root:scrollNoteIntoView'] });
        expect(screen.getByTestId('change-defaults-summary')).toHaveTextContent('Change defaults (1 setting diverged)');
        expect(screen.getByTestId('change-defaults')).toHaveTextContent('Settings diverged from the defaults and are already saved');
    });
});

describe('SettingsViewDrawer controls', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('writes the card ratio as a number, since the width solve does arithmetic on it', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('setting-control-cardRatio'), { target: { value: '2' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'cardRatio', value: 2 }] });
    });

    it('offers the default card type as a dropdown of the concrete cards, showing Card until one is chosen', () => {
        renderDrawer();
        const control = screen.getByTestId('setting-control-defaultCardType') as HTMLSelectElement;
        expect(control.tagName).toBe('SELECT');
        expect(control.value).toBe('card');
        expect(Array.from(control.options).map(option => option.value)).toEqual(['card', 'sticky', 'agent']);
        expect(screen.getByTestId('setting-row-defaultCardType')).toHaveTextContent('Default card type');
    });

    it('writes a chosen default card type to the kanban setting', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('setting-control-defaultCardType'), { target: { value: 'sticky' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'defaultCardType', value: 'sticky' }] });
    });

    it('offers the default card type on a kanban board and nowhere above it', () => {
        renderDrawer();
        expect(screen.getByTestId('setting-row-defaultCardType')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('view-node-line'));
        expect(screen.queryByTestId('setting-row-defaultCardType')).not.toBeInTheDocument();
    });

    it('offers the card ratio on a kanban board and nowhere above it, since the width is a kanban concern', () => {
        renderDrawer();
        expect(screen.getByTestId('setting-row-cardRatio')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('view-node-line'));
        expect(screen.queryByTestId('setting-row-cardRatio')).not.toBeInTheDocument();
    });

    it('changing Group by from kanban writes kanban\'s own entry in the viewOverrides map, never the ancestor key', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'assignee' } });
        expect(on_setting_change).toHaveBeenCalledTimes(1);
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'groupBy', value: 'assignee' }] });
    });

    it('changing Group by from the grouped node writes the ancestor key instead', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'assignee' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'grouped', key: 'groupBy', value: 'assignee' }] });
    });

    it('renders the orientation control and writes kanban\'s own entry in the viewOverrides map, selected on kanban', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('setting-control-orientation'), { target: { value: 'rows' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'orientation', value: 'rows' }] });
    });

    it('writes orientation flat when selected on line, its own home', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('view-node-line'));
        fireEvent.change(screen.getByTestId('setting-control-orientation'), { target: { value: 'rows' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'line', key: 'orientation', value: 'rows' }] });
    });

    it('lists every group as a chip, in the order the board lays the groups out', () => {
        renderDrawer();
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
        expect(screen.getByLabelText('Reorder Done')).toBeInTheDocument();
    });

    it('on the status axis, an untouched kanban-rung default lists only the groups a current note carries', () => {
        // the kanban rung's own package.json default names 5 groups; naturalColumnOrder here is only 3
        renderDrawer({
            settings: {
                groupDisplay: [
                    { value: 'untagged', shown: true },
                    { value: 'doing', shown: true },
                    { value: 'code-review', shown: true },
                    { value: 'testing', shown: true },
                    { value: 'done', shown: true },
                ],
            },
        });
        // code-review and testing name no current note and so list no chip, in the default's own relative order
        expect(renderedChipValues()).toEqual(['untagged', 'doing', 'done']);
    });

    it('routes a dropped group through the group-display handler that normalises the natural order', () => {
        const on_group_display_change = jest.fn();
        const on_setting_change = jest.fn();
        renderDrawer({ onGroupDisplayChange: on_group_display_change, onSettingChange: on_setting_change });
        // groupDisplay is per-view now; select its home (grouped) so this exercises the flat axis-merge path
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        dropChip(1, 0);
        expect(on_group_display_change).toHaveBeenCalledWith([
            { value: 'done', shown: true },
            { value: 'doing', shown: true },
            { value: 'untagged', shown: true },
        ]);
        expect(on_setting_change).not.toHaveBeenCalled();
    });

    it('writes nothing when a group is dropped outside the list, or back where it started', () => {
        const on_group_display_change = jest.fn();
        renderDrawer({ onGroupDisplayChange: on_group_display_change });
        act(() => { captured_drag_end?.({ source: { index: 1, droppableId: 'v1-group-display' }, destination: null } as DropResult); });
        dropChip(1, 1);
        expect(on_group_display_change).not.toHaveBeenCalled();
    });

    it('toggling a group\'s checkbox posts the shown flag flipped, without starting a drag', () => {
        const on_group_display_change = jest.fn();
        renderDrawer({ onGroupDisplayChange: on_group_display_change });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        fireEvent.click(screen.getByTestId('group-display-shown-done'));
        expect(on_group_display_change).toHaveBeenCalledWith([
            { value: 'doing', shown: true },
            { value: 'done', shown: false },
            { value: 'untagged', shown: true },
        ]);
    });

    it('with no notes, lists just the absent-value bucket, same as a status-grouped board today', () => {
        renderDrawer({ naturalColumnOrder: ['untagged'] });
        expect(renderedChipValues()).toEqual(['untagged']);
    });

    it('grouped by first level folder, lists the folder groups rather than any saved status chips', () => {
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: ['alpha', 'beta', 'untagged'],
            // these entries carry no axis, so they belong to status and are invisible on the folder axis
            settings: { groupDisplay: [{ value: 'doing', shown: false }, { value: 'done', shown: true }] },
        });
        expect(renderedChipValues()).toEqual(['alpha', 'beta', 'untagged']);
    });

    it('an untouched default groupDisplay off the status axis is ignored entirely, not read as stale status chips', () => {
        // the kanban rung's own package.json default, carrying no axis, so it belongs to status alone
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: ['alpha', 'beta', 'untagged'],
            settings: {
                groupDisplay: [
                    { value: 'untagged', shown: true },
                    { value: 'doing', shown: true },
                    { value: 'code-review', shown: true },
                    { value: 'testing', shown: true },
                    { value: 'done', shown: true },
                ],
            },
        });
        expect(renderedChipValues()).toEqual(['alpha', 'beta', 'untagged']);
    });

    it('an empty natural (the rendered type is not a grouped one, e.g. a highlighted node that is not what is on screen) still lists the untouched default in full, never nothing', () => {
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: [],
            settings: {
                groupDisplay: [
                    { value: 'untagged', shown: true },
                    { value: 'doing', shown: true },
                    { value: 'code-review', shown: true },
                    { value: 'testing', shown: true },
                    { value: 'done', shown: true },
                ],
            },
        });
        expect(renderedChipValues()).toEqual(['untagged', 'doing', 'code-review', 'testing', 'done']);
    });

    it('an empty natural lists only the status entries, never another axis\'s', () => {
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: [],
            settings: {
                groupDisplay: [
                    { value: 'doing', shown: true },
                    { value: 'alpha', shown: true, axis: 'nt_first_level_folder' },
                    { value: 'done', shown: false },
                ],
            },
        });
        expect(renderedChipValues()).toEqual(['doing', 'done']);
    });

    it('a mixed stored list shows only the entries tagged for the active axis, folder groups merged with the untagged ones of its own', () => {
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: ['alpha', 'beta', 'untagged'],
            settings: {
                groupDisplay: [
                    { value: 'untagged', shown: false },
                    { value: 'doing', shown: true },
                    { value: 'beta', shown: false, axis: 'nt_first_level_folder' },
                    { value: 'alpha', shown: true, axis: 'nt_first_level_folder' },
                ],
            },
        });
        expect(renderedChipValues()).toEqual(['beta', 'alpha', 'untagged']);
    });

    it('on the status axis, a folder-axis entry in a mixed stored list is excluded', () => {
        renderDrawer({
            settings: {
                groupDisplay: [
                    { value: 'doing', shown: false },
                    { value: 'alpha', shown: true, axis: 'nt_first_level_folder' },
                ],
            },
        });
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
    });

    it('reordering a folder group writes only the folder axis entries, independent of any stored status chips', () => {
        const on_group_display_change = jest.fn();
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: ['alpha', 'beta', 'untagged'],
            settings: { groupDisplay: [{ value: 'doing', shown: false }, { value: 'done', shown: true }] },
            onGroupDisplayChange: on_group_display_change,
        });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        dropChip(1, 0);
        expect(on_group_display_change).toHaveBeenCalledWith([
            { value: 'beta', shown: true },
            { value: 'alpha', shown: true },
            { value: 'untagged', shown: true },
        ]);
    });

    it('hiding a folder group writes only the folder axis entries, independent of any stored status chips', () => {
        const on_group_display_change = jest.fn();
        renderDrawer({
            groupByResolvedKey: 'nt_first_level_folder',
            naturalColumnOrder: ['alpha', 'beta', 'untagged'],
            settings: { groupDisplay: [{ value: 'doing', shown: false }, { value: 'done', shown: true }] },
            onGroupDisplayChange: on_group_display_change,
        });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        fireEvent.click(screen.getByTestId('group-display-shown-alpha'));
        expect(on_group_display_change).toHaveBeenCalledWith([
            { value: 'alpha', shown: false },
            { value: 'beta', shown: true },
            { value: 'untagged', shown: true },
        ]);
    });

    it('toggles a checkbox row through the one setting-change path, flat at its own home (root/"All views")', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change, settings: { scrollNoteIntoView: false } });
        fireEvent.click(screen.getByTestId('view-node-root'));
        fireEvent.click(screen.getByTestId('setting-control-scrollNoteIntoView'));
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'root', key: 'scrollNoteIntoView', value: true }] });
    });

    it('toggles scrollNoteIntoView from Kanban into Kanban\'s own viewOverrides entry, since root-homed rows are per-view too', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change, settings: { scrollNoteIntoView: false } });
        fireEvent.click(screen.getByTestId('setting-control-scrollNoteIntoView'));
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'scrollNoteIntoView', value: true }] });
    });

    it('falls back to each setting built-in default before the first cascade arrives', () => {
        renderDrawer({ settings: {} });
        expect(screen.getByTestId('setting-control-scrollNoteIntoView')).toBeChecked();
        expect(screen.getByTestId('setting-control-openNewEditorIfNoneOpen')).not.toBeChecked();
        expect(screen.getByTestId('setting-control-animateTransitions')).toBeChecked();
    });
});

describe('SettingsViewDrawer group display: entries no live note carries', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('a stored entry for a value no note carries does not appear as a chip', () => {
        renderDrawer({
            naturalColumnOrder: ['doing', 'done', 'untagged'],
            settings: { groupDisplay: [{ value: 'doing', shown: true }, { value: 'archived', shown: true }] },
        });
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
        expect(screen.queryByTestId('group-display-chip-archived')).not.toBeInTheDocument();
    });

    it('a hidden absent entry survives a toggle on another chip, unchanged, appended after the present ones', () => {
        const on_group_display_change = jest.fn();
        renderDrawer({
            naturalColumnOrder: ['doing', 'done', 'untagged'],
            settings: { groupDisplay: [{ value: 'doing', shown: true }, { value: 'done', shown: true }, { value: 'archived', shown: false }] },
            onGroupDisplayChange: on_group_display_change,
        });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        fireEvent.click(screen.getByTestId('group-display-shown-done'));
        expect(on_group_display_change).toHaveBeenCalledWith([
            { value: 'doing', shown: true },
            { value: 'done', shown: false },
            { value: 'untagged', shown: true },
            { value: 'archived', shown: false },
        ]);
    });

    it('a hidden absent entry survives a drag reordering the present chips, unchanged, appended after them', () => {
        const on_group_display_change = jest.fn();
        renderDrawer({
            naturalColumnOrder: ['doing', 'done', 'untagged'],
            settings: { groupDisplay: [{ value: 'doing', shown: true }, { value: 'done', shown: true }, { value: 'archived', shown: false }] },
            onGroupDisplayChange: on_group_display_change,
        });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        dropChip(1, 0);
        expect(on_group_display_change).toHaveBeenCalledWith([
            { value: 'done', shown: true },
            { value: 'doing', shown: true },
            { value: 'untagged', shown: true },
            { value: 'archived', shown: false },
        ]);
    });

    it('an absent entry reappears as a chip, in its stored position and shown state, once a note carries the value again', () => {
        renderDrawer({
            naturalColumnOrder: ['doing', 'done', 'archived', 'untagged'],
            settings: { groupDisplay: [{ value: 'doing', shown: true }, { value: 'archived', shown: false }, { value: 'done', shown: true }] },
        });
        expect(renderedChipValues()).toEqual(['doing', 'archived', 'done', 'untagged']);
    });
});

describe('SettingsViewDrawer group order', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        resetActivitySnapshot();
    });

    afterEach(() => {
        resetActivitySnapshot();
    });

    it('renders the select at the current value, offering all five modes', () => {
        renderDrawer({ settings: { groupOrder: 'alphabetical' } });
        const control = screen.getByTestId('setting-control-groupOrder') as HTMLSelectElement;
        expect(control.tagName).toBe('SELECT');
        expect(control.value).toBe('alphabetical');
        expect(Array.from(control.options).map(option => option.value)).toEqual(['custom', 'newestFirst', 'newestLast', 'alphabetical', 'cardCount']);
        expect(screen.getByTestId('setting-row-groupOrder')).toHaveTextContent('Group order');
    });

    it('defaults to custom when nothing is set, and writes the picked mode as a plain setting change at its own home', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        expect((screen.getByTestId('setting-control-groupOrder') as HTMLSelectElement).value).toBe('custom');
        fireEvent.change(screen.getByTestId('setting-control-groupOrder'), { target: { value: 'cardCount' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'grouped', key: 'groupOrder', value: 'cardCount' }] });
    });

    it('picking a mode from Kanban (groupOrder is per-view too) writes Kanban\'s own viewOverrides entry', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('setting-control-groupOrder'), { target: { value: 'cardCount' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'groupOrder', value: 'cardCount' }] });
    });

    it('with the agent card type on screen, lists the chips in newestLast order, oldest group first, agreeing with what the board would draw', () => {
        setActivitySnapshot({
            analyser: { state: 'live', refusals: [] },
            sessions: [
                { root_path: '/ws', session: makeSession('older', { stories: [{ doc_path: 'todo.md', id: 'a' }], updated_at: '2026-10-01T00:00:00Z' }) },
                { root_path: '/ws', session: makeSession('newer', { stories: [{ doc_path: 'todo.md', id: 'b' }], updated_at: '2026-10-09T00:00:00Z' }) },
            ],
            trees: [],
        });
        renderDrawer({
            settings: { groupOrder: 'newestLast' },
            notesWithinParentContext: [makeGroupNote('a', 'doing'), makeGroupNote('b', 'done')],
            resolvedCardType: AGENT_CARD_TYPE,
        });
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
    });

    it('with the agent card type on screen, lists the chips in newestFirst order, newest group first', () => {
        setActivitySnapshot({
            analyser: { state: 'live', refusals: [] },
            sessions: [
                { root_path: '/ws', session: makeSession('older', { stories: [{ doc_path: 'todo.md', id: 'a' }], updated_at: '2026-10-01T00:00:00Z' }) },
                { root_path: '/ws', session: makeSession('newer', { stories: [{ doc_path: 'todo.md', id: 'b' }], updated_at: '2026-10-09T00:00:00Z' }) },
            ],
            trees: [],
        });
        renderDrawer({
            settings: { groupOrder: 'newestFirst' },
            notesWithinParentContext: [makeGroupNote('a', 'doing'), makeGroupNote('b', 'done')],
            resolvedCardType: AGENT_CARD_TYPE,
        });
        expect(renderedChipValues()).toEqual(['done', 'doing', 'untagged']);
    });

    it('with the default card type on screen, orders by the stories\' own file_mtime instead of any agent activity', () => {
        setActivitySnapshot({
            analyser: { state: 'live', refusals: [] },
            // an activity snapshot that would reverse the order under the agent card type; the default card ignores it
            sessions: [
                { root_path: '/ws', session: makeSession('newer-activity', { stories: [{ doc_path: 'todo.md', id: 'a' }], updated_at: '2026-10-09T00:00:00Z' }) },
            ],
            trees: [],
        });
        renderDrawer({
            settings: { groupOrder: 'newestLast' },
            notesWithinParentContext: [
                makeGroupNote('a', 'doing', Date.parse('2026-10-01T00:00:00Z')),
                makeGroupNote('b', 'done', Date.parse('2026-10-05T00:00:00Z')),
            ],
            resolvedCardType: DEFAULT_CARD_TYPE,
        });
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
    });

    it('a chip drag in an automatic order seeds groupDisplay with the on-screen order and switches groupOrder to custom in one combined write when the type holds both', () => {
        const on_setting_change = jest.fn();
        const MINTED_BOTH: UserViewType = { id: 'user-kanban-both', label: 'Kanban both', parent: 'kanban', overrides: { groupDisplay: [], groupOrder: 'cardCount' } };
        renderDrawer({
            userTypes: [MINTED_BOTH],
            currentType: 'user-kanban-both',
            viewTypeSelection: 'user-kanban-both',
            settings: { groupOrder: 'cardCount' },
            notesWithinParentContext: [makeGroupNote('a', 'doing'), makeGroupNote('a2', 'doing'), makeGroupNote('b', 'done')],
            onSettingChange: on_setting_change,
        });
        // cardCount puts 'doing' (2 cards) before 'done' (1), untagged last; the drag moves 'done' to the front
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
        dropChip(1, 0);
        expect(on_setting_change).toHaveBeenCalledTimes(1);
        const [key, value] = on_setting_change.mock.calls[0];
        expect(key).toBe('views');
        const sets = (value as { sets: Array<{ node_id: string; key: string; value: unknown }> }).sets;
        expect(sets.every(op => op.node_id === 'user-kanban-both')).toBe(true);
        expect(sets.find(op => op.key === 'groupOrder')?.value).toBe('custom');
        expect(sets.find(op => op.key === 'groupDisplay')?.value).toEqual([
            { value: 'done', shown: true },
            { value: 'doing', shown: true },
            { value: 'untagged', shown: true },
        ]);
    });

    /*
     * groupDisplay is now per-view too, so a saved type combines both keys into one `views` bag delta
     * (two cells, one node_id) unconditionally - whether or not it already held groupDisplay - since two
     * separate round trips risk one clobbering the other. The type's groupDisplay starts empty (never
     * set), so the merge against its own bag carries nothing else forward: the written array is exactly
     * this drag's own entries.
     */
    it('a chip drag in an automatic order combines both keys into one views delta, even when the type held only one of them', () => {
        const on_setting_change = jest.fn();
        const on_group_display_change = jest.fn();
        const MINTED_ORDER_ONLY: UserViewType = { id: 'user-kanban-order', label: 'Kanban order', parent: 'kanban', overrides: { groupOrder: 'alphabetical' } };
        renderDrawer({
            userTypes: [MINTED_ORDER_ONLY],
            currentType: 'user-kanban-order',
            viewTypeSelection: 'user-kanban-order',
            settings: { groupOrder: 'alphabetical' },
            onSettingChange: on_setting_change,
            onGroupDisplayChange: on_group_display_change,
        });
        dropChip(1, 0);
        expect(on_group_display_change).not.toHaveBeenCalled();
        expect(on_setting_change).toHaveBeenCalledTimes(1);
        const [key, value] = on_setting_change.mock.calls[0];
        expect(key).toBe('views');
        const sets = (value as { sets: Array<{ node_id: string; key: string; value: unknown }> }).sets;
        expect(sets.every(op => op.node_id === 'user-kanban-order')).toBe(true);
        expect(sets.find(op => op.key === 'groupOrder')?.value).toBe('custom');
        expect(sets.find(op => op.key === 'groupDisplay')?.value).toEqual([
            { value: 'done', shown: true },
            { value: 'doing', shown: true },
            { value: 'untagged', shown: true },
        ]);
    });
});

describe('SettingsViewDrawer defaults and new view types', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('collapses both default actions into one Change defaults disclosure', () => {
        const on_make_default = jest.fn();
        const on_reset = jest.fn();
        renderDrawer({ onMakeDefault: on_make_default, onResetToDefault: on_reset, diverged: ['views:root:scrollNoteIntoView'] });
        expect(screen.getByTestId('change-defaults-summary')).toHaveTextContent('Change defaults');
        fireEvent.click(screen.getByTestId('save-as-default'));
        fireEvent.click(screen.getByTestId('revert-to-defaults'));
        expect(on_make_default).toHaveBeenCalledTimes(1);
        expect(on_reset).toHaveBeenCalledTimes(1);
        // the built-in restore is deliberately absent - it stays reachable from the Files drawer
        expect(screen.queryByText('Reset to built-in default')).not.toBeInTheDocument();
    });

    /*
     * Saving promotes what diverges, so with nothing diverging it would promote nothing. The panel never
     * offers an action it cannot carry out, which is what the tally beside its name is there to explain.
     */
    it('disables Save as user default while nothing differs from the saved defaults', () => {
        renderDrawer({ diverged: [] });
        expect(screen.getByTestId('save-as-default')).toBeDisabled();
        expect(screen.getByTestId('change-defaults')).toHaveTextContent('Nothing here differs from your saved defaults.');
    });

    it('enables it, and explains the tally, once something diverges', () => {
        renderDrawer({ diverged: ['views:root:scrollNoteIntoView'] });
        expect(screen.getByTestId('save-as-default')).toBeEnabled();
        expect(screen.getByTestId('change-defaults')).toHaveTextContent('Settings diverged from the defaults and are already saved');
    });

    it('disables Revert to defaults when this workspace overrides nothing', () => {
        renderDrawer({ canResetToDefault: false });
        expect(screen.getByTestId('revert-to-defaults')).toBeDisabled();
    });


    /*
     * The explicit button replaces the old automatic offer: it is always there in the Custom view types
     * disclosure, whatever is or is not diverged, because minting no longer depends on a change having
     * landed on an ancestor-owned setting - a built-in view's own value already lives in its own place
     * (the viewOverrides map), so there is nothing left for an "offer" to react to.
     */
    it('always offers the explicit Save as new view type button, regardless of divergence', () => {
        renderDrawer({ diverged: [] });
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        expect(screen.getByTestId('new-view-type-open')).toBeInTheDocument();
    });

    it('is closed by default, since nothing fires automatically any more', () => {
        renderDrawer();
        expect(screen.getByTestId('custom-view-types')).not.toHaveAttribute('open');
    });

    it('opens on click and the name form opens pre-filled with the selected view named as a copy of it', () => {
        renderDrawer();
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        expect(screen.getByTestId('custom-view-types')).toHaveAttribute('open');
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        expect(screen.getByTestId('new-view-type-name')).toHaveValue('Kanban copy');
    });

    /*
     * Minting starts the new type with an empty bag of its own - parent and label only - whatever the
     * selected view's own bag holds: everything it holds, stored or built-in, is already reachable
     * through the parent link, so copying it in would only bake in a redundant explicit entry that can
     * drift from its source (and would wrongly read as this view's OWN value rather than inherited).
     */
    it('mints a type with an empty bag, never copying the selected built-in view\'s own values', () => {
        const on_setting_change = jest.fn();
        const on_view_type_change = jest.fn();
        renderDrawer({
            onSettingChange: on_setting_change,
            onViewTypeChange: on_view_type_change,
            settings: { viewOverrides: { kanban: { groupBy: 'assignee', orientation: 'rows' } } },
        });
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        expect(mintedBag(on_setting_change)).toEqual({
            node_id: 'user-kanban-copy',
            bag: { parent: 'kanban', label: 'Kanban copy' },
        });
        expect(on_view_type_change).toHaveBeenCalledWith('user-kanban-copy');
        // minting is a copy, not a move - kanban's own entry is never cleared
        expect(on_setting_change).not.toHaveBeenCalledWith('views', expect.objectContaining({ sets: expect.arrayContaining([expect.objectContaining({ node_id: 'kanban', value: undefined })]) }));
    });

    it('mints a type with no overrides at all when the selected view holds no value of its own', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        expect(mintedBag(on_setting_change)).toEqual({ node_id: 'user-kanban-copy', bag: { parent: 'kanban', label: 'Kanban copy' } });
    });

    it('mints a type with an empty bag when saved from a selected saved type, parented on that type', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ userTypes: [MINTED], viewTypeSelection: MINTED.id, currentType: MINTED.id, onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        expect(mintedBag(on_setting_change)).toEqual({
            node_id: 'user-kanban-by-owner-copy',
            bag: { parent: 'user-kanban-by-owner', label: 'Kanban by Owner copy' },
        });
    });

    it('leaves an already-saved type untouched, since minting writes only the new node\'s own entry', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ userTypes: [MINTED], onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        for (const [, value] of on_setting_change.mock.calls) {
            const sets = (value as { sets?: Array<{ node_id: string }> }).sets ?? [];
            expect(sets.some(op => op.node_id === MINTED.id)).toBe(false);
        }
    });

    it('renders the Custom view types panel for a minted type, with no button-click needed to reach rename/delete', () => {
        renderDrawer({ userTypes: [MINTED] });
        fireEvent.click(screen.getByTestId(`view-node-${MINTED.id}`));
        fireEvent.click(screen.getByTestId('custom-view-types-summary'));
        expect(screen.getByTestId('custom-view-types-summary')).toHaveTextContent('Custom view types');
        expect(screen.getByTestId('user-view-type-controls')).toBeInTheDocument();
    });
});

/*
 * Renaming and deleting are offered on a minted type and on nothing else - a built-in rung is not the
 * user's to remove - so every case here first moves the highlight onto the minted node.
 */
describe('SettingsViewDrawer custom view types', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    function renderOnMintedType(overrides: Partial<typeof default_props> = {}): void {
        renderDrawer({ userTypes: [MINTED], ...overrides });
        fireEvent.click(screen.getByTestId(`view-node-${MINTED.id}`));
    }

    it('offers no rename or delete on a built-in rung', () => {
        renderDrawer({ userTypes: [MINTED] });
        expect(screen.queryByTestId('user-view-type-controls')).not.toBeInTheDocument();
    });

    it('offers rename and delete once the highlight is on a minted type', () => {
        renderOnMintedType();
        expect(screen.getByTestId('user-view-type-name')).toHaveValue('Kanban by Owner');
        expect(screen.getByTestId('user-view-type-rename')).toBeInTheDocument();
        expect(screen.getByTestId('user-view-type-delete')).toBeInTheDocument();
    });

    it('keeps Rename disabled until the name actually changes', () => {
        renderOnMintedType();
        expect(screen.getByTestId('user-view-type-rename')).toBeDisabled();
        fireEvent.change(screen.getByTestId('user-view-type-name'), { target: { value: '  ' } });
        expect(screen.getByTestId('user-view-type-rename')).toBeDisabled();
        fireEvent.change(screen.getByTestId('user-view-type-name'), { target: { value: 'Kanban by Owner ' } });
        expect(screen.getByTestId('user-view-type-rename')).toBeDisabled();
    });

    it('writes the new label and leaves the id alone, since settings are stored under the id', () => {
        const on_setting_change = jest.fn();
        renderOnMintedType({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('user-view-type-name'), { target: { value: 'Kanban by Lead' } });
        fireEvent.click(screen.getByTestId('user-view-type-rename'));
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: MINTED.id, key: 'label', value: 'Kanban by Lead' }] });
    });

    it('asks twice before deleting, because a webview does not honour window.confirm', () => {
        const on_setting_change = jest.fn();
        renderOnMintedType({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('user-view-type-delete'));
        expect(on_setting_change).not.toHaveBeenCalled();
        expect(screen.getByTestId('user-view-type-delete-confirm')).toHaveTextContent('Delete Kanban by Owner');
        fireEvent.click(screen.getByTestId('user-view-type-delete-confirm'));
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: MINTED.id, key: null, value: undefined }] });
    });

    it('backs out of the delete without writing anything', () => {
        const on_setting_change = jest.fn();
        renderOnMintedType({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('user-view-type-delete'));
        fireEvent.click(screen.getByTestId('user-view-type-delete-cancel'));
        expect(screen.getByTestId('user-view-type-delete')).toBeInTheDocument();
        expect(on_setting_change).not.toHaveBeenCalled();
    });

    /*
     * Deleting the type the board is rendering would leave the view-type setting naming a node the
     * registry no longer builds, so the selection is handed back to the parent in the same act.
     */
    it('hands the board back to the parent when the deleted type is the one being rendered', () => {
        const on_view_type_change = jest.fn();
        renderDrawer({ userTypes: [MINTED], viewTypeSelection: MINTED.id, currentType: MINTED.id, onViewTypeChange: on_view_type_change });
        fireEvent.click(screen.getByTestId('user-view-type-delete'));
        fireEvent.click(screen.getByTestId('user-view-type-delete-confirm'));
        expect(on_view_type_change).toHaveBeenCalledWith('kanban');
    });

    it('leaves the board alone when the deleted type is not the one being rendered', () => {
        const on_view_type_change = jest.fn();
        renderOnMintedType({ onViewTypeChange: on_view_type_change });
        fireEvent.click(screen.getByTestId('user-view-type-delete'));
        fireEvent.click(screen.getByTestId('user-view-type-delete-confirm'));
        expect(on_view_type_change).not.toHaveBeenCalled();
    });
});

describe('minting a view type', () => {

    it('slugs the label once, prefixes it, and never collides with a built-in rung', () => {
        expect(mintUserViewTypeId('Kanban by Assignee', VIEW_REGISTRY)).toBe('user-kanban-by-assignee');
        expect(mintUserViewTypeId('  Kanban / by "Assignee"  ', VIEW_REGISTRY)).toBe('user-kanban-by-assignee');
        expect(mintUserViewTypeId('kanban', VIEW_REGISTRY)).toBe('user-kanban');
    });

    it('suffixes a second minting of the same name rather than reusing the id already on disk', () => {
        const registry = { ...VIEW_REGISTRY, nodes: [...VIEW_REGISTRY.nodes, { id: 'user-kanban-by-assignee', parent: 'kanban', kind: 'concrete' as const, selectable: true, configurable: true, label: 'Kanban by Assignee' }] };
        expect(mintUserViewTypeId('Kanban by Assignee', registry)).toBe('user-kanban-by-assignee-2');
    });

    it('names the save form\'s default as a copy of the selected view', () => {
        expect(newViewTypeNameHint('Kanban')).toBe('Kanban copy');
    });
});

describe('the group breadth row', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        act(() => { setBreadthDraft('v1', undefined); });
    });

    it('is a pixel text box labelled Column width while the groups are columns and Row height once they are rows', () => {
        renderDrawer({ settings: { orientation: 'columns' } });
        expect(screen.getByTestId('setting-control-lineBreadth')).toHaveAttribute('aria-label', 'Column width');
        expect(screen.getByTestId('setting-row-lineBreadth')).toHaveTextContent('Column width');
        renderDrawer({ settings: { orientation: 'rows' } });
        expect(screen.getAllByTestId('setting-control-lineBreadth').at(-1)).toHaveAttribute('aria-label', 'Row height');
    });

    it('shows the saved breadth, falling back to the default before the cascade arrives', () => {
        renderDrawer({ settings: { lineBreadth: 340 } });
        expect(screen.getByTestId('setting-control-lineBreadth')).toHaveValue('340');
    });

    it('follows a drag live by showing the draft breadth', () => {
        renderDrawer({ settings: { lineBreadth: 340 } });
        act(() => { setBreadthDraft('v1', 410); });
        expect(screen.getByTestId('setting-control-lineBreadth')).toHaveValue('410');
    });

    it('writes a typed number on Enter, flat, once selected on line, its own home', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ settings: { lineBreadth: 340 }, onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('view-node-line'));
        const box = screen.getByTestId('setting-control-lineBreadth');
        fireEvent.change(box, { target: { value: '400' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'line', key: 'lineBreadth', value: 400 }] });
    });

    it('writes into kanban\'s own viewOverrides entry when selected there, never line\'s flat key', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ settings: { lineBreadth: 340 }, onSettingChange: on_setting_change });
        const box = screen.getByTestId('setting-control-lineBreadth');
        fireEvent.change(box, { target: { value: '400' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'lineBreadth', value: 400 }] });
    });

    it('clamps a number under the floor', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ settings: { lineBreadth: 340 }, onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('view-node-line'));
        const box = screen.getByTestId('setting-control-lineBreadth');
        fireEvent.change(box, { target: { value: '30' } });
        fireEvent.blur(box);
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'line', key: 'lineBreadth', value: 120 }] });
    });

    it('rejects what is not a number, writes nothing and goes back to the saved value', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ settings: { lineBreadth: 340 }, onSettingChange: on_setting_change });
        const box = screen.getByTestId('setting-control-lineBreadth');
        fireEvent.change(box, { target: { value: 'wide' } });
        fireEvent.blur(box);
        expect(on_setting_change).not.toHaveBeenCalled();
        expect(box).toHaveValue('340');
    });
});

describe('SettingsViewDrawer per-view pills, hovers and clearing', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    /*
     * The bug requirement #2 fixes: the drawer used to read `props.settings[key]`, which composerops
     * folded with the RENDERED type's own overrides, so selecting an ancestor while a saved type with
     * its own value was on screen still showed the saved type's value. Now `props.settings` is the raw
     * flat cascade and every row resolves for the SELECTED node, so selecting Line here must show
     * Line's own flat value, not the rendered saved type's.
     */
    it('selecting Line while a saved type with its own orientation is rendered shows Line\'s own value', () => {
        const rendered_type: UserViewType = { id: 'user-tall-rows', label: 'Tall Rows', parent: 'kanban', overrides: { orientation: 'rows' } };
        renderDrawer({
            userTypes: [rendered_type],
            currentType: rendered_type.id,
            viewTypeSelection: rendered_type.id,
            settings: { orientation: 'columns' },
        });
        // the rendered type's own orientation, as seen before navigating the tree at all
        expect((screen.getByTestId('setting-control-orientation') as HTMLSelectElement).value).toBe('rows');
        fireEvent.click(screen.getByTestId('view-node-line'));
        expect((screen.getByTestId('setting-control-orientation') as HTMLSelectElement).value).toBe('columns');
        expect(screen.queryByTestId('setting-pill-specific-orientation')).not.toBeInTheDocument();
        expect(screen.queryByTestId('setting-pill-inherited-orientation')).not.toBeInTheDocument();
    });

    it('shows no state pill at a setting\'s own home view', () => {
        renderDrawer();
        fireEvent.click(screen.getByTestId('view-node-line'));
        expect(screen.queryByTestId('setting-pill-inherited-orientation')).not.toBeInTheDocument();
        expect(screen.queryByTestId('setting-pill-specific-orientation')).not.toBeInTheDocument();
    });

    it('shows a grey inherited pill naming the view the value comes from, when the selected descendant holds none of its own', () => {
        renderDrawer();
        const pill = screen.getByTestId('setting-pill-inherited-orientation');
        expect(pill).toHaveAttribute('title', expect.stringContaining('Inherited from Line'));
        expect(screen.queryByTestId('setting-pill-specific-orientation')).not.toBeInTheDocument();
    });

    it('shows a white VS pill once kanban holds its own value, naming Line as where clearing it would inherit from again', () => {
        renderDrawer({ settings: { viewOverrides: { kanban: { orientation: 'rows' } } } });
        const pill = screen.getByTestId('setting-pill-specific-orientation');
        expect(pill).toHaveTextContent('VS');
        expect(pill).toHaveAttribute('title', expect.stringContaining('Line'));
        expect(screen.queryByTestId('setting-pill-inherited-orientation')).not.toBeInTheDocument();
    });

    /*
     * M reflects whichever cell the row actually shows: kanban's own entry when kanban holds one
     * (`views:kanban:orientation`), Line's own entry (`views:line:orientation`) when it is only
     * inheriting from Line. The two never both drive the same row's M, and a row at Line's own home
     * answers to Line's own cell too - there is no separate flat key for a per-view setting any more.
     */
    it('marks M from kanban\'s own cell when kanban holds its own value, not from Line\'s own cell', () => {
        renderDrawer({
            settings: { orientation: 'columns', viewOverrides: { kanban: { orientation: 'rows' } } },
            diverged: ['views:kanban:orientation'],
        });
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'true');
    });

    it('does not mark M from kanban\'s own cell when kanban is only inheriting, even if that cell is diverged elsewhere', () => {
        renderDrawer({
            settings: { orientation: 'columns' },
            diverged: ['views:kanban:orientation'],
        });
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'false');
    });

    it('marks M from Line\'s own cell once selected on Line (orientation\'s own home), ignoring kanban\'s cell', () => {
        renderDrawer({
            settings: { orientation: 'columns' },
            diverged: ['views:line:orientation', 'views:kanban:orientation'],
        });
        fireEvent.click(screen.getByTestId('view-node-line'));
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'true');
    });

    it('clears kanban\'s own orientation, rather than writing it, when the new value equals what it would inherit', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ settings: { orientation: 'rows', viewOverrides: { kanban: { orientation: 'columns' } } }, onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('setting-control-orientation'), { target: { value: 'rows' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'orientation', value: undefined }] });
    });

    it('clears kanban\'s own stored groupBy when set back to status, its built-in default', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ settings: { viewOverrides: { kanban: { groupBy: 'assignee' } } }, onSettingChange: on_setting_change, groupByCandidateKeys: ['assignee', 'status'] });
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'status' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'groupBy', value: undefined }] });
    });

    it('stores (VS) kanban\'s own groupBy when it diverges from its built-in default', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change, groupByCandidateKeys: ['assignee', 'status'] });
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'assignee' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: 'kanban', key: 'groupBy', value: 'assignee' }] });
    });

    it('clears a saved type\'s own groupBy, rather than writing it, when the new value equals what it would inherit', () => {
        // MINTED's parent is kanban, so it inherits kanban's own built-in status default, not the flat home value
        const on_setting_change = jest.fn();
        renderDrawer({ userTypes: [MINTED], onSettingChange: on_setting_change, settings: { groupBy: 'auto' }, groupByCandidateKeys: ['owner', 'status'] });
        fireEvent.click(screen.getByTestId(`view-node-${MINTED.id}`));
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'status' } });
        expect(on_setting_change).toHaveBeenCalledWith('views', { sets: [{ node_id: MINTED.id, key: 'groupBy', value: undefined }] });
    });

    it('labels the dropdown option matching the inherited value, whether or not the selected view holds its own', () => {
        renderDrawer({ settings: { orientation: 'rows' } });
        const select = screen.getByTestId('setting-control-orientation') as HTMLSelectElement;
        expect(within(select).getByText('Rows (inherited)')).toBeInTheDocument();
        expect(within(select).queryByText('Columns (inherited)')).not.toBeInTheDocument();
    });

    it('still names the inherited option once the selected view holds its own, different, value', () => {
        renderDrawer({ settings: { orientation: 'rows', viewOverrides: { kanban: { orientation: 'columns' } } } });
        const select = screen.getByTestId('setting-control-orientation') as HTMLSelectElement;
        expect(select.value).toBe('columns');
        expect(within(select).getByText('Rows (inherited)')).toBeInTheDocument();
    });
});

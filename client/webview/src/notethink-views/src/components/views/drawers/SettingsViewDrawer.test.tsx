import React from 'react';
import { render, screen, fireEvent, within, act, type RenderResult } from '@testing-library/react';
import type { DropResult } from '@hello-pangea/dnd';
import type { UserViewType } from '../../../types/Messages';
import SettingsViewDrawer, { mintUserViewTypeId, newViewTypeNameHint } from './SettingsViewDrawer';
import { VIEW_REGISTRY } from '../../../lib/viewregistryops';
import { CARD_SETTING_ROWS, VIEW_SETTING_ROWS } from '../settingRows';

/*
 * The lane-order chips drag through @hello-pangea/dnd, which needs real layout to run a gesture. The
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
            source: { index: from_index, droppableId: 'v1-column-order' },
            destination: { index: to_index, droppableId: 'v1-column-order' },
        } as DropResult);
    });
}

/** the lane chips in the order the control lists them */
function renderedChipValues(): string[] {
    return screen.getAllByTestId(/^column-order-chip-/).map(el => el.getAttribute('data-testid')!.replace('column-order-chip-', ''));
}

// one saved type, used wherever a case needs a node the user owns rather than a built-in rung
const MINTED: UserViewType = { id: 'user-kanban-by-owner', label: 'Kanban by Owner', parent: 'kanban', overrides: { kanbanGroupBy: 'owner' } };

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
    onColumnOrderChange: jest.fn(),
    groupByResolvedKey: 'status',
    groupByCandidateKeys: ['assignee', 'status'],
    onMakeDefault: jest.fn(),
    onResetToDefault: jest.fn(),
    canResetToDefault: true,
};

function renderDrawer(overrides: Partial<typeof default_props> = {}): RenderResult {
    return render(<SettingsViewDrawer {...default_props} {...overrides} />);
}

/** the view types a save wrote, picked out of the several setting writes a save now makes */
function mintedTypes(on_setting_change: jest.Mock): UserViewType[] {
    const call = on_setting_change.mock.calls.filter(([key]) => key === 'viewUserTypes').at(-1);
    return (call?.[1] ?? []) as UserViewType[];
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
        // grouped is nested under root, and kanban under line, so the tree is a hierarchy rather than a flat list
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
        expect(screen.getByTestId('view-node-count-grouped')).toHaveTextContent('(1)');
        expect(screen.getByTestId('view-node-count-line')).toHaveTextContent('(1)');
        expect(screen.getByTestId('view-node-count-kanban')).toHaveTextContent('(4)');
    });

    it('clicking an abstract node shows its settings and leaves the rendered view alone', () => {
        const on_view_type_change = jest.fn();
        renderDrawer({ onViewTypeChange: on_view_type_change });
        expect(renderedRowKeys()).toContain('kanbanGroupBy');
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        expect(on_view_type_change).not.toHaveBeenCalled();
        expect(renderedRowKeys()).toContain('groupBy');
        expect(renderedRowKeys()).not.toContain('kanbanGroupBy');
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
            userTypes: [{ id: 'user-kanban-by-assignee', label: 'Kanban by Assignee', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee' } }],
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

    it('orders the rows by the type each is pilled to and gives each one that type', () => {
        renderDrawer();
        // the list reads down the pill column - Kanban, Line, Grouped, All views - which is the tree above it upside down
        expect(renderedRowKeys()).toEqual([
            'columnOrder',
            'kanbanCardRatio',
            'kanbanAnimateTransitions',
            'orientation',
            'kanbanGroupBy',
            'scrollNoteIntoView',
            'watchUnopenedFilesInViewer',
            'openNewEditorIfNoneOpen',
        ]);
        expect(screen.getByTestId('setting-pill-kanbanGroupBy')).toHaveTextContent('Grouped');
        expect(screen.getByTestId('setting-pill-columnOrder')).toHaveTextContent('Kanban');
        expect(screen.getByTestId('setting-pill-orientation')).toHaveTextContent('Line');
        expect(screen.getByTestId('setting-pill-scrollNoteIntoView')).toHaveTextContent('All views');
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
        // the drawer's own title is the short form, so the pane headings are the only place the axis is spelled out
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
        renderDrawer({ diverged: ['kanbanGroupBy', 'scrollNoteIntoView', 'includeFilter'] });
        const marked = screen.getAllByTestId(/^setting-row-/).filter(row => row.getAttribute('data-diverged') === 'true');
        expect(marked.map(row => row.getAttribute('data-testid'))).toEqual(['setting-row-kanbanGroupBy', 'setting-row-scrollNoteIntoView']);
        expect(screen.getAllByTestId(/^setting-marker-/)).toHaveLength(2);
        // includeFilter diverges but renders no row here, so it is not counted - the tally is of M-marked rows
        expect(screen.getByTestId('diverged-count')).toHaveTextContent('(2 settings diverged)');
    });

    it('tallies zero when nothing has diverged, so the summary reads the same either way', () => {
        renderDrawer({ diverged: [] });
        expect(screen.getByTestId('diverged-count')).toHaveTextContent('(0 settings diverged)');
    });

    it('states the tally on the collapsed summary and the sentence explaining it inside', () => {
        renderDrawer({ diverged: ['scrollNoteIntoView'] });
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
        fireEvent.change(screen.getByTestId('setting-control-kanbanCardRatio'), { target: { value: '2' } });
        expect(on_setting_change).toHaveBeenCalledWith('kanbanCardRatio', 2);
    });

    it('offers the card ratio on a kanban board and nowhere above it, since the width is a kanban concern', () => {
        renderDrawer();
        expect(screen.getByTestId('setting-row-kanbanCardRatio')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('view-node-line'));
        expect(screen.queryByTestId('setting-row-kanbanCardRatio')).not.toBeInTheDocument();
    });

    it('changing Group by from kanban writes the kanban override and leaves the ancestor key alone', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'assignee' } });
        expect(on_setting_change).toHaveBeenCalledTimes(1);
        expect(on_setting_change).toHaveBeenCalledWith('kanbanGroupBy', 'assignee');
    });

    it('changing Group by from the grouped node writes the ancestor key instead', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('view-node-grouped'));
        fireEvent.change(screen.getByTestId('group-by-selector'), { target: { value: 'assignee' } });
        expect(on_setting_change).toHaveBeenCalledWith('groupBy', 'assignee');
    });

    it('renders the orientation control and writes the chosen value', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change });
        fireEvent.change(screen.getByTestId('setting-control-orientation'), { target: { value: 'rows' } });
        expect(on_setting_change).toHaveBeenCalledWith('orientation', 'rows');
    });

    it('lists every lane as a chip, in the order the board lays the lanes out', () => {
        renderDrawer();
        expect(renderedChipValues()).toEqual(['doing', 'done', 'untagged']);
        expect(screen.getByLabelText('Reorder Done')).toBeInTheDocument();
    });

    it('routes a dropped lane through the column-order handler that normalises the natural order', () => {
        const on_column_order_change = jest.fn();
        const on_setting_change = jest.fn();
        renderDrawer({ onColumnOrderChange: on_column_order_change, onSettingChange: on_setting_change });
        dropChip(1, 0);
        expect(on_column_order_change).toHaveBeenCalledWith(['done', 'doing', 'untagged']);
        expect(on_setting_change).not.toHaveBeenCalled();
    });

    it('writes nothing when a lane is dropped outside the list, or back where it started', () => {
        const on_column_order_change = jest.fn();
        renderDrawer({ onColumnOrderChange: on_column_order_change });
        act(() => { captured_drag_end?.({ source: { index: 1, droppableId: 'v1-column-order' }, destination: null } as DropResult); });
        dropChip(1, 1);
        expect(on_column_order_change).not.toHaveBeenCalled();
    });

    it('toggles a checkbox row through the one setting-change path', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change, settings: { scrollNoteIntoView: false } });
        fireEvent.click(screen.getByTestId('setting-control-scrollNoteIntoView'));
        expect(on_setting_change).toHaveBeenCalledWith('scrollNoteIntoView', true);
    });

    it('falls back to each setting built-in default before the first cascade arrives', () => {
        renderDrawer({ settings: {} });
        expect(screen.getByTestId('setting-control-scrollNoteIntoView')).toBeChecked();
        expect(screen.getByTestId('setting-control-openNewEditorIfNoneOpen')).not.toBeChecked();
        expect(screen.getByTestId('setting-control-kanbanAnimateTransitions')).toBeChecked();
    });
});

describe('SettingsViewDrawer defaults and new view types', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('collapses both default actions into one Change defaults disclosure', () => {
        const on_make_default = jest.fn();
        const on_reset = jest.fn();
        renderDrawer({ onMakeDefault: on_make_default, onResetToDefault: on_reset, diverged: ['scrollNoteIntoView'] });
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
        renderDrawer({ diverged: ['scrollNoteIntoView'] });
        expect(screen.getByTestId('save-as-default')).toBeEnabled();
        expect(screen.getByTestId('change-defaults')).toHaveTextContent('Settings diverged from the defaults and are already saved');
    });

    it('disables Revert to defaults when this workspace overrides nothing', () => {
        renderDrawer({ canResetToDefault: false });
        expect(screen.getByTestId('revert-to-defaults')).toBeDisabled();
    });

    /*
     * The offer is asked of the settings, not remembered from a click, which is what makes it survive a
     * reload: a board reopened with an ancestor-owned row still diverged makes the same offer it made when
     * the change landed. Nothing is touched in this case - the drawer is simply rendered in that state.
     */
    it('offers a new view type for a diverged setting an ancestor owns, with nothing touched', () => {
        renderDrawer({ diverged: ['kanbanGroupBy'] });
        expect(screen.getByTestId('new-view-type-offer')).toBeInTheDocument();
    });

    it('offers nothing once the cascade says the row is back at its default', () => {
        const { rerender } = renderDrawer({ diverged: ['kanbanGroupBy'] });
        expect(screen.getByTestId('new-view-type-offer')).toBeInTheDocument();
        rerender(<SettingsViewDrawer {...default_props} diverged={[]} />);
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
    });

    /*
     * Every ancestor-owned departure is a reason, not just the most recent one, so a board that has drifted
     * on two of them mints a type carrying both rather than losing one of them silently.
     */
    it('carries every ancestor-owned divergence into the minted type', () => {
        const on_setting_change = jest.fn();
        renderDrawer({
            onSettingChange: on_setting_change,
            diverged: ['kanbanGroupBy', 'orientation'],
            settings: { kanbanGroupBy: 'assignee', orientation: 'rows' },
        });
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        const written = mintedTypes(on_setting_change);
        expect(written[0].overrides).toEqual({ kanbanGroupBy: 'assignee', orientation: 'rows' });
    });

    /*
     * Saving is three writes, and the two that used to be missing are what made the button lie. The
     * overrides only apply while the board renders as the minted node, so an unpinned type contributes
     * nothing; and the values have to come off the parent, or the offer's promise to keep the change
     * "without altering the type it came from" is simply false and the row stays diverged.
     */
    it('pins the minted type and clears the captured keys off the parent', () => {
        const on_setting_change = jest.fn();
        const on_view_type_change = jest.fn();
        renderDrawer({
            onSettingChange: on_setting_change,
            onViewTypeChange: on_view_type_change,
            diverged: ['kanbanGroupBy'],
            settings: { kanbanGroupBy: 'assignee' },
        });
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        expect(on_view_type_change).toHaveBeenCalledWith('user-kanban-by-assignee');
        expect(on_setting_change).toHaveBeenCalledWith('kanbanGroupBy', undefined);
    });

    /*
     * What the three writes add up to, played through the cascade the way the extension echoes it: the
     * type exists, the board renders as it, the key is off the parent and so no longer diverges. The offer
     * is spent, and the panel now carries the minted type's own rename and delete instead - which is what
     * stops a second save minting the same departure again under a `-2` id.
     */
    it('spends the offer once the cascade comes back with the type saved and the key cleared', () => {
        const minted: UserViewType = { id: 'user-kanban-by-assignee', label: 'Kanban by Assignee', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee' } };
        const { rerender } = renderDrawer({ diverged: ['kanbanGroupBy'], settings: { kanbanGroupBy: 'assignee' } });
        expect(screen.getByTestId('new-view-type-offer')).toBeInTheDocument();
        rerender(
            <SettingsViewDrawer
                {...default_props}
                userTypes={[minted]}
                currentType={minted.id}
                viewTypeSelection={minted.id}
                diverged={[]}
                settings={{ kanbanGroupBy: 'assignee' }}
            />,
        );
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
        expect(screen.getByTestId('user-view-type-controls')).toBeInTheDocument();
    });

    it('offers nothing when the change lands on a setting the selected node owns itself', () => {
        renderDrawer();
        dropChip(1, 0);
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
    });

    it('offers nothing when the change lands on a setting with no owning type at all', () => {
        renderDrawer();
        fireEvent.click(screen.getByTestId('setting-control-watchUnopenedFilesInViewer'));
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
    });

    it('offers nothing for a setting All views owns, which reaches every view and so defines no type', () => {
        renderDrawer();
        expect(screen.getByTestId('setting-pill-scrollNoteIntoView')).toHaveTextContent('All views');
        fireEvent.click(screen.getByTestId('setting-control-scrollNoteIntoView'));
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
    });

    it('pre-fills the name from the node plus what changed, and appends the minted type on save', () => {
        const on_setting_change = jest.fn();
        renderDrawer({ onSettingChange: on_setting_change, diverged: ['kanbanGroupBy'], settings: { kanbanGroupBy: 'assignee' } });
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        expect(screen.getByTestId('new-view-type-name')).toHaveValue('Kanban by Assignee');
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        expect(mintedTypes(on_setting_change)).toEqual([{
            id: 'user-kanban-by-assignee',
            label: 'Kanban by Assignee',
            parent: 'kanban',
            overrides: { kanbanGroupBy: 'assignee' },
        }]);
    });

    it('keeps an already-saved type and appends beside it rather than replacing it', () => {
        const on_setting_change = jest.fn();
        const existing: UserViewType = { id: 'user-kanban-by-owner', label: 'Kanban by Owner', parent: 'kanban', overrides: { kanbanGroupBy: 'owner' } };
        renderDrawer({ onSettingChange: on_setting_change, userTypes: [existing], diverged: ['kanbanGroupBy'], settings: { kanbanGroupBy: 'assignee' } });
        fireEvent.click(screen.getByTestId('new-view-type-open'));
        fireEvent.click(screen.getByTestId('new-view-type-save'));
        const written = mintedTypes(on_setting_change);
        expect(written).toHaveLength(2);
        expect(written[0]).toBe(existing);
    });

    it('drops the offer when the highlight moves to a node the row does not hang off', () => {
        renderDrawer({ diverged: ['kanbanGroupBy'] });
        expect(screen.getByTestId('new-view-type-offer')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('view-node-document'));
        expect(screen.queryByTestId('new-view-type-offer')).not.toBeInTheDocument();
    });

    /*
     * The offer used to be a bare button, which asked a question nothing on screen answered. It now leads
     * with which setting moved and which type up the tree owns it, so the reason is on the page rather
     * than in the reader's head.
     */
    it('says which setting moved and which type owns it, rather than offering a bare button', () => {
        renderDrawer({ diverged: ['kanbanGroupBy'] });
        expect(screen.getByTestId('new-view-type-reason')).toHaveTextContent('Group by is owned by Grouped');
    });

    /*
     * An empty panel explaining a feature the reader cannot reach from where they are standing is just
     * clutter, so it appears only when it holds something: an offer to mint, or a minted type to manage.
     */
    it('renders no Custom view types panel while nothing diverges to a type above', () => {
        renderDrawer({ diverged: [] });
        expect(screen.queryByTestId('custom-view-types')).not.toBeInTheDocument();
    });

    it('renders no panel for a divergence the selected node owns outright', () => {
        renderDrawer({ diverged: ['columnOrder'] });
        expect(screen.getByTestId('setting-pill-columnOrder')).toHaveTextContent('Kanban');
        expect(screen.queryByTestId('custom-view-types')).not.toBeInTheDocument();
    });

    it('opens the panel it renders, since an offer nobody can see is not an offer', () => {
        renderDrawer({ diverged: ['kanbanGroupBy'] });
        expect(screen.getByTestId('custom-view-types')).toHaveAttribute('open');
    });

    it('renders the panel for a minted type with no offer pending, so it can be renamed or deleted', () => {
        renderDrawer({ userTypes: [MINTED] });
        expect(screen.queryByTestId('custom-view-types')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId(`view-node-${MINTED.id}`));
        expect(screen.getByTestId('custom-view-types-summary')).toHaveTextContent('Custom view types');
        expect(screen.queryByTestId('custom-view-types-count')).not.toBeInTheDocument();
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
        expect(on_setting_change).toHaveBeenCalledWith('viewUserTypes', [{ ...MINTED, label: 'Kanban by Lead' }]);
    });

    it('asks twice before deleting, because a webview does not honour window.confirm', () => {
        const on_setting_change = jest.fn();
        renderOnMintedType({ onSettingChange: on_setting_change });
        fireEvent.click(screen.getByTestId('user-view-type-delete'));
        expect(on_setting_change).not.toHaveBeenCalled();
        expect(screen.getByTestId('user-view-type-delete-confirm')).toHaveTextContent('Delete Kanban by Owner');
        fireEvent.click(screen.getByTestId('user-view-type-delete-confirm'));
        expect(on_setting_change).toHaveBeenCalledWith('viewUserTypes', []);
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

    it('names a boolean change by the setting rather than by its value', () => {
        const scroll = VIEW_SETTING_ROWS.find(def => def.key === 'scrollNoteIntoView')!;
        expect(newViewTypeNameHint('Kanban', scroll, true)).toBe('Kanban with Scroll note into view');
        expect(newViewTypeNameHint('Kanban', scroll, false)).toBe('Kanban without Scroll note into view');
    });
});

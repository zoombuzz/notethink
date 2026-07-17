import React from 'react';
import { render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import SettingsKanbanDrawer from './SettingsKanbanDrawer';

const default_props = {
    settings: {},
    viewTypeSelection: 'auto',
    autoResolvedType: 'document',
    onViewTypeChange: jest.fn(),
    naturalColumnOrder: ['doing', 'done', 'untagged'],
    showLineNumbers: false,
    onSettingChange: jest.fn(),
    onGlobalSettingChange: jest.fn(),
    onColumnOrderChange: jest.fn(),
};

function renderDrawer(overrides: Partial<typeof default_props> = {}): RenderResult {
    const props = { ...default_props, ...overrides };
    return render(<SettingsKanbanDrawer {...props} />);
}

describe('SettingsKanbanDrawer', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the drawer body (no native dialog)', () => {
        renderDrawer();
        expect(screen.getByTestId('settings-drawer-kanban')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    });

    it('shows column order list (custom order if set, else natural)', () => {
        renderDrawer({ settings: { columnOrder: ['done', 'doing', 'untagged'] } });
        // formatColumnLabel formats the raw status slug (dashes → spaces, title-case)
        const items = screen.getAllByText(/^(Doing|Done|Untagged)$/);
        expect(items.map(el => el.textContent)).toEqual(['Done', 'Doing', 'Untagged']);
    });

    it('falls back to naturalColumnOrder when no custom order is set', () => {
        renderDrawer({ settings: {} });
        const items = screen.getAllByText(/^(Doing|Done|Untagged)$/);
        expect(items.map(el => el.textContent)).toEqual(['Doing', 'Done', 'Untagged']);
    });

    it('appends live columns missing from a stale saved order so they stay reorderable', () => {
        // a note has status=testing (so naturalColumnOrder includes it) but the saved columnOrder predates it - testing must still appear and be movable
        renderDrawer({
            settings: { columnOrder: ['done', 'doing', 'untagged'] },
            naturalColumnOrder: ['doing', 'done', 'testing', 'untagged'],
        });
        const items = screen.getAllByText(/^(Doing|Done|Testing|Untagged)$/);
        expect(items.map(el => el.textContent)).toEqual(['Done', 'Doing', 'Untagged', 'Testing']);
        expect(screen.getByLabelText('Move Testing up')).toBeInTheDocument();
    });

    it('clicking move-up dispatches onColumnOrderChange with the swapped order', () => {
        const on_order = jest.fn();
        renderDrawer({ onColumnOrderChange: on_order });
        // move 'done' up (it's at index 1; first row's up button is disabled, so use the 2nd row's up button)
        const up_buttons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.startsWith('Move'));
        const move_done_up = up_buttons.find(b => b.getAttribute('aria-label') === 'Move Done up')!;
        fireEvent.click(move_done_up);
        expect(on_order).toHaveBeenCalledTimes(1);
        // dispatched payload is the raw slug (data), not the display label
        expect(on_order).toHaveBeenCalledWith(['done', 'doing', 'untagged']);
    });

    it('clicking move-down dispatches onColumnOrderChange with the swapped order', () => {
        const on_order = jest.fn();
        renderDrawer({ onColumnOrderChange: on_order });
        const move_doing_down = screen.getByLabelText('Move Doing down');
        fireEvent.click(move_doing_down);
        expect(on_order).toHaveBeenCalledTimes(1);
        expect(on_order).toHaveBeenCalledWith(['done', 'doing', 'untagged']);
    });

    it('clicking Reset order dispatches onColumnOrderChange with the natural order', () => {
        const on_order = jest.fn();
        renderDrawer({
            settings: { columnOrder: ['done', 'doing', 'untagged'] },
            onColumnOrderChange: on_order,
        });
        fireEvent.click(screen.getByText('Reset order'));
        expect(on_order).toHaveBeenCalledTimes(1);
        expect(on_order).toHaveBeenCalledWith(['doing', 'done', 'untagged']);
    });

    it('toggling a common checkbox dispatches onSettingChange immediately', () => {
        const on_change = jest.fn();
        renderDrawer({ onSettingChange: on_change });
        const linetags_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('linetag')
        )!;
        fireEvent.click(linetags_cb);
        expect(on_change).toHaveBeenCalledTimes(1);
        expect(on_change).toHaveBeenCalledWith('showLinetagsInHeadlines', true);
    });

    it('toggling the line numbers checkbox dispatches onGlobalSettingChange immediately', () => {
        const on_global = jest.fn();
        renderDrawer({ onGlobalSettingChange: on_global });
        const line_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('line numbers')
        )!;
        fireEvent.click(line_cb);
        expect(on_global).toHaveBeenCalledTimes(1);
        expect(on_global).toHaveBeenCalledWith('showLineNumbers', true);
    });

    it('renders the animate-passive-transitions checkbox checked by default', () => {
        renderDrawer();
        const animate_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('Animate passive transitions')
        ) as HTMLInputElement | undefined;
        expect(animate_cb).toBeInTheDocument();
        expect(animate_cb!.checked).toBe(true);
    });

    it('reflects the kanbanAnimateTransitions prop when false', () => {
        renderDrawer({ kanbanAnimateTransitions: false });
        const animate_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('Animate passive transitions')
        ) as HTMLInputElement | undefined;
        expect(animate_cb!.checked).toBe(false);
    });

    it('toggling the animate-passive-transitions checkbox dispatches onGlobalSettingChange', () => {
        const on_global = jest.fn();
        renderDrawer({ kanbanAnimateTransitions: true, onGlobalSettingChange: on_global });
        const animate_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('Animate passive transitions')
        )!;
        fireEvent.click(animate_cb);
        expect(on_global).toHaveBeenCalledTimes(1);
        expect(on_global).toHaveBeenCalledWith('kanbanAnimateTransitions', false);
    });

    it('has no Save or Cancel button', () => {
        renderDrawer();
        expect(screen.queryByText('Save')).not.toBeInTheDocument();
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });
});

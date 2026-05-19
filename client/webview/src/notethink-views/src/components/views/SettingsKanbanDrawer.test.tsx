import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsKanbanDrawer from './SettingsKanbanDrawer';

const default_props = {
    settings: {},
    naturalColumnOrder: ['doing', 'done', 'untagged'],
    showLineNumbers: false,
    onSettingChange: jest.fn(),
    onGlobalSettingChange: jest.fn(),
    onColumnOrderChange: jest.fn(),
};

function renderDrawer(overrides: Partial<typeof default_props> = {}) {
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
        renderDrawer({ settings: { column_order: ['done', 'doing', 'untagged'] } });
        const items = screen.getAllByText(/^(doing|done|untagged)$/);
        expect(items.map(el => el.textContent)).toEqual(['done', 'doing', 'untagged']);
    });

    it('falls back to naturalColumnOrder when no custom order is set', () => {
        renderDrawer({ settings: {} });
        const items = screen.getAllByText(/^(doing|done|untagged)$/);
        expect(items.map(el => el.textContent)).toEqual(['doing', 'done', 'untagged']);
    });

    it('appends live columns missing from a stale saved order so they stay reorderable', () => {
        // a note has status=testing (so naturalColumnOrder includes it) but the
        // saved column_order predates it — testing must still appear and be movable
        renderDrawer({
            settings: { column_order: ['done', 'doing', 'untagged'] },
            naturalColumnOrder: ['doing', 'done', 'testing', 'untagged'],
        });
        const items = screen.getAllByText(/^(doing|done|testing|untagged)$/);
        expect(items.map(el => el.textContent)).toEqual(['done', 'doing', 'untagged', 'testing']);
        expect(screen.getByLabelText('Move testing up')).toBeInTheDocument();
    });

    it('clicking move-up dispatches onColumnOrderChange with the swapped order', () => {
        const on_order = jest.fn();
        renderDrawer({ onColumnOrderChange: on_order });
        // move 'done' up (it's at index 1; first row's up button is disabled, so use the 2nd row's up button)
        const up_buttons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.startsWith('Move'));
        const move_done_up = up_buttons.find(b => b.getAttribute('aria-label') === 'Move done up')!;
        fireEvent.click(move_done_up);
        expect(on_order).toHaveBeenCalledTimes(1);
        expect(on_order).toHaveBeenCalledWith(['done', 'doing', 'untagged']);
    });

    it('clicking move-down dispatches onColumnOrderChange with the swapped order', () => {
        const on_order = jest.fn();
        renderDrawer({ onColumnOrderChange: on_order });
        const move_doing_down = screen.getByLabelText('Move doing down');
        fireEvent.click(move_doing_down);
        expect(on_order).toHaveBeenCalledTimes(1);
        expect(on_order).toHaveBeenCalledWith(['done', 'doing', 'untagged']);
    });

    it('clicking Reset order dispatches onColumnOrderChange with the natural order', () => {
        const on_order = jest.fn();
        renderDrawer({
            settings: { column_order: ['done', 'doing', 'untagged'] },
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
        expect(on_change).toHaveBeenCalledWith('show_linetags_in_headlines', true);
    });

    it('toggling the line numbers checkbox dispatches onGlobalSettingChange immediately', () => {
        const on_global = jest.fn();
        renderDrawer({ onGlobalSettingChange: on_global });
        const line_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('line numbers')
        )!;
        fireEvent.click(line_cb);
        expect(on_global).toHaveBeenCalledTimes(1);
        expect(on_global).toHaveBeenCalledWith('show_line_numbers', true);
    });

    it('has no Save or Cancel button', () => {
        renderDrawer();
        expect(screen.queryByText('Save')).not.toBeInTheDocument();
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });
});

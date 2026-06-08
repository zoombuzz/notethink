import React from 'react';
import { render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import SettingsDocumentDrawer from './SettingsDocumentDrawer';

const default_props = {
    settings: {},
    showLineNumbers: false,
    onSettingChange: jest.fn(),
    onGlobalSettingChange: jest.fn(),
};

function renderDrawer(overrides: Partial<typeof default_props> = {}): RenderResult {
    const props = { ...default_props, ...overrides };
    return render(<SettingsDocumentDrawer {...props} />);
}

describe('SettingsDocumentDrawer', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the drawer body (no native dialog)', () => {
        renderDrawer();
        expect(screen.getByTestId('settings-drawer-document')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    });

    it('checkboxes reflect initial settings values', () => {
        renderDrawer({
            settings: {
                showLinetagsInHeadlines: true,
                scrollNoteIntoView: false,
                autoExpandFocusedNote: true,
            },
        });
        const checkboxes = screen.getAllByRole('checkbox');
        const linetags_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('linetag'))!;
        const scroll_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('Scroll'))!;
        const expand_cb = checkboxes.find(cb => cb.closest('label')?.textContent?.includes('Auto-expand'))!;
        expect(linetags_cb).toBeChecked();
        expect(scroll_cb).not.toBeChecked();
        expect(expand_cb).toBeChecked();
    });

    it('auto_expand defaults to unchecked when not set', () => {
        renderDrawer({ settings: {} });
        const expand_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('Auto-expand')
        )!;
        expect(expand_cb).not.toBeChecked();
    });

    it('toggling a per-view checkbox dispatches onSettingChange immediately', () => {
        const on_change = jest.fn();
        renderDrawer({ settings: { autoExpandFocusedNote: false }, onSettingChange: on_change });
        const expand_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('Auto-expand')
        )!;
        fireEvent.click(expand_cb);
        expect(on_change).toHaveBeenCalledTimes(1);
        expect(on_change).toHaveBeenCalledWith('autoExpandFocusedNote', true);
    });

    it('has no Save or Cancel button', () => {
        renderDrawer();
        expect(screen.queryByText('Save')).not.toBeInTheDocument();
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('does not have column order controls', () => {
        renderDrawer();
        expect(screen.queryByText('Column order')).not.toBeInTheDocument();
        expect(screen.queryByText('Reset order')).not.toBeInTheDocument();
    });

    it('shows line numbers checkbox reflecting showLineNumbers prop', () => {
        renderDrawer({ showLineNumbers: true });
        const line_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('line numbers')
        );
        expect(line_cb).toBeChecked();
    });

    it('toggling the line numbers checkbox dispatches onGlobalSettingChange immediately', () => {
        const on_global = jest.fn();
        renderDrawer({ showLineNumbers: false, onGlobalSettingChange: on_global });
        const line_cb = screen.getAllByRole('checkbox').find(
            cb => cb.closest('label')?.textContent?.includes('line numbers')
        )!;
        fireEvent.click(line_cb);
        expect(on_global).toHaveBeenCalledTimes(1);
        expect(on_global).toHaveBeenCalledWith('showLineNumbers', true);
    });

    it('renders the version label', () => {
        renderDrawer();
        expect(screen.getByTestId('version-label')).toBeInTheDocument();
    });
});

import React from 'react';
import { render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import SettingsCommonControls from './SettingsCommonControls';

const default_props = {
    settings: {},
    showLineNumbers: false,
    watchUnopenedFilesInViewer: true,
    onSettingChange: jest.fn(),
    onGlobalSettingChange: jest.fn(),
};

function renderControls(overrides: Partial<typeof default_props> = {}): RenderResult {
    const props = { ...default_props, ...overrides };
    return render(<SettingsCommonControls {...props} />);
}

describe('SettingsCommonControls', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the five common checkboxes', () => {
        renderControls();
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(5);
    });

    it.each([
        ['showLinetagsInHeadlines', 'linetag'],
        ['scrollNoteIntoView', 'Scroll'],
        ['autoExpandFocusedNote', 'Auto-expand'],
    ] as const)('toggles %s via onSettingChange', (key, label_match) => {
        const on_change = jest.fn();
        renderControls({ onSettingChange: on_change });
        const cb = screen.getAllByRole('checkbox').find(
            c => c.closest('label')?.textContent?.includes(label_match)
        )!;
        fireEvent.click(cb);
        expect(on_change).toHaveBeenCalledTimes(1);
        expect(on_change).toHaveBeenCalledWith(key, true);
    });

    it('toggles showLineNumbers via onGlobalSettingChange (not onSettingChange)', () => {
        const on_change = jest.fn();
        const on_global = jest.fn();
        renderControls({ onSettingChange: on_change, onGlobalSettingChange: on_global });
        const cb = screen.getAllByRole('checkbox').find(
            c => c.closest('label')?.textContent?.includes('line numbers')
        )!;
        fireEvent.click(cb);
        expect(on_change).not.toHaveBeenCalled();
        expect(on_global).toHaveBeenCalledTimes(1);
        expect(on_global).toHaveBeenCalledWith('showLineNumbers', true);
    });

    it('toggles watchUnopenedFilesInViewer via onGlobalSettingChange (default-on shows checked)', () => {
        const on_change = jest.fn();
        const on_global = jest.fn();
        renderControls({ onSettingChange: on_change, onGlobalSettingChange: on_global });
        const cb = screen.getAllByRole('checkbox').find(
            c => c.closest('label')?.textContent?.includes('unopened files')
        )! as HTMLInputElement;
        expect(cb.checked).toBe(true);
        fireEvent.click(cb);
        expect(on_change).not.toHaveBeenCalled();
        expect(on_global).toHaveBeenCalledTimes(1);
        expect(on_global).toHaveBeenCalledWith('watchUnopenedFilesInViewer', false);
    });
});

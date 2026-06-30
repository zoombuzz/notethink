import React from 'react';
import { render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import SettingsCascadeButtons from './SettingsCascadeButtons';

const default_props = {
    onMakeDefault: jest.fn(),
    onResetToDefault: jest.fn(),
    canResetToDefault: false,
    onRestoreBuiltinDefault: jest.fn(),
    canRestoreBuiltinDefault: false,
};

function renderButtons(overrides: Partial<typeof default_props> = {}): RenderResult {
    const props = { ...default_props, ...overrides };
    return render(<SettingsCascadeButtons {...props} />);
}

describe('SettingsCascadeButtons', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders all three cascade controls', () => {
        renderButtons();
        expect(screen.getByText('Make user default')).toBeInTheDocument();
        expect(screen.getByText('Reset to user default')).toBeInTheDocument();
        expect(screen.getByText('Reset to built-in default')).toBeInTheDocument();
    });

    it('disables "Reset to built-in default" when nothing overrides the built-in defaults', () => {
        renderButtons({ canRestoreBuiltinDefault: false });
        expect(screen.getByText('Reset to built-in default')).toBeDisabled();
    });

    it('enables "Reset to built-in default" and fires its handler when an override exists', () => {
        const onRestoreBuiltinDefault = jest.fn();
        renderButtons({ canRestoreBuiltinDefault: true, onRestoreBuiltinDefault });
        const button = screen.getByText('Reset to built-in default');
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(onRestoreBuiltinDefault).toHaveBeenCalledTimes(1);
    });

    // the recovery case that motivated this button: a wiped user default leaves nothing at the Workspace scope, so "Reset to user default" is disabled - "Reset to built-in default" must remain the way back
    it('keeps "Reset to built-in default" usable even when "Reset to user default" is disabled', () => {
        const onRestoreBuiltinDefault = jest.fn();
        renderButtons({ canResetToDefault: false, canRestoreBuiltinDefault: true, onRestoreBuiltinDefault });
        expect(screen.getByText('Reset to user default')).toBeDisabled();
        const restore = screen.getByText('Reset to built-in default');
        expect(restore).toBeEnabled();
        fireEvent.click(restore);
        expect(onRestoreBuiltinDefault).toHaveBeenCalledTimes(1);
    });
});

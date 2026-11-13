import React from 'react';
import { render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import ChangeDefaultsDisclosure from './ChangeDefaultsDisclosure';

const default_props = {
    divergedCount: 0,
    onMakeDefault: jest.fn(),
    onResetToDefault: jest.fn(),
    canResetToDefault: false,
};

function renderDisclosure(overrides: Partial<typeof default_props> = {}, children?: React.ReactNode): RenderResult {
    return render(<ChangeDefaultsDisclosure {...default_props} {...overrides}>{children}</ChangeDefaultsDisclosure>);
}

describe('ChangeDefaultsDisclosure', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is closed by default and tallies the count it is given', () => {
        renderDisclosure({ divergedCount: 2 });
        expect(screen.getByTestId('change-defaults')).not.toHaveAttribute('open');
        expect(screen.getByTestId('diverged-count')).toHaveTextContent('(2 settings diverged)');
    });

    it('words a single divergence in the singular', () => {
        renderDisclosure({ divergedCount: 1 });
        expect(screen.getByTestId('diverged-count')).toHaveTextContent('(1 setting diverged)');
    });

    it('disables Save as user default while nothing diverged', () => {
        renderDisclosure({ divergedCount: 0 });
        expect(screen.getByTestId('save-as-default')).toBeDisabled();
    });

    it('enables Save as user default and fires its handler once something diverged', () => {
        const onMakeDefault = jest.fn();
        renderDisclosure({ divergedCount: 1, onMakeDefault });
        const save = screen.getByTestId('save-as-default');
        expect(save).toBeEnabled();
        fireEvent.click(save);
        expect(onMakeDefault).toHaveBeenCalledTimes(1);
    });

    it('disables Revert to user default until a workspace override exists, then fires its handler', () => {
        const onResetToDefault = jest.fn();
        const { unmount } = renderDisclosure({ canResetToDefault: false, onResetToDefault });
        expect(screen.getByTestId('revert-to-defaults')).toBeDisabled();
        unmount();
        renderDisclosure({ canResetToDefault: true, onResetToDefault });
        fireEvent.click(screen.getByTestId('revert-to-defaults'));
        expect(onResetToDefault).toHaveBeenCalledTimes(1);
    });

    it('renders extra actions the host passes after the two shared buttons', () => {
        renderDisclosure({}, <button type="button" data-testid="extra-action">Extra</button>);
        expect(screen.getByTestId('extra-action')).toBeInTheDocument();
    });
});

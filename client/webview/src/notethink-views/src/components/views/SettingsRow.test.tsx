import React from 'react';
import { render, screen } from '@testing-library/react';
import SettingsRow from './SettingsRow';

function renderRow(overrides: Partial<React.ComponentProps<typeof SettingsRow>> = {}): void {
    render(
        <SettingsRow
            rowKey="orientation"
            label="Orientation"
            control={<input type="checkbox" data-testid="probe" />}
            ownerLabel="Line"
            {...overrides}
        />,
    );
}

describe('SettingsRow', () => {

    it('renders the five columns and publishes a testid per cell that needs one', () => {
        renderRow({ diverged: true });
        expect(screen.getByTestId('setting-row-orientation')).toBeInTheDocument();
        expect(screen.getByTestId('setting-marker-orientation')).toBeInTheDocument();
        expect(screen.getByText('Orientation')).toBeInTheDocument();
        expect(screen.getByTestId('probe')).toBeInTheDocument();
        expect(screen.getByTestId('setting-pill-orientation')).toHaveTextContent('Line');
    });

    it('keeps all five cells even when every pill is empty, so the columns stay aligned', () => {
        renderRow({ diverged: false, ownerLabel: undefined });
        expect(screen.getByTestId('setting-row-orientation').children).toHaveLength(5);
    });

    it('marks a diverged row with an M pill and says so on the row itself', () => {
        renderRow({ diverged: true });
        expect(screen.getByTestId('setting-marker-orientation')).toHaveTextContent('M');
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'true');
    });

    it('publishes no M pill at all when the value still matches its saved default', () => {
        renderRow({ diverged: false });
        expect(screen.queryByTestId('setting-marker-orientation')).not.toBeInTheDocument();
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'false');
    });

    it('publishes no owner pill for a setting that belongs to no type', () => {
        renderRow({ ownerLabel: undefined });
        expect(screen.queryByTestId('setting-pill-orientation')).not.toBeInTheDocument();
    });

    it('tints the name to match the modified-file colour; the M pill carries its own colour class', () => {
        renderRow({ diverged: true });
        const marker_classes = screen.getByTestId('setting-marker-orientation').className;
        const name_classes = screen.getByText('Orientation').className;
        expect(marker_classes).toContain('settingsPillDiverged');
        expect(name_classes).toContain('settingsRowDiverged');
    });

    it('renders a grey inherited pill with a hover naming the source view, and no specific pill beside it', () => {
        renderRow({ inheritedFrom: 'Line' });
        const pill = screen.getByTestId('setting-pill-inherited-orientation');
        expect(pill).toHaveAttribute('title', expect.stringContaining('Line'));
        expect(screen.queryByTestId('setting-pill-specific-orientation')).not.toBeInTheDocument();
    });

    it('renders a white VS pill with a hover naming where clearing it would inherit from, and no inherited pill beside it', () => {
        renderRow({ specificFrom: 'Line' });
        const pill = screen.getByTestId('setting-pill-specific-orientation');
        expect(pill).toHaveTextContent('VS');
        expect(pill).toHaveAttribute('title', expect.stringContaining('Line'));
        expect(screen.queryByTestId('setting-pill-inherited-orientation')).not.toBeInTheDocument();
    });

    it('renders neither state pill at a setting\'s own home view', () => {
        renderRow({});
        expect(screen.queryByTestId('setting-pill-inherited-orientation')).not.toBeInTheDocument();
        expect(screen.queryByTestId('setting-pill-specific-orientation')).not.toBeInTheDocument();
    });
});

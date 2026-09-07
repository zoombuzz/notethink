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

    it('renders the four columns and publishes a testid per cell that needs one', () => {
        renderRow({ diverged: true });
        expect(screen.getByTestId('setting-row-orientation')).toBeInTheDocument();
        expect(screen.getByTestId('setting-marker-orientation')).toBeInTheDocument();
        expect(screen.getByText('Orientation')).toBeInTheDocument();
        expect(screen.getByTestId('probe')).toBeInTheDocument();
        expect(screen.getByTestId('setting-pill-orientation')).toHaveTextContent('Line');
    });

    it('keeps all four cells even when the marker and the pill are empty, so the columns stay aligned', () => {
        renderRow({ diverged: false, ownerLabel: undefined });
        expect(screen.getByTestId('setting-row-orientation').children).toHaveLength(4);
    });

    it('marks a diverged row with an M and says so on the row itself', () => {
        renderRow({ diverged: true });
        expect(screen.getByTestId('setting-marker-orientation')).toHaveTextContent('M');
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'true');
    });

    it('publishes no marker at all when the value still matches its saved default', () => {
        renderRow({ diverged: false });
        expect(screen.queryByTestId('setting-marker-orientation')).not.toBeInTheDocument();
        expect(screen.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'false');
    });

    it('publishes no pill for a setting that belongs to no type', () => {
        renderRow({ ownerLabel: undefined });
        expect(screen.queryByTestId('setting-pill-orientation')).not.toBeInTheDocument();
    });

    it('tints the name as well as the marker, matching how the Explorer treats a modified file', () => {
        renderRow({ diverged: true });
        const marker_classes = screen.getByTestId('setting-marker-orientation').className;
        const name_classes = screen.getByText('Orientation').className;
        expect(marker_classes).toContain('settingsRowDiverged');
        expect(name_classes).toContain('settingsRowDiverged');
    });
});

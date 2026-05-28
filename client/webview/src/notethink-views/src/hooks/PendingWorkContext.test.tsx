import React from 'react';
import { render, screen } from '@testing-library/react';
import { PendingWorkProvider, usePendingWorkContext } from './PendingWorkContext';
import type { UsePendingWorkApi } from './usePendingWork';

function ContextProbe(): React.ReactElement {
    const api = usePendingWorkContext();
    return <div data-testid="probe" data-pending={String(api.pending)} />;
}

describe('PendingWorkContext', () => {
    it('returns a no-op api when no provider is mounted', () => {
        render(<ContextProbe />);
        expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false');
    });

    it('exposes a supplied api through context', () => {
        const api: UsePendingWorkApi = {
            pending: true,
            markPending: jest.fn(),
            clearPending: jest.fn(),
            clearAll: jest.fn(),
        };
        render(
            <PendingWorkProvider api={api}>
                <ContextProbe />
            </PendingWorkProvider>
        );
        expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'true');
    });

    it('builds its own api when no external one is supplied', () => {
        render(
            <PendingWorkProvider>
                <ContextProbe />
            </PendingWorkProvider>
        );
        expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false');
    });
});

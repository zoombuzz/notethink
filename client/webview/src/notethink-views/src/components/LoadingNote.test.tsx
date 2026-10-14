import React from 'react';
import { render, screen } from '@testing-library/react';
import LoadingNote from './LoadingNote';

describe('LoadingNote', () => {

    it('renders a busy status note with the loading message', () => {
        render(<LoadingNote />);
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-busy', 'true');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('NoteThink is loading…');
    });

    it('carries a stable testid the static HTML placeholder mirrors', () => {
        render(<LoadingNote />);
        expect(screen.getByTestId('loading-note')).toBeInTheDocument();
    });

    it('shows no spinner and no progress counts', () => {
        render(<LoadingNote />);
        expect(screen.queryByTestId('pending-work-spinner')).not.toBeInTheDocument();
        expect(screen.queryByText(/\d/)).not.toBeInTheDocument();
    });

    it('defaults to filling the board area', () => {
        render(<LoadingNote />);
        expect(screen.getByTestId('loading-note').className).toContain('loadingNoteBoard');
    });

    it('fills the viewport when asked, for use before any view has mounted', () => {
        render(<LoadingNote fill="viewport" />);
        expect(screen.getByTestId('loading-note').className).toContain('loadingNoteViewport');
    });
});

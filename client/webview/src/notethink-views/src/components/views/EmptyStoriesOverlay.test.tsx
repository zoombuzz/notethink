import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EmptyStoriesOverlay from './EmptyStoriesOverlay';

describe('EmptyStoriesOverlay', () => {

    describe('no_stories mode', () => {

        it('renders the note with a role and the explanatory text', () => {
            render(<EmptyStoriesOverlay mode="no_stories" onOpenFilesDrawer={jest.fn()} />);
            expect(screen.getByTestId('empty-stories-overlay')).toBeInTheDocument();
            expect(screen.getByRole('status')).toHaveTextContent('No stories found');
            expect(screen.getByRole('status')).toHaveTextContent(
                'NoteThink could not find any markdown files containing story or task definitions.',
            );
        });

        it('exposes a focusable button that opens the Files drawer, anchored to itself', () => {
            const onOpenFilesDrawer = jest.fn();
            render(<EmptyStoriesOverlay mode="no_stories" onOpenFilesDrawer={onOpenFilesDrawer} />);
            const button = screen.getByTestId('empty-stories-open-files');
            expect(button.tagName).toBe('BUTTON');
            fireEvent.click(button);
            expect(onOpenFilesDrawer).toHaveBeenCalledTimes(1);
            expect(onOpenFilesDrawer).toHaveBeenCalledWith(button);
        });

        it('is not marked aria-busy, since the scan has already settled', () => {
            render(<EmptyStoriesOverlay mode="no_stories" onOpenFilesDrawer={jest.fn()} />);
            expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
        });
    });

    describe('no_match mode', () => {

        it('names the include pattern that matched nothing', () => {
            render(<EmptyStoriesOverlay mode="no_match" includeFilter="**/{todo,done}.md" onOpenFilesDrawer={jest.fn()} />);
            expect(screen.getByRole('status')).toHaveTextContent('No files matched');
            expect(screen.getByRole('status')).toHaveTextContent('No markdown files matched the include pattern "**/{todo,done}.md".');
        });

        it('still exposes the Files-drawer button, since the fix is editing a filter there', () => {
            const onOpenFilesDrawer = jest.fn();
            render(<EmptyStoriesOverlay mode="no_match" includeFilter="**/*.md" onOpenFilesDrawer={onOpenFilesDrawer} />);
            fireEvent.click(screen.getByTestId('empty-stories-open-files'));
            expect(onOpenFilesDrawer).toHaveBeenCalledTimes(1);
        });
    });

    describe('scanning mode', () => {

        it('draws the shared loading note instead of its own card', () => {
            render(<EmptyStoriesOverlay mode="scanning" onOpenFilesDrawer={jest.fn()} />);
            const status = screen.getByTestId('loading-note');
            expect(status).toBeInTheDocument();
            expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
            expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
            expect(screen.getByRole('status')).toHaveTextContent('NoteThink is loading…');
        });

        it('shows no spinner, no progress counts, and no Files-drawer button', () => {
            render(<EmptyStoriesOverlay mode="scanning" onOpenFilesDrawer={jest.fn()} />);
            expect(screen.queryByTestId('pending-work-spinner')).not.toBeInTheDocument();
            expect(screen.queryByTestId('empty-stories-overlay')).not.toBeInTheDocument();
            expect(screen.queryByTestId('empty-stories-open-files')).not.toBeInTheDocument();
        });
    });
});

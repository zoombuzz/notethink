import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EmptyStoriesOverlay from './EmptyStoriesOverlay';

describe('EmptyStoriesOverlay', () => {

    it('renders the note with a role and the explanatory text', () => {
        render(<EmptyStoriesOverlay onOpenFilesDrawer={jest.fn()} />);
        expect(screen.getByTestId('empty-stories-overlay')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('No stories found');
        expect(screen.getByRole('status')).toHaveTextContent(
            'NoteThink could not find any markdown files containing story or task definitions.',
        );
    });

    it('exposes a focusable button that opens the Files drawer, anchored to itself', () => {
        const onOpenFilesDrawer = jest.fn();
        render(<EmptyStoriesOverlay onOpenFilesDrawer={onOpenFilesDrawer} />);
        const button = screen.getByTestId('empty-stories-open-files');
        expect(button.tagName).toBe('BUTTON');
        fireEvent.click(button);
        expect(onOpenFilesDrawer).toHaveBeenCalledTimes(1);
        expect(onOpenFilesDrawer).toHaveBeenCalledWith(button);
    });
});

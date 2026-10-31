import React, { Suspense } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GenericView from './GenericView';
import type { AudioState } from '../../types/Messages';
import type { NoteProps } from '../../types/NoteProps';
import type { ViewProps } from '../../types/ViewProps';

jest.mock('./DocumentView', () => ({
    __esModule: true,
    default: () => <div data-testid="document-view">DocumentView</div>,
}));

jest.mock('../../lib/renderops', () => ({
    renderMarkdownNoteHeadline: (note: NoteProps) => <span>{note.headline_raw}</span>,
}));

function makeState(overrides: Partial<AudioState> = {}): AudioState {
    return { available: true, enabled: true, owner: true, capturing: true, dropped_count: 0, ...overrides };
}

function makeViewProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'audio-view',
        type: 'document',
        display_options: {},
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
            postMessage: jest.fn(),
        },
        ...overrides,
    };
}

async function renderView(props: ViewProps): Promise<void> {
    render(
        <Suspense fallback={<div>loading</div>}>
            <GenericView {...props} />
        </Suspense>
    );
    await waitFor(() => expect(screen.getByTestId('view-toolbar')).toBeInTheDocument());
}

describe('GenericView header audio control', () => {
    it('adds no audio element to the toolbar with no state or an unavailable feature', async () => {
        await renderView(makeViewProps());
        expect(screen.queryByTestId('audio-control')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('adds no audio element when the extension reports the feature unavailable', async () => {
        await renderView(makeViewProps({ audio_state: makeState({ available: false }) }));
        expect(screen.queryByTestId('audio-control')).not.toBeInTheDocument();
    });

    it('shows the dot and reaches the host handlers through the toolbar', async () => {
        const toggleAudio = jest.fn();
        const reportAudioIndicatorPresence = jest.fn();
        const base = makeViewProps();
        await renderView({
            ...base,
            audio_state: makeState(),
            handlers: { ...base.handlers!, toggleAudio, reportAudioIndicatorPresence },
        });
        expect(screen.getByTestId('audio-recording-dot')).toBeInTheDocument();
        expect(reportAudioIndicatorPresence).toHaveBeenCalledWith(true);
        fireEvent.click(screen.getByTestId('audio-toggle'));
        expect(toggleAudio).toHaveBeenCalledWith(false);
    });
});

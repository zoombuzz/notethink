import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import StorySendButton from './StorySendButton';
import CoordinatorPanel from '../views/coordinators/CoordinatorPanel';
import { readCoordinatorCompose, resetActivitySnapshot, setActivitySnapshot } from '../../lib/activityhooks';
import type { ActivitySnapshot } from '../../lib/agentactivityops';
import type { ActivityCoordinator } from '../../types/AgentActivity';
import type { NoteProps } from '../../types/NoteProps';

const BOARD = 'demo/docstech/users/dev/todo.md';

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'idle', story: '', version: '', machine: 'host-a', open_convoys: [], root_relative: 'demo', board_doc_path: BOARD,
        board_stories: [{ id: 'alpha', title: 'Alpha story', status: '', convoys: [], operator_steps: [] }], marker_after: 0,
        ...overrides,
    };
}

function note(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1, level: 1, type: 'heading', stable_id: 'doc:alpha', children_body: [], children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '### Alpha story', body_raw: '',
        linetags: { id: { key: 'id', value: 'alpha', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } },
        origin: { doc_id: 'doc', doc_path: `/ws/${BOARD}`, relative_path: BOARD },
        display_options: { id: 'v1', integration_mode: 'folder' },
        ...overrides,
    };
}

function seed(coordinators: ActivityCoordinator[]): void {
    const snapshot: ActivitySnapshot = { analyser: { state: 'live', refusals: [] }, sessions: [], trees: [], progress: [], coordinators };
    act(() => { setActivitySnapshot(snapshot); });
}

afterEach(() => {
    resetActivitySnapshot();
});

describe('the send action on a story card', () => {
    it('shows on a story that sits on a registered coordinator\'s board, and names the agent', () => {
        render(<StorySendButton note={note()} />);
        seed([coordinator()]);
        expect(screen.getByTestId('story-send-button')).toHaveAccessibleName('Send this story to coord-demo');
    });

    it('shows on no story outside a coordinator\'s board, and none in a single file view', () => {
        const { rerender } = render(<StorySendButton note={note({ origin: { doc_id: 'doc', doc_path: '/ws/other/todo.md', relative_path: 'other/todo.md' } })} />);
        seed([coordinator()]);
        expect(screen.queryByTestId('story-send-button')).toBeNull();
        rerender(<StorySendButton note={note({ display_options: { id: 'v1', integration_mode: 'current_file' } })} />);
        expect(screen.queryByTestId('story-send-button')).toBeNull();
        rerender(<StorySendButton note={note({ linetags: { id: { key: 'id', value: 'not-on-the-board', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } } })} />);
        expect(screen.queryByTestId('story-send-button')).toBeNull();
    });

    it('only opens the agent\'s send form with the story named, and sends nothing', () => {
        const post = jest.fn();
        const select = jest.fn();
        render(
            <div onClick={select}>
                <CoordinatorPanel loaded_files={[BOARD]} post_message={post} />
                <StorySendButton note={note()} />
            </div>,
        );
        seed([coordinator()]);
        post.mockClear();
        fireEvent.click(screen.getByTestId('story-send-button'));
        expect(readCoordinatorCompose()).toMatchObject({ agent: 'coord-demo', text: 'About story alpha: ' });
        expect(screen.getByTestId('coordinator-send-text')).toHaveValue('About story alpha: ');
        expect(post).not.toHaveBeenCalled();
        expect(select).not.toHaveBeenCalled();
    });
});

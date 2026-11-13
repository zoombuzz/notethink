import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NoteActionTray from './NoteActionTray';
import { resetActivitySnapshot, setActivitySnapshot, setCoordinatorResult } from '../../lib/activityhooks';
import type { ActivitySnapshot } from '../../lib/agentactivityops';
import type { ActivityCoordinator } from '../../types/AgentActivity';
import type { NoteProps } from '../../types/NoteProps';

const BOARD = 'demo/docstech/users/dev/todo.md';

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'idle', story: '', version: '', machine: 'host-a', open_convoys: [], root_relative: 'demo', board_doc_path: BOARD,
        board_stories: [{ id: 'alpha', title: 'Alpha story', status: '', convoys: [], operator_steps: [] }], marker_after: 0,
        ...overrides,
    };
}

function note(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1, level: 1, type: 'heading', stable_id: 'doc:alpha', children_body: [], children: [], focused: true,
        position: { start: { offset: 100, line: 5 }, end: { offset: 115, line: 5 } },
        headline_raw: '### Alpha story', body_raw: '',
        linetags: { id: { key: 'id', value: 'alpha', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } },
        origin: { doc_id: 'doc', doc_path: `/ws/${BOARD}`, relative_path: BOARD },
        display_options: { id: 'v1', integration_mode: 'folder', cropped_focused_seqs: [1] },
        handlers: { postMessage: jest.fn() } as unknown as NoteProps['handlers'],
        ...overrides,
    };
}

function seed(coordinators: ActivityCoordinator[]): void {
    const snapshot: ActivitySnapshot = { analyser: { state: 'live', refusals: [] }, sessions: [], trees: [], progress: [], coordinators };
    act(() => { setActivitySnapshot(snapshot); });
}

function posted(target: NoteProps): jest.Mock {
    return target.handlers!.postMessage as unknown as jest.Mock;
}

afterEach(() => {
    resetActivitySnapshot();
    jest.clearAllMocks();
});

describe('the card action tray', () => {
    it('shows the pencil and the envelope on a focused story on a coordinator\'s board', () => {
        render(<NoteActionTray note={note()} />);
        seed([coordinator()]);
        expect(screen.getByTestId('note-edit-button')).toHaveAccessibleName('Edit the title in the text editor');
        expect(screen.getByTestId('story-send-button')).toHaveAccessibleName('Send this story to coord-demo');
        expect(screen.getByTestId('story-send-button')).toHaveAttribute('title', 'Send this story to coord-demo');
        expect(screen.getByTestId('note-edit-button')).toHaveAttribute('title', 'Edit the title in the text editor');
    });

    it('shows on a selected note as it does on a focused one', () => {
        render(<NoteActionTray note={note({ focused: false, selected: true, display_options: { id: 'v1', integration_mode: 'folder', cropped_selected_seqs: [1], selected_notes: [] } })} />);
        expect(screen.getByTestId('note-action-tray')).toBeInTheDocument();
    });

    it('shows on a note that is not highlighted, and on a faded outer note, nowhere', () => {
        const { rerender } = render(<NoteActionTray note={note({ focused: false })} />);
        expect(screen.queryByTestId('note-action-tray')).toBeNull();
        rerender(<NoteActionTray note={note({ display_options: { id: 'v1', integration_mode: 'folder', cropped_focused_seqs: [1, 2] } })} />);
        expect(screen.queryByTestId('note-action-tray')).toBeNull();
    });

    it('shows on neither the root note nor the view\'s own container note', () => {
        const { rerender } = render(<NoteActionTray note={note({ type: 'root' })} />);
        expect(screen.queryByTestId('note-action-tray')).toBeNull();
        rerender(<NoteActionTray note={note({ display_options: { id: 'v1', integration_mode: 'folder', cropped_focused_seqs: [1], parent_context_seq: 1 } })} />);
        expect(screen.queryByTestId('note-action-tray')).toBeNull();
    });

    it('has only the pencil where the story is on no coordinator\'s board, or the view is a single file', () => {
        const { rerender } = render(<NoteActionTray note={note({ origin: { doc_id: 'doc', doc_path: '/ws/other/todo.md', relative_path: 'other/todo.md' } })} />);
        seed([coordinator()]);
        expect(screen.getByTestId('note-edit-button')).toBeInTheDocument();
        expect(screen.queryByTestId('story-send-button')).toBeNull();
        rerender(<NoteActionTray note={note({ display_options: { id: 'v1', integration_mode: 'current_file', cropped_focused_seqs: [1] } })} />);
        expect(screen.queryByTestId('story-send-button')).toBeNull();
        rerender(<NoteActionTray note={note({ linetags: { id: { key: 'id', value: 'not-on-the-board', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } } })} />);
        expect(screen.queryByTestId('story-send-button')).toBeNull();
    });

    it('the pencil posts selectRange at the end of the title with forceOpen, and does not bubble', () => {
        const target = note({ headline_raw: '### Alpha story [](?id=alpha)', linetags_from: 100 + '### Alpha story '.length });
        const select = jest.fn();
        render(<div onClick={select}><NoteActionTray note={target} /></div>);
        fireEvent.click(screen.getByTestId('note-edit-button'));
        expect(posted(target)).toHaveBeenCalledTimes(1);
        expect(posted(target)).toHaveBeenCalledWith({ type: 'selectRange', from: 115, to: 115, docPath: `/ws/${BOARD}`, forceOpen: true });
        expect(select).not.toHaveBeenCalled();
    });

    it('the envelope asks first and sends nothing until OK', () => {
        const target = note();
        render(<NoteActionTray note={target} />);
        seed([coordinator()]);
        fireEvent.click(screen.getByTestId('story-send-button'));
        expect(screen.getByTestId('confirm-modal')).toHaveAttribute('open');
        expect(screen.getByText('Ask coord-demo to pick up story alpha and include it in its current batch?')).toBeInTheDocument();
        expect(posted(target)).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('confirm-modal-ok'));
        expect(posted(target)).toHaveBeenCalledTimes(1);
        expect(posted(target)).toHaveBeenCalledWith({
            type: 'coordinatorSend',
            agent: 'coord-demo',
            body: `Please pick up story alpha from ${BOARD} and include it in your current batch.`,
        });
        expect(screen.getByTestId('confirm-modal')).not.toHaveAttribute('open');
    });

    it('Cancel and Escape send nothing and return focus to the envelope', () => {
        const target = note();
        render(<NoteActionTray note={target} />);
        seed([coordinator()]);
        fireEvent.click(screen.getByTestId('story-send-button'));
        fireEvent.click(screen.getByTestId('confirm-modal-cancel'));
        expect(screen.getByTestId('confirm-modal')).not.toHaveAttribute('open');
        expect(screen.getByTestId('story-send-button')).toHaveFocus();
        fireEvent.click(screen.getByTestId('story-send-button'));
        act(() => { screen.getByTestId('confirm-modal').dispatchEvent(new Event('cancel', { cancelable: true })); });
        expect(screen.getByTestId('confirm-modal')).not.toHaveAttribute('open');
        expect(posted(target)).not.toHaveBeenCalled();
    });

    it.each([
        ['sent', true, 'Sent to coord-demo.'],
        ['unknown_agent', false, 'That agent is no longer listed.'],
        ['unavailable', false, 'This host cannot reach the agent\'s mailbox.'],
        ['no_mailbox', false, 'The agent has no mailbox yet.'],
        ['write_failed', false, 'The message could not be written.'],
    ])('says what came of the send when the host answers %s', (code, ok, text) => {
        const target = note();
        render(<NoteActionTray note={target} />);
        seed([coordinator()]);
        expect(screen.queryByTestId('note-action-tray-status')).toBeNull();
        fireEvent.click(screen.getByTestId('story-send-button'));
        fireEvent.click(screen.getByTestId('confirm-modal-ok'));
        act(() => { setCoordinatorResult({ request: 'send', agent: 'coord-demo', code, ok }); });
        expect(screen.getByTestId('note-action-tray-status')).toHaveTextContent(text);
        expect(screen.getByTestId('note-action-tray-status')).toHaveAttribute('data-code', code);
    });

    it('does not report an answer to a send this tray did not ask for', () => {
        render(<NoteActionTray note={note()} />);
        seed([coordinator()]);
        act(() => { setCoordinatorResult({ request: 'send', agent: 'coord-demo', code: 'sent', ok: true }); });
        expect(screen.queryByTestId('note-action-tray-status')).toBeNull();
    });
});

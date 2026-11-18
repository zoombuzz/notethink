import React from 'react';
import { act, render, screen } from '@testing-library/react';
import BoardLines, { BoardLineDemand, BoardLinedBodyItems, boardLineLabel, withBoardLines } from './BoardLines';
import { resetActivitySnapshot, setActivitySnapshot } from '../../lib/activityhooks';
import type { ActivitySnapshot } from '../../lib/agentactivityops';
import type { ActivityBoardLines } from '../../types/AgentActivity';
import type { NoteProps } from '../../types/NoteProps';

jest.mock('../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`note-${props.seq}`}>{props.headline_raw}</div>,
}));

const BOARD_PATH = 'demo/docstech/users/dev/todo.md';

function board(build_after: number, ship_after: number): ActivityBoardLines {
    return { doc_path: BOARD_PATH, story_ids: ['a', 'b', 'c'], build_after, ship_after };
}

function seed(board_lines: ActivityBoardLines[]): void {
    const snapshot: ActivitySnapshot = { analyser: { state: 'live', refusals: [] }, sessions: [], trees: [], progress: [], coordinators: [], board_lines };
    act(() => { setActivitySnapshot(snapshot); });
}

function story(seq: number, title: string): NoteProps {
    return { seq, type: 'heading', level: 3, headline_raw: title, origin: { relative_path: BOARD_PATH }, children_body: [], display_options: {} } as unknown as NoteProps;
}

afterEach(() => { resetActivitySnapshot(); });

describe('BoardLines', () => {
    it('draws a solid build line and a dashed ship line, each with its own accessible name and tooltip', () => {
        render(<BoardLines kinds={['build', 'ship']} />);
        const build = screen.getByTestId('board-line-build');
        const ship = screen.getByTestId('board-line-ship');
        expect(build).toHaveAttribute('role', 'separator');
        expect(build).toHaveAttribute('aria-label', boardLineLabel('build'));
        expect(build).toHaveAttribute('title', boardLineLabel('build'));
        expect(ship).toHaveAttribute('aria-label', boardLineLabel('ship'));
        expect(build.className).toContain('build');
        expect(ship.className).toContain('ship');
        expect(boardLineLabel('build')).not.toBe(boardLineLabel('ship'));
    });

    it('stacks both lines in one wrapper, build first', () => {
        render(<BoardLines kinds={['build', 'ship']} />);
        expect(screen.getByTestId('board-lines')).toHaveAttribute('data-board-lines', 'build ship');
    });

    it('draws nothing for no kinds', () => {
        const { container } = render(<BoardLines kinds={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('withBoardLines', () => {
    const items = [<i key="a" data-testid="a" />, <i key="b" data-testid="b" />];

    it('lays each slot before its item and the last after the final item', () => {
        const { container } = render(<>{withBoardLines(items, [['build'], [], ['ship']])}</>);
        expect([...container.children].map(el => el.getAttribute('data-board-lines') ?? el.getAttribute('data-testid'))).toEqual(['build', 'a', 'b', 'ship']);
    });

    it('returns the items as they were when no line applies', () => {
        expect(withBoardLines(items, undefined)).toHaveLength(2);
        expect(withBoardLines(items, [[], [], []])).toHaveLength(2);
    });
});

describe('BoardLinedBodyItems', () => {
    function body(): NoteProps {
        return { ...story(0, 'Board'), children_body: [story(1, 'A'), story(2, 'B'), story(3, 'C')], handlers: { postMessage: jest.fn() }, display_options: { view_id: 'v' } } as unknown as NoteProps;
    }

    it('draws both lines among a board\'s stories once the snapshot lands', () => {
        const { container } = render(<BoardLinedBodyItems note={body()} />);
        expect(screen.queryByTestId('board-lines')).toBeNull();
        seed([board(1, 2)]);
        expect([...container.children].map(el => el.getAttribute('data-board-lines') ?? el.getAttribute('data-testid'))).toEqual(['note-1', 'build', 'note-2', 'ship', 'note-3']);
    });

    it('asks the host for activity on mount and withdraws on unmount', () => {
        const note = body();
        const { unmount } = render(<BoardLinedBodyItems note={note} />);
        expect(note.handlers?.postMessage).toHaveBeenCalledWith({ type: 'activityDemand' });
        unmount();
        expect(note.handlers?.postMessage).toHaveBeenCalledWith({ type: 'activityWithdraw' });
    });

    it('draws nothing for a board the host does not list', () => {
        render(<BoardLinedBodyItems note={body()} />);
        seed([{ ...board(1, 2), doc_path: 'other/todo.md' }]);
        expect(screen.queryByTestId('board-lines')).toBeNull();
    });
});

describe('BoardLineDemand', () => {
    it('posts demand without a post function being required', () => {
        const post = jest.fn();
        const { unmount } = render(<BoardLineDemand post_message={post} />);
        expect(post).toHaveBeenCalledWith({ type: 'activityDemand' });
        unmount();
        expect(() => render(<BoardLineDemand post_message={undefined} />)).not.toThrow();
    });
});

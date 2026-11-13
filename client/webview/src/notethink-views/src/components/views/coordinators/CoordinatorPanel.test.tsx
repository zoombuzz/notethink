import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import CoordinatorPanel from './CoordinatorPanel';
import { resetActivitySnapshot, setActivitySnapshot, setCoordinatorResult } from '../../../lib/activityhooks';
import type { ActivitySnapshot } from '../../../lib/agentactivityops';
import type { ActivityCoordinator } from '../../../types/AgentActivity';

// jsdom has no PointerEvent, so a pointer event built without one would carry neither a button nor a position
class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
    }
}
beforeAll(() => {
    (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
    // jsdom has no modal dialog support, so the confirm opens and closes by its open attribute
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

const LOADED = ['demo/docstech/users/dev/todo.md', 'other/docstech/users/dev/todo.md'];

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'working', story: 'beta', version: '1.2.3', machine: 'host-a', open_convoys: ['c1', 'c2'], root_relative: 'demo',
        board_doc_path: 'demo/docstech/users/dev/todo.md',
        board_stories: [
            { id: 'alpha', title: 'Alpha story', status: 'doing', convoys: [], operator_steps: ['Reply to the vendor'] },
            { id: 'beta', title: 'Beta story', status: '', convoys: ['repo-b'], operator_steps: [] },
            { id: 'gamma', title: 'Gamma story', status: '', convoys: [], operator_steps: [] },
        ],
        marker_after: 2,
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

describe('the coordinator panel', () => {
    it('asks the host for activity once on mount and withdraws on unmount, so the registry is read', () => {
        const post = jest.fn();
        const { unmount } = render(<CoordinatorPanel loaded_files={LOADED} post_message={post} />);
        expect(post).toHaveBeenCalledWith({ type: 'activityDemand' });
        unmount();
        expect(post).toHaveBeenCalledWith({ type: 'activityWithdraw' });
    });

    it('draws nothing when no coordinator is registered or none is in scope', () => {
        const { container } = render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
        seed([]);
        expect(container).toBeEmptyDOMElement();
        seed([coordinator({ root_relative: 'elsewhere' })]);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists each coordinator in scope with its state, story, vendor mark and open convoys', () => {
        render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
        seed([coordinator(), coordinator({ agent: 'coord-other', root_relative: 'other', state: 'idle', story: '', vendor: 'antigravity', open_convoys: [] })]);
        const rows = screen.getAllByTestId('coordinator-row');
        expect(rows).toHaveLength(2);
        const first = within(rows[0]);
        expect(first.getByTestId('coordinator-name')).toHaveTextContent('coord-demo');
        expect(first.getByTestId('coordinator-state')).toHaveTextContent('Working');
        expect(first.getByTestId('coordinator-story-now')).toHaveTextContent('On story beta');
        expect(first.getByTestId('coordinator-vendor-mark')).toHaveTextContent('CC');
        expect(first.queryByText(/Version/)).toBeNull();
        expect(first.getByTestId('coordinator-convoys')).toHaveTextContent('2 open convoys');
        const second = within(rows[1]);
        expect(second.getByTestId('coordinator-vendor-mark')).toHaveTextContent('AG');
        expect(second.getByTestId('coordinator-state')).toHaveTextContent('Idle');
        expect(second.queryByTestId('coordinator-story-now')).toBeNull();
        expect(second.queryByTestId('coordinator-convoys')).toBeNull();
    });

    it('offers no way to start, stop or restart an agent', () => {
        render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
        seed([coordinator()]);
        const names = screen.getAllByRole('button').map(button => button.textContent);
        expect(names).toEqual(['Send to agent', 'Target line']);
    });

    describe('the vendor setting', () => {
        function vendorSelect(): HTMLSelectElement {
            return screen.getByTestId('coordinator-vendor-select') as HTMLSelectElement;
        }
        function pick(vendor: string): void {
            fireEvent.change(vendorSelect(), { target: { value: vendor } });
        }

        it('draws the mark in the vendor\'s colour and lists every known vendor, the current one selected', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator()]);
            expect(screen.getByTestId('coordinator-vendor-mark')).toHaveStyle({ color: 'var(--vscode-charts-purple, #b180d7)' });
            expect(vendorSelect().value).toBe('claude-code');
            expect(Array.from(vendorSelect().options).map(option => option.textContent)).toEqual(['CC Claude Code', 'CO Codex', 'GR Grok', 'AG Antigravity']);
        });

        it('keeps a vendor the table does not list as the selected option', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator({ vendor: 'unknown' })]);
            expect(vendorSelect().value).toBe('unknown');
        });

        it('asks before sending, and a cancelled pick sends nothing and keeps the registry\'s vendor', () => {
            const post = jest.fn();
            render(<CoordinatorPanel loaded_files={LOADED} post_message={post} />);
            seed([coordinator()]);
            post.mockClear();
            pick('antigravity');
            expect(screen.getByTestId('confirm-modal')).toHaveAttribute('open');
            expect(screen.getByTestId('confirm-modal')).toHaveTextContent('Ask coord-demo to restart in Antigravity?');
            expect(post).not.toHaveBeenCalled();
            fireEvent.click(screen.getByTestId('confirm-modal-cancel'));
            expect(post).not.toHaveBeenCalled();
            expect(vendorSelect().value).toBe('claude-code');
            expect(screen.queryByTestId('coordinator-vendor-requested')).toBeNull();
        });

        it('posts the vendor-change request once, naming the vendor as the registry spells it, and holds it as pending', () => {
            const post = jest.fn();
            render(<CoordinatorPanel loaded_files={LOADED} post_message={post} />);
            seed([coordinator()]);
            post.mockClear();
            pick('antigravity');
            fireEvent.click(screen.getByTestId('confirm-modal-ok'));
            expect(post).toHaveBeenCalledTimes(1);
            expect(post).toHaveBeenCalledWith({ type: 'coordinatorSend', agent: 'coord-demo', kind: 'vendor', vendor: 'agy' });
            expect(vendorSelect().value).toBe('antigravity');
            expect(screen.getByTestId('coordinator-vendor-requested')).toHaveTextContent('Requested: Antigravity');
            expect(screen.getByTestId('coordinator-vendor-mark')).toHaveTextContent('CC');
            act(() => { setCoordinatorResult({ request: 'vendor', agent: 'coord-demo', code: 'sent', ok: true }); });
            expect(screen.getByTestId('coordinator-status')).toHaveTextContent('Asked coord-demo to change vendor.');
            expect(vendorSelect().value).toBe('antigravity');
        });

        it('lets the pending vendor go once the registry reports the new one', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator()]);
            pick('codex');
            fireEvent.click(screen.getByTestId('confirm-modal-ok'));
            expect(screen.getByTestId('coordinator-vendor-requested')).toBeInTheDocument();
            seed([coordinator({ vendor: 'codex' })]);
            expect(screen.queryByTestId('coordinator-vendor-requested')).toBeNull();
            expect(vendorSelect().value).toBe('codex');
            expect(screen.getByTestId('coordinator-vendor-mark')).toHaveTextContent('CO');
        });

        it('falls back to the registry\'s vendor and says why when the request is refused', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator()]);
            pick('grok');
            fireEvent.click(screen.getByTestId('confirm-modal-ok'));
            act(() => { setCoordinatorResult({ request: 'vendor', agent: 'coord-demo', code: 'no_mailbox', ok: false }); });
            expect(vendorSelect().value).toBe('claude-code');
            expect(screen.queryByTestId('coordinator-vendor-requested')).toBeNull();
            expect(screen.getByTestId('coordinator-status')).toHaveTextContent('The agent has no mailbox yet.');
            expect(screen.getByTestId('coordinator-status')).toHaveAttribute('data-code', 'no_mailbox');
        });
    });

    describe('send to agent', () => {
        it('posts the message only when Send is pressed, naming the agent and nothing else', () => {
            const post = jest.fn();
            render(<CoordinatorPanel loaded_files={LOADED} post_message={post} />);
            seed([coordinator()]);
            post.mockClear();
            fireEvent.click(screen.getByTestId('coordinator-send-toggle'));
            expect(post).not.toHaveBeenCalled();
            expect(screen.getByTestId('coordinator-send-submit')).toBeDisabled();
            fireEvent.change(screen.getByTestId('coordinator-send-text'), { target: { value: 'please pick up beta' } });
            expect(post).not.toHaveBeenCalled();
            fireEvent.click(screen.getByTestId('coordinator-send-submit'));
            expect(post).toHaveBeenCalledTimes(1);
            expect(post).toHaveBeenCalledWith({ type: 'coordinatorSend', agent: 'coord-demo', body: 'please pick up beta' });
        });

        it('says when the message was sent and empties the form, and says why when it was not', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator()]);
            fireEvent.click(screen.getByTestId('coordinator-send-toggle'));
            fireEvent.change(screen.getByTestId('coordinator-send-text'), { target: { value: 'hello' } });
            act(() => { setCoordinatorResult({ request: 'send', agent: 'coord-demo', code: 'no_mailbox', ok: false }); });
            expect(screen.getByTestId('coordinator-status')).toHaveTextContent('The agent has no mailbox yet.');
            expect(screen.getByTestId('coordinator-send-text')).toHaveValue('hello');
            act(() => { setCoordinatorResult({ request: 'send', agent: 'coord-demo', code: 'sent', ok: true }); });
            expect(screen.getByTestId('coordinator-status')).toHaveTextContent('Sent to coord-demo.');
            expect(screen.getByTestId('coordinator-send-text')).toHaveValue('');
        });

        it('shows an answer under the agent it was for only', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator(), coordinator({ agent: 'coord-other', root_relative: 'other' })]);
            act(() => { setCoordinatorResult({ request: 'send', agent: 'coord-other', code: 'sent', ok: true }); });
            const [first, second] = screen.getAllByTestId('coordinator-status');
            expect(first).toBeEmptyDOMElement();
            expect(second).toHaveTextContent('Sent to coord-other.');
        });
    });

    describe('the target line', () => {
        function open(post = jest.fn()): jest.Mock {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={post} />);
            seed([coordinator()]);
            fireEvent.click(screen.getByTestId('coordinator-target-toggle'));
            post.mockClear();
            return post;
        }

        it('lists the board with the line after the story the marker sits on, and dims what is below it', () => {
            open();
            const stories = screen.getAllByTestId('coordinator-story');
            expect(stories.map(story => story.getAttribute('data-story-id'))).toEqual(['alpha', 'beta', 'gamma']);
            expect(stories.map(story => story.getAttribute('data-in-range'))).toEqual(['true', 'true', 'false']);
            const line = screen.getByTestId('coordinator-target-line');
            expect(line).toHaveAttribute('role', 'separator');
            expect(line).toHaveAttribute('tabindex', '0');
            expect(line).toHaveAttribute('aria-valuenow', '2');
            expect(line).toHaveAttribute('aria-valuemax', '3');
            expect(line).toHaveAttribute('aria-valuetext', 'After Beta story');
            expect(line).toHaveAttribute('aria-label', 'Target line for coord-demo');
            expect(stories[1].nextElementSibling).toBe(line);
        });

        it('shows open convoys and operator steps on the stories they belong to', () => {
            open();
            const [alpha, beta, gamma] = screen.getAllByTestId('coordinator-story');
            expect(within(alpha).getByTestId('coordinator-story-step')).toHaveTextContent('Your step: Reply to the vendor');
            expect(within(alpha).getByTestId('coordinator-story-status')).toHaveTextContent('doing');
            expect(within(beta).getByTestId('coordinator-story-convoy')).toHaveTextContent('Convoy: repo-b');
            expect(within(gamma).queryByTestId('coordinator-story-convoy')).toBeNull();
            expect(within(gamma).queryByTestId('coordinator-story-step')).toBeNull();
        });

        it('moves with the arrow keys, Home and End, posting each new position and keeping focus on the line', () => {
            const post = open();
            let line = screen.getByTestId('coordinator-target-line');
            line.focus();
            fireEvent.keyDown(line, { key: 'ArrowDown' });
            expect(post).toHaveBeenLastCalledWith({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 3 });
            line = screen.getByTestId('coordinator-target-line');
            expect(line).toHaveAttribute('aria-valuenow', '3');
            expect(document.activeElement).toBe(line);
            fireEvent.keyDown(line, { key: 'Home' });
            expect(post).toHaveBeenLastCalledWith({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 0 });
            line = screen.getByTestId('coordinator-target-line');
            expect(line).toHaveAttribute('aria-valuetext', 'No target line: nothing is set to run');
            fireEvent.keyDown(line, { key: 'End' });
            expect(post).toHaveBeenLastCalledWith({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 3 });
            fireEvent.keyDown(screen.getByTestId('coordinator-target-line'), { key: 'ArrowUp' });
            expect(post).toHaveBeenLastCalledWith({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 2 });
            expect(post).toHaveBeenCalledTimes(4);
        });

        it('posts nothing for a key that would not move the line', () => {
            const post = open();
            const line = screen.getByTestId('coordinator-target-line');
            fireEvent.keyDown(line, { key: 'Enter' });
            fireEvent.keyDown(line, { key: 'End' });
            fireEvent.keyDown(screen.getByTestId('coordinator-target-line'), { key: 'ArrowDown' });
            expect(post).toHaveBeenCalledTimes(1);
        });

        it('drags the line to the story the pointer is over and posts the move once, on release', () => {
            const post = open();
            const stories = screen.getAllByTestId('coordinator-story');
            // story middles at 10, 40 and 70
            stories.forEach((story, index) => { story.getBoundingClientRect = () => ({ top: index * 30, height: 20, bottom: index * 30 + 20, left: 0, right: 100, width: 100, x: 0, y: index * 30, toJSON: () => ({}) }); });
            const line = screen.getByTestId('coordinator-target-line');
            line.setPointerCapture = jest.fn();
            line.releasePointerCapture = jest.fn();
            fireEvent.pointerDown(line, { button: 0, pointerId: 1 });
            fireEvent.pointerMove(line, { clientY: 25, pointerId: 1 });
            expect(screen.getByTestId('coordinator-target-ghost')).toHaveAttribute('data-position', '1');
            expect(post).not.toHaveBeenCalled();
            fireEvent.pointerMove(line, { clientY: 5, pointerId: 1 });
            fireEvent.pointerUp(line, { clientY: 5, pointerId: 1 });
            expect(post).toHaveBeenCalledTimes(1);
            expect(post).toHaveBeenCalledWith({ type: 'coordinatorMoveMarker', agent: 'coord-demo', after: 0 });
            expect(screen.queryByTestId('coordinator-target-ghost')).toBeNull();
        });

        it('cancels a drag with Escape and posts nothing', () => {
            const post = open();
            const line = screen.getByTestId('coordinator-target-line');
            line.setPointerCapture = jest.fn();
            fireEvent.pointerDown(line, { button: 0, pointerId: 1 });
            fireEvent.keyDown(line, { key: 'Escape' });
            fireEvent.pointerUp(line, { clientY: 0, pointerId: 1 });
            expect(post).not.toHaveBeenCalled();
        });

        it('lets go of a held position when the host refuses the move', () => {
            open();
            fireEvent.keyDown(screen.getByTestId('coordinator-target-line'), { key: 'Home' });
            expect(screen.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '0');
            act(() => { setCoordinatorResult({ request: 'move', agent: 'coord-demo', code: 'write_failed', ok: false }); });
            expect(screen.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '2');
            expect(screen.getByTestId('coordinator-status')).toHaveTextContent('The board could not be changed.');
        });

        it('takes the board\'s own answer as the line\'s place once the board reports it', () => {
            open();
            fireEvent.keyDown(screen.getByTestId('coordinator-target-line'), { key: 'ArrowUp' });
            expect(screen.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '1');
            seed([coordinator({ marker_after: 1 })]);
            expect(screen.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '1');
            seed([coordinator({ marker_after: 3 })]);
            expect(screen.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '3');
        });

        it('says so for a repository whose board has no stories', () => {
            render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
            seed([coordinator({ board_stories: [], marker_after: 0, board_doc_path: undefined })]);
            fireEvent.click(screen.getByTestId('coordinator-target-toggle'));
            expect(screen.getByTestId('coordinator-target-empty')).toHaveTextContent('This board has no stories.');
            expect(screen.queryByTestId('coordinator-target-line')).toBeNull();
        });
    });
});

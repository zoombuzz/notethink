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
        agent: 'coord-demo', vendor: 'claude-code', state: 'working', story: 'beta', machine: 'host-a', open_convoys: ['c1', 'c2'], root_relative: 'demo',
        board_doc_path: 'demo/docstech/users/dev/todo.md',
        board_stories: [
            { id: 'alpha', title: 'Alpha story', status: 'doing', convoys: [], operator_steps: ['Reply to the vendor'] },
            { id: 'beta', title: 'Beta story', status: '', convoys: ['repo-b'], operator_steps: [] },
            { id: 'gamma', title: 'Gamma story', status: '', convoys: [], operator_steps: [] },
        ],
        ...overrides,
    };
}

function seed(coordinators: ActivityCoordinator[]): void {
    const snapshot: ActivitySnapshot = { analyser: { state: 'live', refusals: [] }, sessions: [], trees: [], progress: [], coordinators, board_lines: [] };
    act(() => { setActivitySnapshot(snapshot); });
}

afterEach(() => {
    resetActivitySnapshot();
});

describe('the coordinator panel', () => {
    it('asks the host for activity once on mount and withdraws on unmount, so the coordinator files are read', () => {
        const post = jest.fn();
        const { unmount } = render(<CoordinatorPanel loaded_files={LOADED} post_message={post} />);
        expect(post).toHaveBeenCalledWith({ type: 'activityDemand' });
        unmount();
        expect(post).toHaveBeenCalledWith({ type: 'activityWithdraw' });
    });

    it('draws nothing when no coordinator is listed or none is in scope', () => {
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

    it('draws a coordinator waiting on questions with its own state word', () => {
        render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
        seed([coordinator({ state: 'waiting' })]);
        expect(screen.getByTestId('coordinator-state')).toHaveTextContent('Waiting on you');
        expect(screen.getByTestId('coordinator-row')).toHaveAttribute('data-state', 'waiting');
    });

    it('offers no way to start, stop or restart an agent', () => {
        render(<CoordinatorPanel loaded_files={LOADED} post_message={jest.fn()} />);
        seed([coordinator()]);
        const names = screen.getAllByRole('button').map(button => button.textContent);
        expect(names).toEqual(['Send to agent']);
        expect(screen.queryByTestId('coordinator-target-toggle')).toBeNull();
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

        it('asks before sending, and a cancelled pick sends nothing and keeps the reported vendor', () => {
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

        it('posts the vendor-change request once, naming the vendor as thinkersync spells it, and holds it as pending', () => {
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

        it('lets the pending vendor go once the coordinator reports the new one', () => {
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

        it('falls back to the reported vendor and says why when the request is refused', () => {
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
});

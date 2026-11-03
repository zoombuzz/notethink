import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AgentSessionRow from './AgentSessionRow';
import type { ActivitySessionState } from '../../../lib/agentactivityops';
import type { ActivityChildSession, ActivitySession } from '../../../types/AgentActivity';

const USAGE = { input_tokens: 1200, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };

function makeChild(id: string, overrides: Partial<ActivityChildSession> = {}): ActivityChildSession {
    return { child_id: id, title: `Task ${id}`, model: 'claude-haiku-5', state: 'ended', started_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:07:00Z', usage: USAGE, ...overrides };
}

function makeState(overrides: Partial<ActivitySession> = {}): ActivitySessionState {
    const session: ActivitySession = {
        session_id: 'abcdef123456', vendor: 'claude-code', project: 'notethink', story_binding: 'none',
        started_at: '2026-09-22T09:00:00Z', updated_at: '2026-09-22T10:08:00Z', state: 'working',
        capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
        usage: USAGE, model: 'claude-opus-5', ...overrides,
    };
    return { root_path: '/a', session };
}

function renderRow(state: ActivitySessionState): ReturnType<typeof render> {
    return render(<ul><AgentSessionRow state={state} refusals={[]} onOpen={() => undefined} /></ul>);
}

describe('AgentSessionRow tail-read note', () => {
    it('says beside the clock that usage and time cover only the newest part, when the transcript was cropped', () => {
        renderRow(makeState({ tail_read: true }));
        expect(screen.getByTestId('agent-tail-read')).toHaveTextContent('newest part only');
    });

    it('draws no note for a transcript read whole', () => {
        renderRow(makeState());
        expect(screen.queryByTestId('agent-tail-read')).not.toBeInTheDocument();
    });
});

describe('AgentSessionRow subagent tree', () => {
    it('draws no tree and no name for a session with neither children nor a name', () => {
        renderRow(makeState());
        expect(screen.queryByTestId('agent-children')).not.toBeInTheDocument();
        expect(screen.queryByTestId('agent-name')).not.toBeInTheDocument();
    });

    it('names the session beside its monogram and model when the vendor gave it a name', () => {
        renderRow(makeState({ session_name: 'coord-notethink' }));
        expect(screen.getByTestId('agent-name')).toHaveTextContent('coord-notethink');
    });

    it('draws each running child under the row with its model, state, run time, title and tokens', () => {
        renderRow(makeState({ children: [makeChild('a', { state: 'working', title: 'Map view code' }), makeChild('w', { state: 'waiting' })] }));
        const rows = screen.getAllByTestId('agent-child-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('data-state', 'working');
        expect(within(rows[0]).getByTestId('agent-child-title')).toHaveTextContent('Map view code');
        expect(within(rows[0]).getByTestId('agent-child-model')).toHaveTextContent('haiku-5');
        expect(within(rows[0]).getByTestId('agent-child-usage')).toHaveTextContent('1.5k tokens');
        expect(screen.queryByTestId('agent-children-toggle')).not.toBeInTheDocument();
        expect(within(rows[0]).queryByTestId('agent-child-state')).toBeNull();
        expect(within(rows[0]).getByTestId('agent-child-state-quiet')).toHaveTextContent('Working');
        expect(within(rows[1]).getByTestId('agent-child-state-quiet')).toHaveTextContent('Waiting on you');
    });

    it('draws the state word of a finished child', () => {
        renderRow(makeState({ children: [makeChild('a')] }));
        fireEvent.click(screen.getByTestId('agent-children-toggle'));
        expect(screen.getByTestId('agent-child-state')).toHaveTextContent('Ended');
    });

    it('hides every finished child behind one item that shows and hides them, dimmed, after the running ones', () => {
        const children = [makeChild('a'), makeChild('b'), makeChild('r', { state: 'working', title: 'Running one' }), makeChild('c'), makeChild('d')];
        renderRow(makeState({ children, children_omitted: 2 }));
        expect(screen.getAllByTestId('agent-child-row')).toHaveLength(1);
        const toggle = screen.getByTestId('agent-children-toggle');
        expect(toggle).toHaveTextContent('Show 4 finished subagents');
        expect(toggle.closest('[role="treeitem"]')).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        const rows = screen.getAllByTestId('agent-child-row');
        expect(rows).toHaveLength(5);
        expect(rows[0]).toHaveAttribute('data-state', 'working');
        expect(rows[1]).toHaveAttribute('data-state', 'ended');
        expect(within(rows[4]).getByTestId('agent-child-clock')).toHaveTextContent('7m');
        expect(screen.getByTestId('agent-children-toggle')).toHaveTextContent('Hide 4 finished subagents');
        expect(screen.getByTestId('agent-children-toggle').closest('[role="treeitem"]')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('agent-children-omitted')).toHaveTextContent('2 older finished subagents are not listed');
        fireEvent.click(screen.getByTestId('agent-children-toggle'));
        expect(screen.getAllByTestId('agent-child-row')).toHaveLength(1);
    });

    it('opens and closes the finished item with Right and Left', () => {
        renderRow(makeState({ children: [makeChild('a')] }));
        const item = screen.getByTestId('agent-children-toggle').closest('[role="treeitem"]') as HTMLElement;
        fireEvent.keyDown(item, { key: 'ArrowRight' });
        expect(screen.getAllByTestId('agent-child-row')).toHaveLength(1);
        fireEvent.keyDown(item, { key: 'ArrowLeft' });
        expect(screen.queryAllByTestId('agent-child-row')).toHaveLength(0);
    });

    it('renders a child that carries only its id and times', () => {
        renderRow(makeState({ children: [{ child_id: 'abcdefghijkl', state: 'working', started_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:01:00Z', usage: USAGE }] }));
        expect(screen.getByTestId('agent-child-title')).toHaveTextContent('abcdefgh');
    });
});

describe('AgentSessionRow tree item', () => {
    const kids = [makeChild('a', { state: 'working' }), makeChild('b')];

    it('is a treeitem with no aria-expanded when it has no subagents, and has no twisty', () => {
        renderRow(makeState());
        expect(screen.getByTestId('agent-row')).toHaveAttribute('role', 'treeitem');
        expect(screen.getByTestId('agent-row')).not.toHaveAttribute('aria-expanded');
        expect(screen.queryByTestId('agent-row-toggle')).not.toBeInTheDocument();
    });

    it('is expanded by default while working or waiting, collapsed while idle or ended', () => {
        for (const [state, open] of [['working', true], ['waiting', true], ['idle', false], ['ended', false]] as const) {
            const { unmount } = render(<ul><AgentSessionRow state={makeState({ state, children: kids })} refusals={[]} onOpen={() => undefined} /></ul>);
            expect(screen.getByTestId('agent-row')).toHaveAttribute('aria-expanded', String(open));
            expect(screen.queryAllByTestId('agent-child-row')).toHaveLength(open ? 1 : 0);
            unmount();
        }
    });

    it('toggles from the chevron, whose name differs from the open action, without opening the session', () => {
        const onOpen = jest.fn();
        render(<ul><AgentSessionRow state={makeState({ session_name: 'coord', children: kids })} refusals={[]} onOpen={onOpen} /></ul>);
        const chevron = screen.getByRole('button', { name: 'Collapse the subagents of coord' });
        expect(screen.getByTestId('agent-row-button')).not.toHaveAccessibleName(chevron.getAttribute('aria-label') as string);
        fireEvent.click(chevron);
        expect(screen.getByTestId('agent-row')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('agent-children')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Expand the subagents of coord' })).toBeInTheDocument();
        expect(onOpen).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('agent-row-button'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('collapses and expands with Left and Right on the row, ignoring a key meant for a child item', () => {
        renderRow(makeState({ children: [makeChild('a')] }));
        const row = screen.getByTestId('agent-row');
        fireEvent.keyDown(screen.getByTestId('agent-row-button'), { key: 'ArrowLeft' });
        expect(row).toHaveAttribute('aria-expanded', 'false');
        fireEvent.keyDown(screen.getByTestId('agent-row-button'), { key: 'ArrowRight' });
        expect(row).toHaveAttribute('aria-expanded', 'true');
    });

    it('keeps a chosen expansion across a snapshot update, while an unchosen one follows the state', () => {
        const { rerender } = render(<ul><AgentSessionRow state={makeState({ state: 'idle', children: kids })} refusals={[]} onOpen={() => undefined} /></ul>);
        expect(screen.getByTestId('agent-row')).toHaveAttribute('aria-expanded', 'false');
        rerender(<ul><AgentSessionRow state={makeState({ state: 'working', children: kids })} refusals={[]} onOpen={() => undefined} /></ul>);
        expect(screen.getByTestId('agent-row')).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByTestId('agent-row-toggle'));
        rerender(<ul><AgentSessionRow state={makeState({ state: 'ended', children: kids })} refusals={[]} onOpen={() => undefined} /></ul>);
        expect(screen.getByTestId('agent-row')).toHaveAttribute('aria-expanded', 'false');
        rerender(<ul><AgentSessionRow state={makeState({ state: 'working', children: kids })} refusals={[]} onOpen={() => undefined} /></ul>);
        expect(screen.getByTestId('agent-row')).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('AgentSessionRow registry-only row', () => {
    const registryOnly = (overrides: Partial<ActivitySession> = {}): ActivitySessionState => makeState({
        session_id: 'registry:agy-helper:demo', vendor: 'agy', registry_name: 'agy-helper', registry_only: true, registry_story: 'story-a',
        state: 'idle', capabilities: {}, model: undefined, usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
        ...overrides,
    });

    it('draws the name, a derived monogram for an unknown vendor, the state and the story', () => {
        renderRow(registryOnly());
        expect(screen.getByTestId('agent-name')).toHaveTextContent('agy-helper');
        expect(screen.getByTestId('agent-monogram')).toHaveTextContent('AG');
        expect(screen.getByTestId('agent-state')).toHaveTextContent('Idle');
        expect(screen.getByTestId('agent-live')).toHaveTextContent('Registered, on story-a');
        expect(screen.getByTestId('agent-usage')).toHaveTextContent('');
        expect(screen.getByTestId('agent-row')).toHaveAttribute('data-registry-only', 'true');
    });

    it('says a registered agent with no story is just registered', () => {
        renderRow(registryOnly({ registry_story: undefined }));
        expect(screen.getByTestId('agent-live')).toHaveTextContent('Registered agent');
    });

    it('is not a control, since there is no session to open', () => {
        const onOpen = jest.fn();
        render(<ul><AgentSessionRow state={registryOnly()} refusals={[]} onOpen={onOpen} /></ul>);
        const button = screen.getByTestId('agent-row-button');
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('keeps the state word of a working or waiting row for screen readers and draws it for no one', () => {
        const { unmount } = renderRow(registryOnly({ state: 'working' }));
        expect(screen.queryByTestId('agent-state')).toBeNull();
        expect(screen.getByTestId('agent-state-quiet')).toHaveTextContent('Working');
        unmount();
        renderRow(registryOnly({ state: 'waiting' }));
        expect(screen.queryByTestId('agent-state')).toBeNull();
        expect(screen.getByTestId('agent-state-quiet')).toHaveTextContent('Waiting on you');
    });

    it('draws the state word for every state other than working and waiting', () => {
        for (const state of ['idle', 'ended'] as const) {
            const { unmount } = renderRow(registryOnly({ state }));
            expect(screen.getByTestId('agent-state')).toHaveTextContent(state === 'idle' ? 'Idle' : 'Ended');
            expect(screen.queryByTestId('agent-state-quiet')).toBeNull();
            unmount();
        }
    });

    it('puts the header cells in order: monogram, name, clock, model', () => {
        renderRow(registryOnly({ state: 'working', model: 'claude-opus-5' }));
        const ids = Array.from(screen.getByTestId('agent-row-button').querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'));
        expect(ids.indexOf('agent-monogram')).toBeLessThan(ids.indexOf('agent-name'));
        expect(ids.indexOf('agent-name')).toBeLessThan(ids.indexOf('agent-clock'));
        expect(ids.indexOf('agent-clock')).toBeLessThan(ids.indexOf('agent-model'));
        expect(ids.indexOf('agent-model')).toBeLessThan(ids.indexOf('agent-live'));
    });

    it('reads a stale entry as Stale rather than Working', () => {
        renderRow(registryOnly({ state: 'idle', registry_stale: true }));
        expect(screen.getByTestId('agent-state')).toHaveTextContent('Stale');
        expect(screen.getByTestId('agent-row')).toHaveAttribute('data-stale', 'true');
    });

    it('leaves a vendor session joined to the registry as an openable row with its own state', () => {
        const onOpen = jest.fn();
        render(<ul><AgentSessionRow state={makeState({ registry_name: 'coord-demo' })} refusals={[]} onOpen={onOpen} /></ul>);
        expect(screen.getByTestId('agent-name')).toHaveTextContent('coord-demo');
        expect(screen.getByTestId('agent-state-quiet')).toHaveTextContent('Working');
        fireEvent.click(screen.getByTestId('agent-row-button'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});

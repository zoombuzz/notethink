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

function renderRow(state: ActivitySessionState): void {
    render(<ul><AgentSessionRow state={state} refusals={[]} onOpen={() => undefined} /></ul>);
}

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

    it('draws each child under the row with its model, state, run time, title and tokens, dimming a finished one', () => {
        renderRow(makeState({ children: [makeChild('a', { state: 'working', title: 'Map view code' }), makeChild('b')] }));
        const rows = screen.getAllByTestId('agent-child-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('data-state', 'working');
        expect(within(rows[0]).getByTestId('agent-child-title')).toHaveTextContent('Map view code');
        expect(within(rows[0]).getByTestId('agent-child-model')).toHaveTextContent('haiku-5');
        expect(within(rows[0]).getByTestId('agent-child-usage')).toHaveTextContent('1.5k tokens');
        expect(within(rows[1]).getByTestId('agent-child-clock')).toHaveTextContent('7m');
        expect(rows[1]).toHaveAttribute('data-state', 'ended');
    });

    it('folds finished children past the latest three behind a count button that expands and collapses them', () => {
        const children = ['a', 'b', 'c', 'd', 'e'].map(id => makeChild(id));
        renderRow(makeState({ children, children_omitted: 2 }));
        expect(screen.getAllByTestId('agent-child-row')).toHaveLength(3);
        const toggle = screen.getByTestId('agent-children-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveTextContent('Show 2 earlier finished subagents');
        fireEvent.click(toggle);
        expect(screen.getAllByTestId('agent-child-row')).toHaveLength(5);
        expect(screen.getByTestId('agent-children-toggle')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('agent-children-omitted')).toHaveTextContent('2 older finished subagents are not listed');
        fireEvent.click(screen.getByTestId('agent-children-toggle'));
        expect(screen.getAllByTestId('agent-child-row')).toHaveLength(3);
    });

    it('renders a child that carries only its id and times', () => {
        renderRow(makeState({ children: [{ child_id: 'abcdefghijkl', state: 'working', started_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:01:00Z', usage: USAGE }] }));
        expect(screen.getByTestId('agent-child-title')).toHaveTextContent('abcdefgh');
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

    it('reads a stale entry as Stale rather than Working', () => {
        renderRow(registryOnly({ state: 'idle', registry_stale: true }));
        expect(screen.getByTestId('agent-state')).toHaveTextContent('Stale');
        expect(screen.getByTestId('agent-row')).toHaveAttribute('data-stale', 'true');
    });

    it('leaves a vendor session joined to the registry as an openable row with its own state', () => {
        const onOpen = jest.fn();
        render(<ul><AgentSessionRow state={makeState({ registry_name: 'coord-demo' })} refusals={[]} onOpen={onOpen} /></ul>);
        expect(screen.getByTestId('agent-name')).toHaveTextContent('coord-demo');
        expect(screen.getByTestId('agent-state')).toHaveTextContent('Working');
        fireEvent.click(screen.getByTestId('agent-row-button'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});

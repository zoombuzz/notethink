import React from 'react';
import { render, screen } from '@testing-library/react';
import AgentMetaRow from './AgentMetaRow';
import type { AgentNoteModel } from './useAgentNoteModel';
import type { ActivitySessionState } from '../../../lib/agentactivityops';
import type { ActivitySession } from '../../../types/AgentActivity';

function makeSession(session_id: string, cost_usd: number | undefined, tokens: number): ActivitySessionState {
    const session: ActivitySession = {
        session_id,
        vendor: 'claude-code',
        project: 'notethink',
        story_binding: 'none',
        started_at: '2026-09-22T00:00:00Z',
        updated_at: '2026-09-22T00:00:00Z',
        state: 'working',
        capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
        usage: { input_tokens: tokens, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd, is_estimate: true },
    };
    return { root_path: '/a', session };
}

function makeModel(sessions: ActivitySessionState[], overrides: Partial<AgentNoteModel> = {}): AgentNoteModel {
    return {
        heard_from_host: true,
        analyser: { state: 'live', refusals: [] },
        has_completed_scan: true,
        refusals: [],
        unreadable_session_ids: [],
        is_virtual: false,
        story_key: undefined,
        root_path: '/a',
        sessions,
        winning_state: sessions.length > 0 ? 'working' : undefined,
        uncommitted: [],
        committed: [],
        has_git_tree: true,
        pending_commits: undefined,
        ...overrides,
    };
}

describe('AgentMetaRow', () => {

    it('draws nothing for a card with no sessions', () => {
        const { container } = render(<AgentMetaRow model={makeModel([])} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('reads one session as "1 ag" with its tokens and approximate cost', () => {
        render(<AgentMetaRow model={makeModel([makeSession('s1', 12.4, 8_203_112)])} />);
        expect(screen.getByTestId('agent-count')).toHaveTextContent(/^1 ag, 8\.2Mt, ~\$12\.40$/);
    });

    it('reads several sessions as "N ag" and sums their usage', () => {
        render(<AgentMetaRow model={makeModel([makeSession('s1', 1, 20_000), makeSession('s2', 2, 12_000), makeSession('s3', 3, 0)])} />);
        expect(screen.getByTestId('agent-count')).toHaveTextContent(/^3 ag, 32Kt, ~\$6\.00$/);
    });

    it('shows tokens alone when a session is unpriced, rather than a partial dollar figure', () => {
        render(<AgentMetaRow model={makeModel([makeSession('s1', 1, 1_100_000_000), makeSession('s2', undefined, 0)])} />);
        expect(screen.getByTestId('agent-count')).toHaveTextContent(/^2 ag, 1\.1Gt$/);
    });

    it('marks the figures busy while a scan is counting, and plainly once it is done', () => {
        const model = makeModel([makeSession('s1', 1, 10)]);
        const { rerender } = render(<AgentMetaRow model={model} scanning />);
        expect(screen.getByTestId('agent-count')).toHaveAttribute('aria-busy', 'true');
        rerender(<AgentMetaRow model={model} scanning={false} />);
        expect(screen.getByTestId('agent-count')).not.toHaveAttribute('aria-busy');
    });
});

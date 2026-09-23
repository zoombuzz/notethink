import React from 'react';
import { render, screen } from '@testing-library/react';
import AgentUsageSummary from './AgentUsageSummary';
import type { ActivitySessionState } from '../../../lib/agentactivityops';
import type { ActivitySession } from '../../../types/AgentActivity';

const NOW = Date.parse('2026-09-23T12:00:00Z');

function makeSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
    return {
        session_id: 's1',
        vendor: 'claude-code',
        project: 'notethink',
        story_binding: 'none',
        started_at: '2026-09-22T00:00:00Z',
        updated_at: '2026-09-22T00:00:00Z',
        state: 'working',
        capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
        usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
        ...overrides,
    };
}

describe('AgentUsageSummary', () => {

    it('draws nothing for an empty session list, rather than a zero-token line', () => {
        const { container } = render(<AgentUsageSummary sessions={[]} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('agent-usage-summary')).not.toBeInTheDocument();
    });

    it('draws the combined usage line once at least one session is on the card, spanning from its session start on a virtual note', () => {
        const sessions: ActivitySessionState[] = [{ root_path: '/a', session: makeSession() }];
        render(<AgentUsageSummary sessions={sessions} now={NOW} />);
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('2 tokens (2d)');
    });

    it('spans a story counter from the earliest call credited to the story, and the whole window when none is dated', () => {
        const story = { doc_path: 'todo.md', id: 'story-a' };
        const usage = { input_tokens: 5, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
        const dated: ActivitySessionState[] = [{ root_path: '/a', session: makeSession({ story_binding: 'bound', stories: [story], story_usage: [{ story, usage, first_at: '2026-09-23T07:00:00Z' }] }) }];
        const { rerender } = render(<AgentUsageSummary sessions={dated} storyKey={story} now={NOW} />);
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('5 tokens (5h)');
        const undated: ActivitySessionState[] = [{ root_path: '/a', session: makeSession({ story_binding: 'bound', stories: [story], story_usage: [{ story, usage }] }) }];
        rerender(<AgentUsageSummary sessions={undated} storyKey={story} now={NOW} />);
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('5 tokens (30d)');
    });

    it('counts only a session own split share for this story, not its whole usage, once a story key is given', () => {
        const story_a = { doc_path: 'todo.md', id: 'story-a' };
        const story_b = { doc_path: 'todo.md', id: 'story-b' };
        const session = makeSession({
            story_binding: 'bound',
            stories: [story_a, story_b],
            story_usage: [
                { story: story_a, usage: { input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true } },
                { story: story_b, usage: { input_tokens: 300, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true } },
            ],
            usage: { input_tokens: 400, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
        });
        const sessions: ActivitySessionState[] = [{ root_path: '/a', session }];
        render(<AgentUsageSummary sessions={sessions} storyKey={story_a} now={NOW} />);
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('100 tokens (30d)');
    });
});

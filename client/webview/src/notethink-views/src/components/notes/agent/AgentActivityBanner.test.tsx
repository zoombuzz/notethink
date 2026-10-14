import React from 'react';
import { render, screen } from '@testing-library/react';
import AgentActivityBanner from './AgentActivityBanner';
import type { AgentNoteModel } from './useAgentNoteModel';
import type { ActivityAnalyserState } from '../../../lib/agentactivityops';

/**
 * `reason_code` is what this banner actually renders translated copy from; the host's own English
 * `reason` sentence is a fallback only, for a code this build does not recognise. These pin the three
 * `unavailable` outcomes so a future change cannot quietly go back to splicing an English sentence
 * into a translated one (the bug a remote-window card showed: "cannot read LOCAL agent session files
 * IN THIS HOST" while running on a remote host with no vendor directory at all).
 */
function makeModel(overrides: Partial<AgentNoteModel> = {}): AgentNoteModel {
    return {
        heard_from_host: true,
        analyser: { state: 'live', refusals: [] },
        has_completed_scan: true,
        refusals: [],
        unreadable_session_ids: [],
        is_virtual: false,
        story_key: undefined,
        root_path: undefined,
        sessions: [],
        winning_state: undefined,
        uncommitted: [],
        committed: [],
        ...overrides,
    };
}

function unavailableAnalyser(overrides: Partial<ActivityAnalyserState> = {}): ActivityAnalyserState {
    return { state: 'unavailable', refusals: [], ...overrides };
}

describe('AgentActivityBanner unavailable notice', () => {
    it('names the remote host, fully translated, for reason_code remote_home_not_found', () => {
        const model = makeModel({ analyser: unavailableAnalyser({ reason_code: 'remote_home_not_found', reason: 'No .claude, .codex or .grok directory was found in this remote workspace folder or its ancestors.' }) });
        render(<AgentActivityBanner model={model} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveTextContent('Agent activity unavailable on the remote host');
        // the detail is the fully translated sentence, never the host's own English reason spliced in
        expect(notice).toHaveAttribute('title', 'No .claude, .codex or .grok directory was found on the remote host for this workspace.');
        expect(notice.getAttribute('title')).not.toContain('local');
    });

    it('says local, fully translated, for reason_code no_local_access', () => {
        const model = makeModel({ analyser: unavailableAnalyser({ reason_code: 'no_local_access', reason: 'This host has no local file access the analyser recognises (a web host, or an unrecognised user-data layout).' }) });
        render(<AgentActivityBanner model={model} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveTextContent('Agent activity unavailable');
        expect(notice).toHaveAttribute('title', 'NoteThink cannot read local agent session files on this host, such as a web host with no local disk or an unrecognised user-data layout.');
    });

    it('falls back to the free-text reason when no reason_code is present, for a host this build does not recognise', () => {
        const model = makeModel({ analyser: unavailableAnalyser({ reason: 'a custom reason from a newer host' }) });
        render(<AgentActivityBanner model={model} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveTextContent('Agent activity unavailable');
        expect(notice).toHaveAttribute('title', 'NoteThink cannot read local agent session files in this host. a custom reason from a newer host');
    });

    it('falls back to the generic web-host wording when neither a reason_code nor a reason is present', () => {
        const model = makeModel({ analyser: unavailableAnalyser() });
        render(<AgentActivityBanner model={model} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveAttribute('title', 'NoteThink cannot read local agent session files in this host. This usually means a web host with no local disk.');
    });
});

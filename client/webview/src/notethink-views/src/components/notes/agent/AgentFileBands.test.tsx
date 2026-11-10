import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AgentFileBands from './AgentFileBands';
import type { AgentFileEntry, AgentNoteModel } from './useAgentNoteModel';

function makeEntries(count: number, counts?: { added: number; removed: number }): AgentFileEntry[] {
    return Array.from({ length: count }, (_unused, index) => ({ file: { path: `f${index}.ts`, change: 'modified' as const, ...counts }, session: undefined }));
}

function makeModel(overrides: Partial<AgentNoteModel> = {}): AgentNoteModel {
    return {
        heard_from_host: true,
        analyser: { state: 'live', refusals: [] },
        has_completed_scan: true,
        refusals: [],
        unreadable_session_ids: [],
        is_virtual: false,
        story_key: undefined,
        root_path: '/a',
        sessions: [],
        winning_state: undefined,
        uncommitted: [],
        committed: [],
        has_git_tree: true,
        pending_commits: undefined,
        ...overrides,
    };
}

function draw(model: AgentNoteModel, extra: { expanded?: boolean; onToggleExpanded?: (expanded: boolean) => void } = {}): void {
    render(<AgentFileBands model={model} unavailable={undefined} onOpenDiff={jest.fn()} {...extra} />);
}

describe('AgentFileBands', () => {

    it('reads nothing uncommitted as one line that does not expand', () => {
        draw(makeModel());
        expect(screen.getByTestId('agent-file-bands-empty')).toHaveTextContent('No uncommitted files');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('collapses uncommitted files into a count with their summed line counts, and no rows', () => {
        draw(makeModel({ uncommitted: makeEntries(5, { added: 24, removed: 7 }) }));
        const toggle = screen.getByTestId('agent-file-band-toggle-uncommitted');
        expect(toggle).toHaveTextContent('5 uncommitted files +120 -35');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryAllByTestId('agent-file-row')).toHaveLength(0);
    });

    it('lists every file, past three, once expanded by its own state', () => {
        draw(makeModel({ uncommitted: makeEntries(6) }));
        fireEvent.click(screen.getByTestId('agent-file-band-toggle-uncommitted'));
        expect(screen.getAllByTestId('agent-file-row')).toHaveLength(6);
        expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
    });

    it('defers to the owner when it supplies a toggle, reporting the next state and drawing the state it is given', () => {
        const onToggle = jest.fn();
        draw(makeModel({ uncommitted: makeEntries(2) }), { expanded: false, onToggleExpanded: onToggle });
        fireEvent.click(screen.getByTestId('agent-file-band-toggle-uncommitted'));
        expect(onToggle).toHaveBeenCalledWith(true);
        expect(screen.queryAllByTestId('agent-file-row')).toHaveLength(0);
    });

    it('draws the rows an owner holds expanded, and asks to collapse them on click', () => {
        const onToggle = jest.fn();
        draw(makeModel({ uncommitted: makeEntries(2) }), { expanded: true, onToggleExpanded: onToggle });
        expect(screen.getAllByTestId('agent-file-row')).toHaveLength(2);
        fireEvent.click(screen.getByTestId('agent-file-band-toggle-uncommitted'));
        expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('says how many files the counts cover when some have none', () => {
        draw(makeModel({ uncommitted: [...makeEntries(1, { added: 1, removed: 1 }), ...makeEntries(2)] }));
        expect(screen.getByTestId('agent-file-band-toggle-uncommitted')).toHaveAttribute('title', 'Line counts cover 1 of 3 files');
    });

    it('draws the pending commits row in each of its four states, and leaves it off with no working tree', () => {
        const states: Array<[number | undefined, string, string]> = [
            [undefined, 'No upstream', 'false'],
            [0, 'No pending commits', 'false'],
            [1, '1 pending commit', 'true'],
            [4, '4 pending commits', 'true'],
        ];
        for (const [count, text, pending] of states) {
            const { unmount } = render(<AgentFileBands model={makeModel({ pending_commits: count })} unavailable={undefined} onOpenDiff={jest.fn()} />);
            expect(screen.getByTestId('agent-pending-commits')).toHaveTextContent(new RegExp(`^${text}$`));
            expect(screen.getByTestId('agent-pending-commits')).toHaveAttribute('data-pending', pending);
            unmount();
        }
        draw(makeModel({ has_git_tree: false }));
        expect(screen.queryByTestId('agent-pending-commits')).not.toBeInTheDocument();
    });
});

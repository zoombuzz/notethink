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
        pending_detail: undefined,
        ...overrides,
    };
}

function draw(model: AgentNoteModel, extra: { expanded?: boolean; onToggleExpanded?: (expanded: boolean) => void; pendingExpanded?: boolean; onTogglePendingExpanded?: (expanded: boolean) => void } = {}): void {
    render(<AgentFileBands model={model} unavailable={undefined} onOpenDiff={jest.fn()} {...extra} />);
}

describe('AgentFileBands', () => {

    it('reads nothing uncommitted and nothing pending as one line that does not expand', () => {
        draw(makeModel({ pending_commits: 0 }));
        expect(screen.getByTestId('agent-file-bands-empty')).toHaveTextContent(/^No uncommitted files or pending commits$/);
        expect(screen.queryByTestId('agent-pending-commits')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('folds nothing uncommitted and no upstream into one line', () => {
        draw(makeModel({ pending_commits: undefined }));
        expect(screen.getByTestId('agent-file-bands-empty')).toHaveTextContent(/^No uncommitted files, no upstream$/);
        expect(screen.queryByTestId('agent-pending-commits')).not.toBeInTheDocument();
    });

    it('keeps two rows when nothing is uncommitted but commits are pending', () => {
        draw(makeModel({ pending_commits: 3 }));
        expect(screen.getByTestId('agent-file-bands-empty')).toHaveTextContent(/^No uncommitted files$/);
        expect(screen.getByTestId('agent-pending-commits')).toHaveTextContent('3 pending commits');
    });

    it('keeps two rows when files are uncommitted, whatever the pending state', () => {
        for (const count of [undefined, 0]) {
            const { unmount } = render(<AgentFileBands model={makeModel({ uncommitted: makeEntries(1), pending_commits: count })} unavailable={undefined} onOpenDiff={jest.fn()} />);
            expect(screen.getByTestId('agent-file-band-toggle-uncommitted')).toBeInTheDocument();
            expect(screen.getByTestId('agent-pending-commits')).toBeInTheDocument();
            unmount();
        }
    });

    it('keeps the no-working-tree card to the plain empty line with no pending row', () => {
        draw(makeModel({ has_git_tree: false }));
        expect(screen.getByTestId('agent-file-bands-empty')).toHaveTextContent(/^No uncommitted files$/);
    });

    it('shares one grey between the quiet line and the pending row, and keeps the waiting colour apart', () => {
        draw(makeModel({ uncommitted: makeEntries(1), pending_commits: 0 }));
        const grey_class = screen.getByTestId('agent-pending-commits').className;
        draw(makeModel({ uncommitted: makeEntries(1), pending_commits: undefined }));
        expect(screen.getAllByTestId('agent-pending-commits')[1].className).toBe(grey_class);
        draw(makeModel({ uncommitted: makeEntries(1), pending_commits: 2 }));
        expect(screen.getAllByTestId('agent-pending-commits')[2].className).not.toBe(grey_class);
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
            const { unmount } = render(<AgentFileBands model={makeModel({ uncommitted: makeEntries(1), pending_commits: count })} unavailable={undefined} onOpenDiff={jest.fn()} />);
            expect(screen.getByTestId('agent-pending-commits')).toHaveTextContent(new RegExp(`^${text}$`));
            expect(screen.getByTestId('agent-pending-commits')).toHaveAttribute('data-pending', pending);
            unmount();
        }
        draw(makeModel({ uncommitted: makeEntries(1), has_git_tree: false }));
        expect(screen.queryByTestId('agent-pending-commits')).not.toBeInTheDocument();
    });

    describe('pending commit detail', () => {
        const DETAIL = [
            { short_sha: 'abc1234', files: 3, added: 100, removed: 4 },
            { short_sha: 'def5678', files: 1, added: 20, removed: 30 },
        ];

        it('stays a plain line with pending commits but no detail', () => {
            draw(makeModel({ pending_commits: 2 }), { onTogglePendingExpanded: jest.fn() });
            expect(screen.queryByTestId('agent-pending-commits-toggle')).not.toBeInTheDocument();
            expect(screen.getByTestId('agent-pending-commits')).toHaveTextContent(/^2 pending commits$/);
        });

        it('stays a plain line with no pending commits or no upstream, whatever the detail says', () => {
            for (const count of [0, undefined]) {
                const { unmount } = render(<AgentFileBands model={makeModel({ uncommitted: makeEntries(1), pending_commits: count, pending_detail: DETAIL })} unavailable={undefined} onOpenDiff={jest.fn()} onTogglePendingExpanded={jest.fn()} />);
                expect(screen.queryByTestId('agent-pending-commits-toggle')).not.toBeInTheDocument();
                unmount();
            }
        });

        it('folds to one summary with the line totals across the listed commits, collapsed by default', () => {
            draw(makeModel({ pending_commits: 2, pending_detail: DETAIL }), { pendingExpanded: false, onTogglePendingExpanded: jest.fn() });
            const toggle = screen.getByTestId('agent-pending-commits-toggle');
            expect(toggle).toHaveTextContent(/^2 pending commits\s+\+120\s+-34$/);
            expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(toggle).not.toHaveAttribute('title');
            expect(screen.queryAllByTestId('agent-pending-commit-row')).toHaveLength(0);
        });

        it('asks the card to unfold, then lists each commit with its short hash and file count', () => {
            const onToggle = jest.fn();
            draw(makeModel({ pending_commits: 2, pending_detail: DETAIL }), { pendingExpanded: false, onTogglePendingExpanded: onToggle });
            fireEvent.click(screen.getByTestId('agent-pending-commits-toggle'));
            expect(onToggle).toHaveBeenCalledWith(true);
        });

        it('lists every commit when expanded, with 1 file singular and no bound line when unbounded', () => {
            draw(makeModel({ pending_commits: 2, pending_detail: DETAIL }), { pendingExpanded: true, onTogglePendingExpanded: jest.fn() });
            const rows = screen.getAllByTestId('agent-pending-commit-row');
            expect(rows).toHaveLength(2);
            expect(rows[0]).toHaveTextContent('abc1234');
            expect(rows[0]).toHaveTextContent('3 files');
            expect(rows[1]).toHaveTextContent('1 file');
            expect(rows[1]).not.toHaveTextContent('1 files');
            expect(screen.queryByTestId('agent-pending-commits-bound')).not.toBeInTheDocument();
        });

        it('says so when the list is bounded, and says how many commits the line totals cover', () => {
            draw(makeModel({ pending_commits: 35, pending_detail: DETAIL }), { pendingExpanded: true, onTogglePendingExpanded: jest.fn() });
            expect(screen.getByTestId('agent-pending-commits-bound')).toHaveTextContent('Showing the latest 2 of 35 pending commits');
            expect(screen.getByTestId('agent-pending-commits-toggle')).toHaveAttribute('title', 'Line counts cover 2 of 35 pending commits');
        });

        it('lists a commit whose figures could not be read by its hash alone, and leaves it out of the totals', () => {
            draw(makeModel({ pending_commits: 2, pending_detail: [{ short_sha: 'abc1234' }, DETAIL[1]] }), { pendingExpanded: true, onTogglePendingExpanded: jest.fn() });
            expect(screen.getAllByTestId('agent-pending-commit-row')[0]).toHaveTextContent(/^abc1234$/);
            expect(screen.getByTestId('agent-pending-commits-toggle')).toHaveTextContent(/\+20\s+-30$/);
            expect(screen.getByTestId('agent-pending-commits-toggle')).toHaveAttribute('title', 'Line counts cover 1 of 2 pending commits');
        });

        it('omits the totals when no listed commit was diffed', () => {
            draw(makeModel({ pending_commits: 1, pending_detail: [{ short_sha: 'abc1234', files: 2 }] }), { pendingExpanded: false, onTogglePendingExpanded: jest.fn() });
            expect(screen.queryByTestId('agent-pending-commits-line-diff')).not.toBeInTheDocument();
        });
        it('keeps the pending row and the files row independent: each reads and asks on its own props', () => {
            const onToggleFiles = jest.fn();
            const onTogglePending = jest.fn();
            draw(makeModel({ uncommitted: makeEntries(2), pending_commits: 2, pending_detail: DETAIL }), { expanded: true, onToggleExpanded: onToggleFiles, pendingExpanded: false, onTogglePendingExpanded: onTogglePending });
            expect(screen.getByTestId('agent-file-band-toggle-uncommitted')).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByTestId('agent-pending-commits-toggle')).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryAllByTestId('agent-pending-commit-row')).toHaveLength(0);
            fireEvent.click(screen.getByTestId('agent-pending-commits-toggle'));
            expect(onTogglePending).toHaveBeenCalledWith(true);
            expect(onToggleFiles).not.toHaveBeenCalled();
        });

        it('draws the pending commits open while the files row is closed', () => {
            draw(makeModel({ uncommitted: makeEntries(2), pending_commits: 2, pending_detail: DETAIL }), { expanded: false, onToggleExpanded: jest.fn(), pendingExpanded: true, onTogglePendingExpanded: jest.fn() });
            expect(screen.getByTestId('agent-file-band-toggle-uncommitted')).toHaveAttribute('aria-expanded', 'false');
            expect(screen.getAllByTestId('agent-pending-commit-row')).toHaveLength(2);
        });
    });
});

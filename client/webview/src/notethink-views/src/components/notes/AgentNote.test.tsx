import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AgentNote from './AgentNote';
import AgentCommitBand from './agent/AgentCommitBand';
import { AGENT_VIRTUAL_NAMESPACE, unboundSessionKey, type ActivityAnalyserState, type ActivitySessionState, type ActivitySnapshot } from '../../lib/agentactivityops';
import { resetActivitySnapshot, setActivitySnapshot } from '../../lib/activityhooks';
import { makeVirtualNote } from '../../lib/virtualnoteops';
import type { ActivitySession, ActivityTree } from '../../types/AgentActivity';
import type { NoteProps } from '../../types/NoteProps';

const ROOT_PATH = '/mnt/workspace/in_development/notethink';
const ROOT_RELATIVE = 'notethink';
const TODO_PATH = `${ROOT_RELATIVE}/docstech/users/alex.stanhope/todo.md`;

function makeSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
    return {
        session_id: 'claude-bound-busy',
        vendor: 'claude-code',
        project: 'notethink',
        started_at: '2026-09-18T08:51:30Z',
        updated_at: '2026-09-18T09:14:01Z',
        state: 'working',
        story_binding: 'bound',
        stories: [{ doc_path: TODO_PATH, id: 'agent-activity-card' }],
        story_usage: [{ story: { doc_path: TODO_PATH, id: 'agent-activity-card' }, usage: { input_tokens: 1200, output_tokens: 340, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.12, is_estimate: true } }],
        capabilities: { live_tool_call: 'supported', question: 'supported', file_attribution: 'supported' },
        current: { at: '2026-09-18T09:14:01Z', kind: 'tool_call', tool: 'Edit', arg: 'client/extension/src/types/AgentActivity.ts' },
        usage: { input_tokens: 1200, output_tokens: 340, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.12, is_estimate: true },
        ...overrides,
    };
}

function makeSessionState(session: ActivitySession, root_path = ROOT_PATH): ActivitySessionState {
    return { root_path, session };
}

function makeAnalyserState(overrides: Partial<ActivityAnalyserState> = {}): ActivityAnalyserState {
    return { state: 'live', refusals: [], ...overrides };
}

function seed(overrides: Partial<ActivitySnapshot> & { analyser?: Partial<ActivityAnalyserState> } = {}): void {
    const { analyser, ...rest } = overrides;
    const snapshot: ActivitySnapshot = {
        analyser: makeAnalyserState(analyser),
        sessions: [],
        trees: [],
        ...rest,
    };
    setActivitySnapshot(snapshot);
}

/** a parsed story note carrying the authored id linetag a binding refers to */
function makeStoryNote(overrides: Partial<NoteProps> = {}, postMessage?: jest.Mock): NoteProps {
    return {
        seq: 3,
        level: 1,
        type: 'heading',
        stable_id: 'doc:agent-activity-card',
        children_body: [],
        children: [{ type: 'text', value: 'Agent activity card', children: [], position: { start: { offset: 4, line: 1 }, end: { offset: 24, line: 1 } } }],
        position: { start: { offset: 0, line: 1 }, end: { offset: 24, line: 1 } },
        headline_raw: '### Agent activity card',
        body_raw: '',
        linetags: { id: { key: 'id', value: 'agent-activity-card', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 3 } },
        origin: { doc_id: 'doc', doc_path: `/workspace/${TODO_PATH}`, relative_path: TODO_PATH },
        display_options: { id: 'v1-n3' },
        handlers: postMessage ? { postMessage } : undefined,
        ...overrides,
    };
}

afterEach(() => {
    resetActivitySnapshot();
});

describe('AgentNote', () => {

    it('marks itself as the agent card so views and specs can tell the cards apart', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        const { container } = render(<AgentNote {...makeStoryNote()} />);
        expect(container.querySelector('[data-card-type="agent"]')).toBeInTheDocument();
        expect(screen.getByText('Agent activity card')).toBeInTheDocument();
    });

    it('draws one row per agent that declared this story, with the state in words and the live tool call', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote()} />);
        const rows = screen.getAllByTestId('agent-row');
        expect(rows).toHaveLength(1);
        expect(within(rows[0]).getByTestId('agent-monogram')).toHaveTextContent('CC');
        expect(within(rows[0]).getByTestId('agent-state')).toHaveTextContent('Working');
        expect(within(rows[0]).getByTestId('agent-live')).toHaveTextContent('Edit client/extension/src/types/AgentActivity.ts');
        expect(rows[0]).toHaveAttribute('data-state', 'working');
    });

    it('draws the model id on an agent row without the prefix the monogram repeats, whole on hover, and nothing when the session carries none', () => {
        seed({ sessions: [makeSessionState(makeSession({ model: 'claude-opus-5' }))] });
        const { rerender } = render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-model')).toHaveTextContent(/^opus-5$/);
        expect(screen.getByTestId('agent-model')).toHaveAttribute('title', 'claude-opus-5');
        act(() => { resetActivitySnapshot(); seed({ sessions: [makeSessionState(makeSession({ model: undefined }))] }); });
        rerender(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-model')).toHaveTextContent('');
    });

    it('draws a token and cost counter on the story and on each agent row, stating the figure is estimated', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('~$0.12');
        expect(screen.getByTestId('agent-usage')).toHaveTextContent('~$0.12');
    });

    it('counts on each row only its session share of this story, the figure the story total sums, and leaves the window to that total', () => {
        seed({ sessions: [makeSessionState(makeSession({
            usage: { input_tokens: 400_000_000, output_tokens: 44_100_000, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 291.49, is_estimate: true },
        }))] });
        render(<AgentNote {...makeStoryNote()} />);
        const row_usage = screen.getByTestId('agent-usage');
        expect(row_usage).toHaveTextContent('1.5k tokens ~$0.12');
        expect(row_usage).not.toHaveTextContent('(30d)');
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('1.5k tokens (30d) ~$0.12');
    });

    it('states the story counter span from its earliest counted activity, not the whole 30 day window', () => {
        const story = { doc_path: TODO_PATH, id: 'agent-activity-card' };
        const two_days_ago = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
        seed({ sessions: [makeSessionState(makeSession({
            story_usage: [{ story, first_at: two_days_ago, usage: { input_tokens: 1200, output_tokens: 340, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.12, is_estimate: true } }],
        }))] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-usage-summary')).toHaveTextContent('1.5k tokens (2d) ~$0.12');
    });

    it('draws no band for a vendor that cannot report a question, leaving the row to state the agent', () => {
        const blind = { question: 'unsupported' };
        seed({ sessions: [
            makeSessionState(makeSession({ session_id: 'cc-1', current: undefined, capabilities: blind })),
            makeSessionState(makeSession({ session_id: 'co-1', vendor: 'codex', current: undefined, capabilities: blind })),
        ] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.queryByTestId('agent-question-bands')).not.toBeInTheDocument();
        expect(screen.queryByText(/cannot report whether/)).not.toBeInTheDocument();
    });

    it('draws no session on a card whose resolved path the binding does not match', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote({ origin: { doc_id: 'doc', doc_path: '/w/notegit/todo.md', relative_path: 'notegit/docstech/users/alex.stanhope/todo.md' } })} />);
        expect(screen.queryByTestId('agent-row')).not.toBeInTheDocument();
    });

    it('says a vendor cannot report what it is running, rather than drawing an empty live line', () => {
        seed({ sessions: [makeSessionState(makeSession({ current: undefined, state: 'unknown', capabilities: {} }))] });
        render(<AgentNote {...makeStoryNote()} />);
        const live = screen.getByTestId('agent-live');
        expect(live).toHaveAttribute('data-fact', 'unsupported');
        expect(live).toHaveTextContent('claude-code cannot report what it is running');
        expect(screen.getByTestId('agent-state')).toHaveTextContent('State not reported');
    });

    it('distinguishes nothing running from nothing reportable', () => {
        seed({ sessions: [makeSessionState(makeSession({ current: undefined, state: 'idle' }))] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-live')).toHaveAttribute('data-fact', 'quiet');
        expect(screen.getByTestId('agent-live')).toHaveTextContent('Nothing running');
    });

    it('draws a pending question as a band, with the options the vendor offered', () => {
        seed({ sessions: [makeSessionState(makeSession({
            state: 'waiting',
            question: { question_id: 'q-4417', asked_at: '2026-09-18T09:13:40Z', prompt: 'Apply the rename across all 14 call sites?', options: ['Yes', 'No, just this one'] },
        }))] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-question-prompt')).toHaveTextContent('Apply the rename across all 14 call sites?');
        expect(screen.getByTestId('agent-question-options')).toHaveTextContent('Yes / No, just this one');
    });

    it('says a Claude Code session is waiting on you from its reported state alone, with no question text', () => {
        seed({ sessions: [makeSessionState(makeSession({ state: 'waiting', capabilities: { live_tool_call: 'supported', question: 'unsupported' } }))] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-state-chip')).toHaveAttribute('data-state', 'waiting');
        expect(screen.getByTestId('agent-row')).toHaveAttribute('data-state', 'waiting');
        expect(screen.queryByTestId('agent-question-band')).not.toBeInTheDocument();
    });

    it('draws no question band at all for an agent whose vendor reports questions and has none pending', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.queryByTestId('agent-question-band')).not.toBeInTheDocument();
    });

    it('wraps everything after the headline in the shared body class, so the lane and document padding rules pick it up', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        const { container } = render(<AgentNote {...makeStoryNote()} />);
        const body = container.querySelector('.body');
        expect(body).toBeInTheDocument();
        expect(body).toHaveClass('agentBody');
        expect(within(body as HTMLElement).getByTestId('agent-rows')).toBeInTheDocument();
    });

    it('colours and labels the card by its most urgent session, and counts the agents on it', () => {
        seed({ sessions: [
            makeSessionState(makeSession({ session_id: 'idle-one', state: 'idle' })),
            makeSessionState(makeSession({ session_id: 'waiting-two', vendor: 'grok', state: 'waiting' })),
        ] });
        const { container } = render(<AgentNote {...makeStoryNote()} />);
        expect(container.querySelector('[data-winning-state="waiting"]')).toBeInTheDocument();
        expect(screen.getByTestId('agent-state-chip')).toHaveAttribute('data-state', 'waiting');
        expect(screen.getByTestId('agent-state-chip')).toHaveTextContent('Waiting on you');
        expect(screen.getByTestId('agent-count')).toHaveTextContent('2 agent(s)');
    });

    it('draws no meta row on a card with no sessions', () => {
        seed({ sessions: [] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.queryByTestId('agent-meta-row')).not.toBeInTheDocument();
    });

    it('draws each row how long the session ran, not how long ago it stopped, with both timestamps on hover', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-24T09:26:01Z'));
        seed({ sessions: [makeSessionState(makeSession({ state: 'ended', started_at: '2026-09-18T06:09:01Z', updated_at: '2026-09-18T09:14:01Z' }))] });
        render(<AgentNote {...makeStoryNote()} />);
        const clock = screen.getByTestId('agent-clock');
        expect(clock).toHaveTextContent('3h 05m');
        expect(clock).toHaveAttribute('title', expect.stringContaining('2026-09-18T06:09:01Z'));
        expect(clock).toHaveAttribute('title', expect.stringContaining('2026-09-18T09:14:01Z'));
        jest.useRealTimers();
    });

    it('draws a refusal naming a session on that session own row', () => {
        seed({
            sessions: [makeSessionState(makeSession())],
            analyser: { refusals: [{ file: 'claude-code transcript for claude-b', code: 'too_large', reason: 'over the byte bound', session_id: 'claude-bound-busy' }] },
        });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-row-refusals')).toHaveTextContent('could not be read');
        expect(screen.queryByTestId('agent-banner-refusals')).not.toBeInTheDocument();
    });
});

describe('AgentNote file and commit bands', () => {

    const tree: ActivityTree = {
        generated_at: '2026-09-18T09:14:02Z',
        branch: 'staging',
        head_commit: 'ef11de8',
        uncommitted: [
            { path: 'client/extension/src/types/AgentActivity.ts', change: 'added', session_id: 'claude-bound-busy' },
            { path: 'package.json', change: 'modified' },
        ],
        committed: [
            { sha: 'a'.repeat(40), subject: 'wire the analyser', session_id: 'claude-bound-busy' },
            { sha: 'b'.repeat(40), subject: 'unattributed commit' },
        ],
    };

    function seedTree(postMessage?: jest.Mock): jest.Mock {
        const post = postMessage ?? jest.fn();
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree }] });
        render(<AgentNote {...makeStoryNote({}, post)} />);
        return post;
    }

    it('lists an attributed uncommitted file under its vendor and an unattributed one as unattributed', () => {
        seedTree();
        const rows = screen.getAllByTestId('agent-file-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('data-attributed', 'true');
        expect(within(rows[0]).getByTestId('agent-file-attribution')).toHaveTextContent('CC');
        expect(rows[1]).toHaveAttribute('data-attributed', 'false');
        expect(within(rows[1]).getByTestId('agent-file-attribution')).toHaveTextContent('unattributed');
    });

    it('draws a file\'s own +added -removed, and the band header\'s total summed only across files the analyser actually diffed', () => {
        const diff_tree: ActivityTree = {
            ...tree,
            uncommitted: [
                { path: 'client/extension/src/types/AgentActivity.ts', change: 'added', session_id: 'claude-bound-busy', added: 12, removed: 0 },
                { path: 'package.json', change: 'modified', added: 3, removed: 1 },
                { path: 'src/big.bin', change: 'modified' },
            ],
        };
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: diff_tree }] });
        render(<AgentNote {...makeStoryNote()} />);
        const rows = screen.getAllByTestId('agent-file-row');
        expect(within(rows[0]).getByTestId('agent-file-line-diff')).toHaveTextContent('+12 -0');
        expect(within(rows[1]).getByTestId('agent-file-line-diff')).toHaveTextContent('+3 -1');
        expect(within(rows[2]).queryByTestId('agent-file-line-diff')).not.toBeInTheDocument();
        expect(screen.getByTestId('agent-file-band-line-diff-uncommitted')).toHaveTextContent('+15 -1');
    });

    it('marks a modified file with git\'s one-letter M rather than the word, keeping the word for the other kinds', () => {
        const kinds_tree: ActivityTree = {
            ...tree,
            uncommitted: [
                { path: 'a.ts', change: 'modified' },
                { path: 'b.ts', change: 'added' },
            ],
        };
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: kinds_tree }] });
        render(<AgentNote {...makeStoryNote()} />);
        const marks = screen.getAllByTestId('agent-file-change');
        expect(marks[0]).toHaveTextContent(/^M$/);
        expect(marks[0]).toHaveAttribute('title', 'modified');
        expect(marks[1]).toHaveTextContent(/^added$/);
    });

    it('shows no total in the band header when no file in it carries a line diff', () => {
        seedTree();
        expect(screen.queryByTestId('agent-file-band-line-diff-uncommitted')).not.toBeInTheDocument();
    });

    it('leaves the branch\'s commits off the card, however many the tree carries', () => {
        seedTree();
        expect(screen.getByTestId('agent-file-band-uncommitted')).toBeInTheDocument();
        expect(screen.queryByTestId('agent-commit-band')).not.toBeInTheDocument();
        expect(screen.queryByTestId('agent-commit-row')).not.toBeInTheDocument();
    });

    it('keeps the commit band drawable on its own, listing commits rather than files', () => {
        const entries = [
            { commit: { sha: 'b'.repeat(40), subject: 'wire the analyser' }, session: makeSessionState(makeSession()) },
            { commit: { sha: 'c'.repeat(40), subject: 'tidy the roster' }, session: undefined },
        ];
        render(<AgentCommitBand title="Committed on this branch" entries={entries} emptyLabel="Nothing committed on this branch" />);
        const rows = screen.getAllByTestId('agent-commit-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('wire the analyser');
        expect(rows[0]).toHaveAttribute('data-attributed', 'true');
        expect(rows[1]).toHaveAttribute('data-attributed', 'false');
    });

    it('heads the uncommitted band with its count, capping the rows shown and naming how many more there are', () => {
        const busy_tree: ActivityTree = {
            ...tree,
            uncommitted: [
                { path: 'a.ts', change: 'modified' },
                { path: 'b.ts', change: 'modified' },
                { path: 'c.ts', change: 'modified' },
                { path: 'd.ts', change: 'modified' },
                { path: 'e.ts', change: 'modified' },
            ],
        };
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: busy_tree }] });
        render(<AgentNote {...makeStoryNote()} />);
        const band = screen.getByTestId('agent-file-band-uncommitted');
        expect(band).toHaveTextContent('5 uncommitted');
        expect(within(band).getAllByTestId('agent-file-row')).toHaveLength(3);
        expect(within(band).getByTestId('agent-file-band-more-uncommitted')).toHaveTextContent('and 2 more');
    });

    it('unfolds the capped band from "and N more" and folds it back from "Show less", on the view\'s own expansion list', () => {
        const busy_tree: ActivityTree = {
            ...tree,
            uncommitted: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map(path => ({ path, change: 'modified' as const })),
        };
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: busy_tree }] });
        // stand-in for a real view: owns view_expanded_ids and supplies the handler the card dispatches through
        function Harness(): React.ReactElement {
            const [expanded_ids, setExpandedIds] = React.useState<string[]>([]);
            const setNoteExpanded = (stable_id: string, expanded: boolean): void => {
                setExpandedIds(ids => (expanded ? [...ids.filter(id => id !== stable_id), stable_id] : ids.filter(id => id !== stable_id)));
            };
            const note = makeStoryNote();
            return <AgentNote {...note} display_options={{ ...note.display_options, view_expanded_ids: expanded_ids }} handlers={{ setNoteExpanded }} />;
        }
        render(<Harness />);
        const band = screen.getByTestId('agent-file-band-uncommitted');
        expect(within(band).getAllByTestId('agent-file-row')).toHaveLength(3);
        expect(within(band).queryByTestId('agent-file-band-less-uncommitted')).not.toBeInTheDocument();
        fireEvent.click(within(band).getByTestId('agent-file-band-more-uncommitted'));
        expect(within(band).getAllByTestId('agent-file-row')).toHaveLength(5);
        expect(within(band).queryByTestId('agent-file-band-more-uncommitted')).not.toBeInTheDocument();
        fireEvent.click(within(band).getByTestId('agent-file-band-less-uncommitted'));
        expect(within(band).getAllByTestId('agent-file-row')).toHaveLength(3);
        expect(within(band).getByTestId('agent-file-band-more-uncommitted')).toHaveTextContent('and 2 more');
    });

    it('leaves "and N more" as a plain count when no view owns expansion for the card', () => {
        const busy_tree: ActivityTree = {
            ...tree,
            uncommitted: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(path => ({ path, change: 'modified' as const })),
        };
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: busy_tree }] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-file-band-more-uncommitted').tagName).toBe('P');
    });

    it('says the uncommitted band is empty in one line rather than leaving it off the card, even with commits on the branch', () => {
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: { ...tree, uncommitted: [] } }] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-file-bands-empty')).toHaveTextContent('Nothing uncommitted');
        expect(screen.queryByTestId('agent-file-band-uncommitted')).not.toBeInTheDocument();
        expect(screen.queryByTestId('agent-commit-band')).not.toBeInTheDocument();
    });

    it('opens an uncommitted file as a diff from a real control, echoing back the root and path the host published', () => {
        const post = seedTree();
        const button = screen.getAllByTestId('agent-file-row-button')[0];
        expect(button.tagName).toBe('BUTTON');
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(post).toHaveBeenCalledWith({
            type: 'openActivityDiff',
            root_path: ROOT_PATH,
            path: 'client/extension/src/types/AgentActivity.ts',
            band: 'uncommitted',
        });
    });

    it('replaces its own reading with the host answer once a diff attempt has been refused', () => {
        seedTree();
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'activityUnavailable', request: 'diff', reason: 'not_listed', path: 'client/extension/src/types/AgentActivity.ts' },
            }));
        });
        const row = screen.getAllByTestId('agent-file-row')[0];
        expect(within(row).getByTestId('agent-file-no-diff')).toHaveTextContent('this file is no longer in the band');
    });
});

describe('AgentNote opens a session in VS Code, not on the card', () => {

    it('opens the session from a real control, echoing back the vendor and session id the host published', () => {
        const post = jest.fn();
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote({}, post)} />);
        const button = screen.getByTestId('agent-row-button');
        expect(button.tagName).toBe('BUTTON');
        expect(button).not.toHaveAttribute('aria-expanded');
        fireEvent.click(button);
        expect(post).toHaveBeenCalledWith({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' });
        expect(screen.queryByTestId('agent-drawer')).not.toBeInTheDocument();
    });

    it('says under the row why the host could not open a session, and on no other row', () => {
        seed({ sessions: [
            makeSessionState(makeSession({ session_id: 'grok-one', vendor: 'grok' })),
            makeSessionState(makeSession({ session_id: 'claude-two' })),
        ] });
        render(<AgentNote {...makeStoryNote()} />);
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'activityUnavailable', request: 'chat', reason: 'no_transcript', session_id: 'grok-one' },
            }));
        });
        const rows = screen.getAllByTestId('agent-row');
        expect(within(rows[0]).getByTestId('agent-open-refusal')).toHaveTextContent('grok left no transcript NoteThink has read for this session.');
        expect(within(rows[1]).queryByTestId('agent-open-refusal')).not.toBeInTheDocument();
    });
});

describe('AgentNote says plainly what it does not know', () => {

    it('waits rather than asserting an empty board before the host has said anything, with the detail on hover rather than repeated on the card', () => {
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveTextContent('Waiting for agent activity');
        expect(notice).toHaveAttribute('title', expect.stringContaining('Waiting for NoteThink to report'));
    });

    it('says the analyser cannot read local files here, rather than showing an idle board', () => {
        setActivitySnapshot({ analyser: { state: 'unavailable', reason: 'a web host with no local disk', refusals: [] }, sessions: [], trees: [] });
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveAttribute('data-analyser-state', 'unavailable');
        expect(notice).toHaveTextContent('Agent activity unavailable');
        expect(notice).toHaveAttribute('title', expect.stringContaining('cannot read local agent session files'));
        expect(notice).toHaveAttribute('title', expect.stringContaining('a web host with no local disk'));
    });

    it('says the analyser is still scanning, which is not the same as agents being quiet', () => {
        setActivitySnapshot({ analyser: { state: 'scanning', refusals: [] }, sessions: [], trees: [] });
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveTextContent('Scanning agent activity...');
        expect(notice).toHaveAttribute('title', expect.stringContaining('still scanning'));
    });

    it('says the analyser failed, and gives the reason on hover rather than as a paragraph on every card', () => {
        setActivitySnapshot({ analyser: { state: 'failed', reason: 'the worker crashed twice', refusals: [] }, sessions: [], trees: [] });
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveAttribute('data-analyser-state', 'failed');
        expect(notice).toHaveTextContent('Agent activity analyser failed');
        expect(notice).toHaveAttribute('title', expect.stringContaining('the worker crashed twice'));
    });

    it('draws a refused session file before any empty state, so a failed read never looks like an idle board', () => {
        seed({ analyser: { refusals: [{ file: 'grok events log', code: 'unsupported_version', reason: 'the file could not be decoded' }] } });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-banner-refusals')).toHaveTextContent('grok events log could not be read');
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveTextContent('No agent activity in 30 days');
        expect(notice).toHaveAttribute('title', expect.stringContaining('No agent has worked on this story'));
    });

    it('says how many sessions it could not fully read, rather than drawing the rest as the whole picture', () => {
        seed({
            sessions: [makeSessionState(makeSession())],
            analyser: { refusals: [{ file: 'a', code: 'unreadable', reason: 'r', session_id: 'a' }, { file: 'b', code: 'unreadable', reason: 'r', session_id: 'b' }] },
        });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-banner-unreadable')).toHaveTextContent('2 session(s) could not be fully read');
    });

    it('still binds a story carrying no authored id linetag, under the slug derived from its headline', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        // "### Agent activity card" derives the same slug as the authored id makeSession() binds under, so the session still shows rather than reading "no agent in 30 days"
        const { container } = render(<AgentNote {...makeStoryNote({ linetags: undefined })} />);
        expect(container.querySelector('[data-session-count="1"]')).toBeInTheDocument();
        expect(screen.getAllByTestId('agent-row')).toHaveLength(1);
        expect(screen.queryByTestId('agent-banner-notice')).not.toBeInTheDocument();
    });
});

describe('AgentNote on a virtual note', () => {

    it('draws the one session it was minted for, and never a story it did not declare', () => {
        const unbound = makeSessionState(makeSession({ session_id: 'claude-no-story', story_binding: 'none', stories: undefined, story_usage: undefined }));
        seed({ sessions: [makeSessionState(makeSession()), unbound] });
        const virtual = {
            ...makeVirtualNote({ namespace: AGENT_VIRTUAL_NAMESPACE, key: unboundSessionKey(unbound), headline: 'claude-code in notethink' }),
            seq: 9,
            display_options: { id: 'v1-n9' },
        };
        const { container } = render(<AgentNote {...virtual} />);
        expect(container.querySelector('[data-virtual-note="true"]')).toBeInTheDocument();
        expect(container.querySelector('[data-session-count="1"]')).toBeInTheDocument();
        expect(screen.getByText('claude-code in notethink')).toBeInTheDocument();
        expect(screen.queryByTestId('agent-banner-notice')).not.toBeInTheDocument();
    });
});

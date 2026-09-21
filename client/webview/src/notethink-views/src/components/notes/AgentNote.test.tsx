import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AgentNote from './AgentNote';
import { AGENT_VIRTUAL_NAMESPACE, unboundSessionKey, type ActivityProducerState, type ActivitySessionState, type ActivitySnapshot } from '../../lib/agentactivityops';
import { resetActivitySnapshot, setActivitySnapshot } from '../../lib/activityhooks';
import { makeVirtualNote } from '../../lib/virtualnoteops';
import type { ActivityDigest, ActivitySession, ActivityTree } from '../../types/AgentActivity';
import type { NoteProps } from '../../types/NoteProps';

const ROOT_PATH = '/mnt/workspace/in_development/notethink';
const ROOT_RELATIVE = 'notethink';
const TODO_PATH = `${ROOT_RELATIVE}/docstech/users/alex.stanhope/todo.md`;

function makeSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
    return {
        contract_version: '1.0.0',
        session_id: 'claude-bound-busy',
        vendor: 'claude-code',
        project: 'notethink',
        started_at: '2026-09-18T08:51:30Z',
        updated_at: '2026-09-18T09:14:01Z',
        state: 'working',
        story_binding: 'bound',
        story: { doc_path: 'docstech/users/alex.stanhope/todo.md', id: 'agent-activity-card' },
        capabilities: { live_tool_call: 'supported', question: 'supported', digest: 'supported', file_attribution: 'supported' },
        current: { at: '2026-09-18T09:14:01Z', kind: 'tool_call', tool: 'Edit', arg: 'client/extension/src/types/AgentActivity.ts' },
        ...overrides,
    };
}

function makeSessionState(session: ActivitySession, digest?: ActivityDigest): ActivitySessionState {
    return { root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, session, events: [], digest };
}

function makeProducer(overrides: Partial<ActivityProducerState> = {}): ActivityProducerState {
    return {
        root_path: ROOT_PATH,
        root_relative: ROOT_RELATIVE,
        project: 'notethink',
        producer: { name: 'example-activity-producer', version: '0.4.1' },
        written_at: '2026-09-18T09:14:02Z',
        heartbeat_seconds: 10,
        live: true,
        capabilities: { tree_state: 'supported', blob_base: 'supported' },
        declared_session_ids: ['claude-bound-busy'],
        unreadable_session_ids: [],
        refusals: [],
        ...overrides,
    };
}

function seed(overrides: Partial<ActivitySnapshot> & { producer?: Partial<ActivityProducerState> } = {}): void {
    const { producer, ...rest } = overrides;
    const snapshot: ActivitySnapshot = {
        contract_version: '1.0.0',
        producers: [makeProducer(producer)],
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

    it('draws no session on a card whose resolved path the binding does not match', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote({ origin: { doc_id: 'doc', doc_path: '/w/notegit/todo.md', relative_path: 'notegit/docstech/users/alex.stanhope/todo.md' } })} />);
        expect(screen.queryByTestId('agent-row')).not.toBeInTheDocument();
    });

    it('says a vendor cannot report what it is running, rather than drawing an empty live line', () => {
        seed({ sessions: [makeSessionState(makeSession({ current: undefined, state: 'unknown', capabilities: { digest: 'supported' } }))] });
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

    it('never lets a blank question band read as an agent that is not waiting on you', () => {
        seed({ sessions: [makeSessionState(makeSession({ state: 'unknown', vendor: 'codex', current: undefined, capabilities: { digest: 'supported', question: 'unsupported' } }))] });
        render(<AgentNote {...makeStoryNote()} />);
        const band = screen.getByTestId('agent-question-band');
        expect(band).toHaveAttribute('data-fact', 'unsupported');
        expect(band).toHaveTextContent('codex cannot report whether it is waiting on you');
    });

    it('draws no question band at all for an agent whose producer reports questions and has none pending', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.queryByTestId('agent-question-band')).not.toBeInTheDocument();
    });

    it('draws a refusal naming a session on that session own row', () => {
        seed({
            sessions: [makeSessionState(makeSession())],
            producer: { refusals: [{ file: 'sessions/claude-bound-busy.digest.json', code: 'too_large', reason: 'the digest is over its bound', session_id: 'claude-bound-busy' }] },
        });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-row-refusals')).toHaveTextContent('sessions/claude-bound-busy.digest.json could not be read');
        expect(screen.queryByTestId('agent-banner-refusals')).not.toBeInTheDocument();
    });
});

describe('AgentNote file bands', () => {

    const tree: ActivityTree = {
        contract_version: '1.0.0',
        generated_at: '2026-09-18T09:14:02Z',
        branch: 'staging',
        head_commit: 'ef11de8',
        uncommitted: [
            { path: 'client/extension/src/types/AgentActivity.ts', change: 'added', session_id: 'claude-bound-busy' },
            { path: 'media/board-icon.png', change: 'modified', session_id: 'claude-bound-busy', omitted: 'binary' },
            { path: 'package.json', change: 'modified', base_blob: 'blobs/abc.json' },
        ],
        committed: [],
    };

    function seedTree(postMessage?: jest.Mock): jest.Mock {
        const post = postMessage ?? jest.fn();
        seed({ sessions: [makeSessionState(makeSession())], trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree }] });
        render(<AgentNote {...makeStoryNote({}, post)} />);
        return post;
    }

    it('lists an attributed file under its vendor and an unattributed one as unattributed', () => {
        seedTree();
        const rows = screen.getAllByTestId('agent-file-row');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveAttribute('data-attributed', 'true');
        expect(within(rows[0]).getByTestId('agent-file-attribution')).toHaveTextContent('CC');
        expect(rows[2]).toHaveAttribute('data-attributed', 'false');
        expect(within(rows[2]).getByTestId('agent-file-attribution')).toHaveTextContent('unattributed');
    });

    it('says a band is empty rather than leaving it off the card', () => {
        seedTree();
        expect(screen.getByTestId('agent-file-band-empty-committed')).toHaveTextContent('Nothing committed on this branch');
    });

    it('opens a file as a diff from a real control, echoing back the root and path the host published', () => {
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

    it('offers no diff, and says why, for a side the producer did not store', () => {
        const post = seedTree();
        const row = screen.getAllByTestId('agent-file-row')[1];
        expect(within(row).getByTestId('agent-file-row-button')).toBeDisabled();
        expect(within(row).getByTestId('agent-file-no-diff')).toHaveTextContent('the earlier side is binary and was not stored');
        expect(post).not.toHaveBeenCalled();
    });

    it('replaces its own reading with the host answer once an attempt has been refused', () => {
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

describe('AgentNote drawer', () => {

    const digest: ActivityDigest = {
        contract_version: '1.0.0',
        session_id: 'claude-bound-busy',
        generated_at: '2026-09-18T09:14:02Z',
        messages: { kept: 2, dropped: 47, items: [
            { at: '2026-09-18T09:12:10Z', role: 'user', text: 'carry on with the contract' },
            { at: '2026-09-18T09:12:44Z', role: 'assistant', text: 'Writing the types now.' },
        ] },
        tool_calls: { kept: 1, dropped: 0, items: [{ at: '2026-09-18T09:14:01Z', tool: 'Edit', arg: 'AgentActivity.ts', outcome: 'ok' }] },
        facts: { model: 'an example model name', turns: '23' },
    };

    it('opens the conversation in a drawer rather than on the card, from a real control', () => {
        seed({ sessions: [makeSessionState(makeSession(), digest)] });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-drawer')).toHaveAttribute('data-open', 'false');
        const button = screen.getByTestId('agent-row-button');
        expect(button.tagName).toBe('BUTTON');
        expect(button).toHaveAttribute('aria-controls', screen.getByTestId('agent-drawer').id);
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('agent-drawer')).toHaveAttribute('data-open', 'true');
        expect(screen.getByTestId('agent-drawer-messages')).toHaveTextContent('carry on with the contract');
        expect(screen.getByTestId('agent-drawer-facts')).toHaveTextContent('an example model name');
    });

    it('states the digest window, so a bounded list never reads as a complete one', () => {
        seed({ sessions: [makeSessionState(makeSession(), digest)] });
        render(<AgentNote {...makeStoryNote()} />);
        fireEvent.click(screen.getByTestId('agent-row-button'));
        expect(screen.getByTestId('agent-drawer-message-window')).toHaveTextContent('Last 2 of 49');
        expect(screen.getByTestId('agent-drawer-tool-window')).toHaveTextContent('All 1');
    });

    it('says why there is no conversation, separating a vendor that writes no digest from one that has not yet', () => {
        seed({ sessions: [makeSessionState(makeSession({ capabilities: { live_tool_call: 'supported', question: 'supported', digest: 'unsupported' } }))] });
        render(<AgentNote {...makeStoryNote()} />);
        fireEvent.click(screen.getByTestId('agent-row-button'));
        expect(screen.getByTestId('agent-drawer-empty')).toHaveTextContent('claude-code writes no digest for this session');
        act(() => { resetActivitySnapshot(); seed({ sessions: [makeSessionState(makeSession())] }); });
        render(<AgentNote {...makeStoryNote()} />);
        fireEvent.click(screen.getAllByTestId('agent-row-button')[1]);
        expect(screen.getAllByTestId('agent-drawer-empty')[1]).toHaveTextContent('No digest has been written for this session yet');
    });

    it('offers the vendor handover without claiming an outcome it cannot confirm', () => {
        const post = jest.fn();
        seed({ sessions: [makeSessionState(makeSession(), digest)] });
        render(<AgentNote {...makeStoryNote({}, post)} />);
        fireEvent.click(screen.getByTestId('agent-row-button'));
        const handover = screen.getByTestId('agent-open-chat');
        expect(handover).toHaveTextContent('Open in claude-code');
        expect(screen.getByTestId('agent-open-chat-note')).toHaveTextContent('cannot tell whether it found the conversation');
        fireEvent.click(handover);
        expect(post).toHaveBeenCalledWith({ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' });
        // the digest is still on screen, so a reader who lands on an empty vendor tab is not stranded
        expect(screen.getByTestId('agent-drawer-messages')).toHaveTextContent('carry on with the contract');
    });

    it('says why a handover did not happen, and keeps the conversation where it is', () => {
        seed({ sessions: [makeSessionState(makeSession({ vendor: 'codex' }), digest)] });
        render(<AgentNote {...makeStoryNote()} />);
        fireEvent.click(screen.getByTestId('agent-row-button'));
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'activityUnavailable', request: 'chat', reason: 'no_chat_panel', session_id: 'claude-bound-busy' },
            }));
        });
        expect(screen.getByTestId('agent-open-chat-note')).toHaveTextContent('codex has no chat panel in VS Code');
        expect(screen.getByTestId('agent-drawer-messages')).toHaveTextContent('carry on with the contract');
    });
});

describe('AgentNote says plainly what it does not know', () => {

    it('waits rather than asserting an empty board before the host has said anything', () => {
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-banner-notice')).toHaveTextContent('Waiting for NoteThink to report');
    });

    it('says no producer is writing, and where a producer has to write, rather than showing an idle board', () => {
        setActivitySnapshot({ contract_version: '1.0.0', producers: [], sessions: [], trees: [] });
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveAttribute('data-producer-state', 'absent');
        expect(notice).toHaveTextContent('No producer is writing agent activity');
        expect(notice).toHaveTextContent('.notethink');
    });

    it('says a producer has stopped, which is not the same as agents being quiet', () => {
        seed({ sessions: [makeSessionState(makeSession())], producer: { live: false } });
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveAttribute('data-producer-state', 'stopped');
        expect(notice).toHaveTextContent('example-activity-producer has stopped writing');
    });

    it('separates a contract directory whose manifest could not be read from one that stopped', () => {
        seed({ producer: { live: false, producer: undefined } });
        render(<AgentNote {...makeStoryNote()} />);
        const notice = screen.getByTestId('agent-banner-notice');
        expect(notice).toHaveAttribute('data-producer-state', 'unreadable');
        expect(notice).toHaveTextContent('could not be read');
    });

    it('draws a refused contract file before any empty state, so a failed read never looks like an idle board', () => {
        seed({ producer: { refusals: [{ file: 'tree.json', code: 'unsupported_version', reason: 'contract_version 2.0.0 is a major this build cannot read' }] } });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-banner-refusals')).toHaveTextContent('tree.json could not be read');
        expect(screen.getByTestId('agent-banner-notice')).toHaveTextContent('No agent has declared this story');
    });

    it('says how many declared sessions it could not read, rather than drawing the rest as the whole picture', () => {
        seed({
            sessions: [makeSessionState(makeSession())],
            producer: { declared_session_ids: ['claude-bound-busy', 'a', 'b'], unreadable_session_ids: ['a', 'b'] },
        });
        render(<AgentNote {...makeStoryNote()} />);
        expect(screen.getByTestId('agent-banner-unreadable')).toHaveTextContent('2 of the 3 sessions this producer declares could not be read');
    });

    it('says a story carrying no id linetag cannot be declared at all, rather than reporting it quiet', () => {
        seed({ sessions: [makeSessionState(makeSession())] });
        render(<AgentNote {...makeStoryNote({ linetags: undefined })} />);
        expect(screen.getByTestId('agent-banner-notice')).toHaveTextContent('carries no id linetag');
    });
});

describe('AgentNote on a virtual note', () => {

    it('draws the one session it was minted for, and never a story it did not declare', () => {
        const unbound = makeSessionState(makeSession({ session_id: 'claude-no-story', story_binding: 'none', story: undefined }));
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

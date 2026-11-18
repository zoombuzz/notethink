import {
    convoyCountLabel,
    coordinatorResultMessage,
    coordinatorStateLabel,
    coordinatorsInScope,
    hasBoardFiles,
    parseCoordinatorResult,
    registryVendorName,
    COORDINATOR_VENDOR_OPTIONS,
} from './coordinatorops';
import type { ActivityCoordinator } from '../types/AgentActivity';

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'idle', story: '', machine: 'host-a', open_convoys: [], root_relative: 'demo',
        board_doc_path: 'demo/docstech/users/dev/todo.md',
        board_stories: [{ id: 'alpha', title: 'Alpha story', status: '', convoys: [], operator_steps: [] }, { id: 'beta', title: 'Beta story', status: '', convoys: [], operator_steps: [] }],
        ...overrides,
    };
}

describe('which coordinators a folder view lists', () => {
    it('sees a story board among the loaded files', () => {
        expect(hasBoardFiles(['demo/docstech/users/dev/todo.md'])).toBe(true);
        expect(hasBoardFiles(['docstech/users/dev/todo.md'])).toBe(true);
        expect(hasBoardFiles(['demo/docstech/users/dev/done.md', 'demo/README.md'])).toBe(false);
        expect(hasBoardFiles(undefined)).toBe(false);
    });

    it('lists the agent of every repository that holds a loaded file, and no other', () => {
        const rows = [coordinator(), coordinator({ agent: 'coord-other', root_relative: 'other' }), coordinator({ agent: 'coord-third', root_relative: 'dem' })];
        expect(coordinatorsInScope(rows, ['demo/README.md']).map(row => row.agent)).toEqual(['coord-demo']);
        expect(coordinatorsInScope(rows, ['demo/a.md', 'other/b.md']).map(row => row.agent)).toEqual(['coord-demo', 'coord-other']);
        expect(coordinatorsInScope(rows, [])).toEqual([]);
    });

    it('lists a repository that is the workspace folder itself whenever anything is loaded', () => {
        expect(coordinatorsInScope([coordinator({ root_relative: '' })], ['notes.md'])).toHaveLength(1);
        expect(coordinatorsInScope([coordinator({ root_relative: '' })], undefined)).toEqual([]);
    });
});

describe('the words a row uses', () => {
    it('names each state, and an unknown one plainly', () => {
        expect(coordinatorStateLabel('working')).toBe('Working');
        expect(coordinatorStateLabel('waiting')).toBe('Waiting on you');
        expect(coordinatorStateLabel('idle')).toBe('Idle');
        expect(coordinatorStateLabel('stopped')).toBe('Stopped');
        expect(coordinatorStateLabel('hibernating')).toBe('State not reported');
    });

    it('counts convoys in the singular and the plural', () => {
        expect(convoyCountLabel(1)).toBe('1 open convoy');
        expect(convoyCountLabel(3)).toBe('3 open convoys');
    });

    it('answers each outcome', () => {
        const send = (code: string): string => coordinatorResultMessage({ request: 'send', agent: 'coord-demo', code, ok: code === 'sent' });
        expect(send('sent')).toBe('Sent to coord-demo.');
        expect(send('write_failed')).toBe('The message could not be written.');
        expect(send('bad_message')).toBe('Write a message first.');
    });

    it('reads a coordinator result message, and nothing else', () => {
        expect(parseCoordinatorResult({ type: 'coordinatorResult', request: 'send', agent: 'coord-demo', code: 'sent', ok: true })).toEqual({ request: 'send', agent: 'coord-demo', code: 'sent', ok: true });
        expect(parseCoordinatorResult({ type: 'coordinatorResult', request: 'other', agent: 'x', code: 'sent' })).toBeUndefined();
        expect(parseCoordinatorResult({ type: 'coordinatorResult', request: 'move', agent: 'x', code: 'moved' })).toBeUndefined();
        expect(parseCoordinatorResult({ type: 'activity' })).toBeUndefined();
        expect(parseCoordinatorResult(null)).toBeUndefined();
    });

    it('answers a vendor change in its own words', () => {
        const vendor = (code: string): string => coordinatorResultMessage({ request: 'vendor', agent: 'coord-demo', code, ok: code === 'sent' });
        expect(vendor('sent')).toBe('Asked coord-demo to change vendor.');
        expect(vendor('bad_vendor')).toBe('That is not a vendor a coordinator can change to.');
        expect(vendor('no_mailbox')).toBe('The agent has no mailbox yet.');
        expect(vendor('write_failed')).toBe('The vendor change could not be sent.');
        expect(parseCoordinatorResult({ type: 'coordinatorResult', request: 'vendor', agent: 'coord-demo', code: 'sent', ok: true })).toEqual({ request: 'vendor', agent: 'coord-demo', code: 'sent', ok: true });
    });

    it('spells each display vendor as thinkersync does, and offers every vendor the display table knows', () => {
        expect(registryVendorName('claude-code')).toBe('claude');
        expect(registryVendorName('antigravity')).toBe('agy');
        expect(registryVendorName('codex')).toBe('codex');
        expect(registryVendorName('grok')).toBe('grok');
        expect(COORDINATOR_VENDOR_OPTIONS).toEqual(['claude-code', 'codex', 'grok', 'antigravity']);
    });
});

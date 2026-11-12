import {
    convoyCountLabel,
    coordinatorResultMessage,
    coordinatorStateLabel,
    coordinatorsInScope,
    hasBoardFiles,
    parseCoordinatorResult,
    targetPositionFromKey,
    targetPositionFromPointer,
    targetValueText,
} from './coordinatorops';
import type { ActivityCoordinator } from '../types/AgentActivity';

function coordinator(overrides: Partial<ActivityCoordinator> = {}): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'idle', story: '', version: '', machine: 'host-a', open_convoys: [], root_relative: 'demo',
        board_doc_path: 'demo/docstech/users/dev/todo.md',
        board_stories: [{ id: 'alpha', title: 'Alpha story', status: '', convoys: [], operator_steps: [] }, { id: 'beta', title: 'Beta story', status: '', convoys: [], operator_steps: [] }],
        marker_after: 0,
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

describe('moving the target line', () => {
    it('reads the position a pointer is at as how many story middles are above it', () => {
        const middles = [10, 30, 50];
        expect(targetPositionFromPointer(middles, 0)).toBe(0);
        expect(targetPositionFromPointer(middles, 20)).toBe(1);
        expect(targetPositionFromPointer(middles, 35)).toBe(2);
        expect(targetPositionFromPointer(middles, 500)).toBe(3);
    });

    it('moves one story with Up and Down, to the ends with Home and End, and stays inside the board', () => {
        expect(targetPositionFromKey('ArrowDown', 1, 3)).toBe(2);
        expect(targetPositionFromKey('ArrowDown', 3, 3)).toBe(3);
        expect(targetPositionFromKey('ArrowUp', 1, 3)).toBe(0);
        expect(targetPositionFromKey('ArrowUp', 0, 3)).toBe(0);
        expect(targetPositionFromKey('Home', 2, 3)).toBe(0);
        expect(targetPositionFromKey('End', 0, 3)).toBe(3);
        expect(targetPositionFromKey('Enter', 1, 3)).toBeUndefined();
    });

    it('says where the line is, or that it is off the board', () => {
        expect(targetValueText(coordinator(), 2)).toBe('After Beta story');
        expect(targetValueText(coordinator(), 0)).toBe('No target line: nothing is set to run');
    });
});

describe('the words a row uses', () => {
    it('names each registry state, and an unknown one plainly', () => {
        expect(coordinatorStateLabel('working')).toBe('Working');
        expect(coordinatorStateLabel('starting')).toBe('Starting');
        expect(coordinatorStateLabel('recycling')).toBe('Recycling');
        expect(coordinatorStateLabel('stopped')).toBe('Stopped');
        expect(coordinatorStateLabel('hibernating')).toBe('State not reported');
    });

    it('counts convoys in the singular and the plural', () => {
        expect(convoyCountLabel(1)).toBe('1 open convoy');
        expect(convoyCountLabel(3)).toBe('3 open convoys');
    });

    it('answers each outcome, and says nothing for a marker that moved', () => {
        const send = (code: string): string | undefined => coordinatorResultMessage({ request: 'send', agent: 'coord-demo', code, ok: code === 'sent' });
        const move = (code: string): string | undefined => coordinatorResultMessage({ request: 'move', agent: 'coord-demo', code, ok: code === 'moved' });
        expect(send('sent')).toBe('Sent to coord-demo.');
        expect(send('write_failed')).toBe('The message could not be written.');
        expect(send('bad_message')).toBe('Write a message first.');
        expect(move('moved')).toBeUndefined();
        expect(move('write_failed')).toBe('The board could not be changed.');
        expect(move('moved_unsaved')).toContain('not saved yet');
        expect(move('no_board')).toBe('This agent has no board here.');
    });

    it('reads a coordinator result message, and nothing else', () => {
        expect(parseCoordinatorResult({ type: 'coordinatorResult', request: 'send', agent: 'coord-demo', code: 'sent', ok: true })).toEqual({ request: 'send', agent: 'coord-demo', code: 'sent', ok: true });
        expect(parseCoordinatorResult({ type: 'coordinatorResult', request: 'other', agent: 'x', code: 'sent' })).toBeUndefined();
        expect(parseCoordinatorResult({ type: 'activity' })).toBeUndefined();
        expect(parseCoordinatorResult(null)).toBeUndefined();
    });
});

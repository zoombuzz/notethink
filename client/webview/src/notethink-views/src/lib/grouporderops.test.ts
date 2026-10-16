import {
    GROUP_ORDER_DEFAULT,
    GROUP_ORDERS,
    groupOrderLabel,
    isGroupOrderMode,
    orderGroupValues,
    resolveGroupOrderMode,
    type NoteTimestampFn,
} from './grouporderops';
import type { GroupDisplayEntry } from '../types/Messages';
import type { NoteProps } from '../types/NoteProps';

// a plain note -> ms function, standing in for what a card type supplies in production (see cardregistryops.test.ts)
const NO_TIMESTAMPS: NoteTimestampFn = () => undefined;

function makeStoryNote(id: string, status: string, file_mtime?: number): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: `### Story [](?id=${id})`,
        body_raw: '',
        linetags: {
            id: { key: 'id', value: id, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 },
            status: { key: 'status', value: status, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 },
        },
        origin: { doc_id: 'x', doc_path: '/workspace/todo.md', relative_path: 'todo.md', file_mtime },
    };
}

// reads the timestamp the way the default card type's own rule does (cardregistryops.ts's fileChangedOrderTimestamp)
const byFileMtime: NoteTimestampFn = note => note.origin?.file_mtime;

describe('groupOrderLabel / isGroupOrderMode / resolveGroupOrderMode', () => {

    it('names every mode, and resolveGroupOrderMode falls back to custom for anything else', () => {
        for (const mode of GROUP_ORDERS) { expect(groupOrderLabel(mode).length).toBeGreaterThan(0); }
        expect(isGroupOrderMode('cardCount')).toBe(true);
        expect(isGroupOrderMode('nonsense')).toBe(false);
        expect(resolveGroupOrderMode('cardCount')).toBe('cardCount');
        expect(resolveGroupOrderMode(undefined)).toBe(GROUP_ORDER_DEFAULT);
        expect(resolveGroupOrderMode('nonsense')).toBe(GROUP_ORDER_DEFAULT);
    });

});

describe('orderGroupValues: custom', () => {

    it('reproduces the saved order, then appends an unsaved group alphabetically, untagged last', () => {
        const saved: GroupDisplayEntry[] = [{ value: 'done', shown: true }, { value: 'doing', shown: true }];
        const order = orderGroupValues(['doing', 'done', 'testing', 'untagged'], [], 'status', 'custom', saved, NO_TIMESTAMPS);
        expect(order).toEqual(['done', 'doing', 'testing', 'untagged']);
    });

    it('with no saved order at all, falls back to alphabetical with untagged last', () => {
        const order = orderGroupValues(['done', 'doing', 'untagged'], [], 'status', 'custom', [], NO_TIMESTAMPS);
        expect(order).toEqual(['doing', 'done', 'untagged']);
    });

});

describe('orderGroupValues: alphabetical', () => {

    it('ignores the saved order entirely, untagged always last', () => {
        const saved: GroupDisplayEntry[] = [{ value: 'untagged', shown: true }, { value: 'done', shown: true }, { value: 'doing', shown: true }];
        const order = orderGroupValues(['doing', 'done', 'untagged'], [], 'status', 'alphabetical', saved, NO_TIMESTAMPS);
        expect(order).toEqual(['doing', 'done', 'untagged']);
    });

});

describe('orderGroupValues: cardCount', () => {

    it('orders by card count descending, ties broken alphabetically, untagged last however many cards it holds', () => {
        const notes = [
            makeStoryNote('a', 'doing'), makeStoryNote('b', 'doing'),
            makeStoryNote('c', 'done'),
            makeStoryNote('d', 'testing'), makeStoryNote('e', 'testing'),
            makeStoryNote('f', 'untagged'), makeStoryNote('g', 'untagged'), makeStoryNote('h', 'untagged'),
        ];
        const order = orderGroupValues(['doing', 'done', 'testing', 'untagged'], notes, 'status', 'cardCount', [], NO_TIMESTAMPS);
        expect(order).toEqual(['doing', 'testing', 'done', 'untagged']);
    });

});

describe('orderGroupValues: newestLast', () => {

    it('orders groups with no timestamp first, alphabetically, then groups with one, oldest to newest, untagged always last', () => {
        const older_ms = Date.parse('2026-10-01T00:00:00Z');
        const newer_ms = Date.parse('2026-10-05T00:00:00Z');
        const notes = [
            makeStoryNote('older', 'doing', older_ms),
            makeStoryNote('newer', 'done', newer_ms),
            makeStoryNote('quiet-z', 'testing'),
            makeStoryNote('quiet-a', 'untagged'),
        ];
        const order = orderGroupValues(['doing', 'done', 'testing', 'untagged'], notes, 'status', 'newestLast', [], byFileMtime);
        expect(order).toEqual(['testing', 'doing', 'done', 'untagged']);
    });

    it('with no timestamp anywhere, every named group falls back to alphabetical, untagged last', () => {
        const notes = [makeStoryNote('x', 'doing'), makeStoryNote('y', 'done')];
        const order = orderGroupValues(['doing', 'done'], notes, 'status', 'newestLast', [], byFileMtime);
        expect(order).toEqual(['doing', 'done']);
    });

    it('a tie in group timestamp keeps the groups in their original relative order (a stable sort)', () => {
        const tied_ms = Date.parse('2026-10-05T00:00:00Z');
        const notes = [makeStoryNote('a', 'alpha', tied_ms), makeStoryNote('b', 'beta', tied_ms)];
        const order = orderGroupValues(['alpha', 'beta'], notes, 'status', 'newestLast', [], byFileMtime);
        expect(order).toEqual(['alpha', 'beta']);
    });

    it("a card type that declares no ordering attribute of its own still orders by file_mtime, the default card's rule", () => {
        // the same fixture and expectation as the main case: byFileMtime stands in for ANY card type that falls through to it
        const older_ms = Date.parse('2026-10-01T00:00:00Z');
        const newer_ms = Date.parse('2026-10-05T00:00:00Z');
        const notes = [makeStoryNote('older', 'doing', older_ms), makeStoryNote('newer', 'done', newer_ms)];
        const order = orderGroupValues(['doing', 'done'], notes, 'status', 'newestLast', [], byFileMtime);
        expect(order).toEqual(['doing', 'done']);
    });

});

describe('orderGroupValues: newestFirst', () => {

    it('orders groups with a timestamp newest first, groups with none follow alphabetically, untagged always last', () => {
        const older_ms = Date.parse('2026-10-01T00:00:00Z');
        const newer_ms = Date.parse('2026-10-05T00:00:00Z');
        const notes = [
            makeStoryNote('older', 'doing', older_ms),
            makeStoryNote('newer', 'done', newer_ms),
            makeStoryNote('quiet-z', 'testing'),
            makeStoryNote('quiet-a', 'untagged'),
        ];
        const order = orderGroupValues(['doing', 'done', 'testing', 'untagged'], notes, 'status', 'newestFirst', [], byFileMtime);
        expect(order).toEqual(['done', 'doing', 'testing', 'untagged']);
    });

    it('with no timestamp anywhere, every named group falls back to alphabetical, untagged last', () => {
        const notes = [makeStoryNote('x', 'doing'), makeStoryNote('y', 'done')];
        const order = orderGroupValues(['doing', 'done'], notes, 'status', 'newestFirst', [], byFileMtime);
        expect(order).toEqual(['doing', 'done']);
    });

    it('a tie in group timestamp keeps the groups in their original relative order (a stable sort)', () => {
        const tied_ms = Date.parse('2026-10-05T00:00:00Z');
        const notes = [makeStoryNote('a', 'alpha', tied_ms), makeStoryNote('b', 'beta', tied_ms)];
        const order = orderGroupValues(['alpha', 'beta'], notes, 'status', 'newestFirst', [], byFileMtime);
        expect(order).toEqual(['alpha', 'beta']);
    });

});

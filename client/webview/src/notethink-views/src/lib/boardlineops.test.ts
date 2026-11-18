import { boardLineSlots, boardLineSlotsForNotes, hasAnyBoardLine, hasBoardStories, storyKeysForNotes } from './boardlineops';
import type { ActivityCoordinator } from '../types/AgentActivity';
import type { NoteProps } from '../types/NoteProps';

const BOARD_PATH = 'demo/docstech/users/dev/todo.md';

function coordinator(build_after: number, ship_after: number, ids = ['a', 'b', 'c', 'd', 'e']): ActivityCoordinator {
    return {
        agent: 'coord-demo', vendor: 'claude-code', state: 'working', story: '', version: '', machine: 'host-a', open_convoys: [],
        root_relative: 'demo', board_doc_path: BOARD_PATH,
        board_stories: ids.map(id => ({ id, title: id, status: '', convoys: [], operator_steps: [] })),
        marker_after: 0, build_after, ship_after,
    };
}

function keys(...ids: string[]): Array<{ doc_path: string; id: string }> {
    return ids.map(id => ({ doc_path: BOARD_PATH, id }));
}

describe('boardLineSlots', () => {
    it('places a line after the last card at or above it', () => {
        const slots = boardLineSlots(keys('a', 'b', 'c', 'd', 'e'), [coordinator(2, 4)]);
        expect(slots[2]).toEqual(['build']);
        expect(slots[4]).toEqual(['ship']);
        expect(slots.flat()).toHaveLength(2);
    });

    it('stacks both lines in one slot, build first, when they fall at the same position', () => {
        const slots = boardLineSlots(keys('a', 'b', 'c'), [coordinator(2, 2)]);
        expect(slots[2]).toEqual(['build', 'ship']);
    });

    it('draws a line last in a group whose cards all sit above it', () => {
        const slots = boardLineSlots(keys('a', 'b'), [coordinator(4, 0)]);
        expect(slots[2]).toEqual(['build']);
    });

    it('draws a line first in a group whose cards all sit below it', () => {
        const slots = boardLineSlots(keys('d', 'e'), [coordinator(2, 0)]);
        expect(slots[0]).toEqual(['build']);
    });

    it('draws nothing in an empty group and nothing for a line that marks no story', () => {
        expect(hasAnyBoardLine(boardLineSlots([], [coordinator(2, 2)]))).toBe(false);
        expect(hasAnyBoardLine(boardLineSlots(keys('a', 'b'), [coordinator(0, 0)]))).toBe(false);
    });

    it('draws nothing when the cards are not in board order', () => {
        expect(hasAnyBoardLine(boardLineSlots(keys('c', 'a', 'b'), [coordinator(2, 3)]))).toBe(false);
    });

    it('steps over cards that are not stories of the board and places by the story cards', () => {
        const mixed = [undefined, ...keys('a'), { doc_path: 'other/todo.md', id: 'zzz' }, ...keys('b', 'c')];
        const slots = boardLineSlots(mixed, [coordinator(2, 0)]);
        expect(slots[4]).toEqual(['build']);
    });

    it('draws nothing for a view showing no story of the coordinator board', () => {
        expect(hasAnyBoardLine(boardLineSlots([{ doc_path: 'other/todo.md', id: 'a' }], [coordinator(2, 2)]))).toBe(false);
        expect(hasAnyBoardLine(boardLineSlots(keys('a'), []))).toBe(false);
    });

    it('reads a coordinator row from before the lines existed as having none', () => {
        const old = { ...coordinator(0, 0) } as Partial<ActivityCoordinator>;
        delete old.build_after;
        delete old.ship_after;
        expect(hasAnyBoardLine(boardLineSlots(keys('a', 'b'), [old as ActivityCoordinator]))).toBe(false);
    });

    it('matches a document path spelled with a leading dot-slash', () => {
        const slots = boardLineSlots([{ doc_path: `./${BOARD_PATH}`, id: 'a' }, { doc_path: BOARD_PATH, id: 'b' }], [coordinator(1, 0)]);
        expect(slots[1]).toEqual(['build']);
    });

    it('uses the first coordinator whose board holds a card when the view mixes boards', () => {
        const other = { ...coordinator(1, 1), agent: 'coord-other', board_doc_path: 'other/todo.md' };
        const slots = boardLineSlots([{ doc_path: 'other/todo.md', id: 'a' }, ...keys('b')], [coordinator(2, 2), other]);
        expect(slots[2]).toEqual(['build', 'ship']);
        expect(slots[0]).toEqual([]);
    });
});

function story(title: string, fields: Partial<NoteProps> = {}): NoteProps {
    return { seq: 1, type: 'heading', level: 3, headline_raw: title, origin: { relative_path: BOARD_PATH }, ...fields } as unknown as NoteProps;
}

describe('story notes', () => {
    it('keys each heading by its board path and slug and leaves other notes keyless', () => {
        const notes = [story('Alpha story'), { ...story('Para'), type: 'paragraph' } as unknown as NoteProps];
        expect(storyKeysForNotes(notes)).toEqual([{ doc_path: BOARD_PATH, id: 'alpha-story' }, undefined]);
    });

    it('draws the lines among notes through their story ids', () => {
        const notes = [story('A', { seq: 1 }), story('B', { seq: 2 }), story('C', { seq: 3 })];
        const slots = boardLineSlotsForNotes(notes, [coordinator(2, 0, ['a', 'b', 'c'])]);
        expect(slots[2]).toEqual(['build']);
    });

    it('asks for activity only where a story of a board file is shown', () => {
        expect(hasBoardStories([story('A')])).toBe(true);
        expect(hasBoardStories([story('A', { origin: { relative_path: 'notes/readme.md' } } as Partial<NoteProps>)])).toBe(false);
        expect(hasBoardStories([{ ...story('A'), type: 'paragraph' } as unknown as NoteProps])).toBe(false);
        expect(hasBoardStories([])).toBe(false);
    });
});

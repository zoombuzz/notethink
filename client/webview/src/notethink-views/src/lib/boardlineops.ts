import { normaliseActivityPath, storyKeyForNote, type ActivityStoryKey } from "./agentactivityops";
import { hasBoardFiles } from "./coordinatorops";
import { isStoryNote } from "./progressops";
import type { ActivityBoardLines } from "../types/AgentActivity";
import type { NoteProps } from "../types/NoteProps";

/**
 * The build and ship lines across a view of a board's stories: the pure half. The build line marks the
 * last story the coordinator will build if left to run (drawn at the top of the group, as the idle line,
 * when there is none), and the ship line the end of the unbroken run of stories from the top of the board
 * that have passed the release gate (not drawn when the first story has not). Both belong to the view, not to a card, so this module answers one question for any
 * view: given the stories it shows in order, which lines are drawn before each of them and after the last.
 *
 * The host computes each board file's lines from the board itself and sends them as a count of the
 * board's stories at or above each line (`build_after`, `ship_after`) beside the board's story ids, and a
 * story is placed on the board by its document path and id. A view that has been sorted away from board
 * order, or that shows no story of a listed board, draws nothing, because position there says nothing
 * about the board.
 */

export const BOARD_LINE_KINDS = ['build', 'ship'] as const;
export type BoardLineKind = typeof BOARD_LINE_KINDS[number];

/**
 * What a drawn line says: the two kinds, or `idle`, the solid line at the top of a group when the
 * board has nothing for its coordinator to build. It is drawn as the build line, with words of its own.
 */
export type BoardLineMark = BoardLineKind | 'idle';

/** the line slots for a list of cards: slot `i` holds the lines drawn before card `i`, and the last slot those after the final card */
export type BoardLineSlots = BoardLineMark[][];

/** how many stories sit at or above a line, 0 when the board has none to mark */
function linePosition(board: ActivityBoardLines, kind: BoardLineKind): number {
    const position = kind === 'build' ? board.build_after : board.ship_after;
    return typeof position === 'number' && Number.isFinite(position) ? position : 0;
}

/**
 * The board index of each key on a board, -1 for a key on another board or not a story of it. Stories
 * sharing one id are told apart by order: the first card carrying the id takes the board's first story with
 * it, the next card its next, and a card beyond the board's last one takes the last, so a repeated id
 * neither breaks the board order nor loses the lines.
 */
function boardIndices(board: ActivityBoardLines, keys: ReadonlyArray<ActivityStoryKey | undefined>): number[] {
    const taken = new Map<string, number>();
    return keys.map(key => {
        if (!key || !board.doc_path || normaliseActivityPath(board.doc_path) !== normaliseActivityPath(key.doc_path)) { return -1; }
        const occurrences: number[] = [];
        board.story_ids.forEach((id, index) => { if (id === key.id) { occurrences.push(index); } });
        if (occurrences.length === 0) { return -1; }
        const used = taken.get(key.id) ?? 0;
        taken.set(key.id, used + 1);
        return occurrences[Math.min(used, occurrences.length - 1)];
    });
}

/**
 * The lines to draw among a list of cards, as slots (see BoardLineSlots), empty throughout when none
 * applies. The board is the first one that holds one of the cards; cards that are not stories
 * of that board are stepped over. Lines are drawn only when the board's stories appear in board order:
 * otherwise position says nothing, and nothing is drawn.
 *
 * A line with `n` stories at or above it falls after the last card whose board index is below `n`. When
 * every card sits below it, it falls before the first story card (a group whose cards all sit below the
 * line draws it first), and when every card sits above it, after the last (so it draws last). A ship
 * line that marks no story is not drawn. A build line the host reports as 0 is drawn as `idle` before the first
 * story card of the group, because a board with nothing to build is where a coordinator has room.
 */
export function boardLineSlots(keys: ReadonlyArray<ActivityStoryKey | undefined>, boards: ReadonlyArray<ActivityBoardLines>): BoardLineSlots {
    const slots: BoardLineSlots = Array.from({ length: keys.length + 1 }, () => []);
    for (const board of boards) {
        const indices = boardIndices(board, keys);
        const placed = indices.map((board_index, position) => ({ board_index, position })).filter(entry => entry.board_index >= 0);
        if (placed.length === 0) { continue; }
        if (placed.some((entry, i) => i > 0 && entry.board_index < placed[i - 1].board_index)) { return slots; }
        for (const kind of BOARD_LINE_KINDS) {
            const after = linePosition(board, kind);
            if (after <= 0) {
                if (kind === 'build' && board.build_after === 0) { slots[placed[0].position].push('idle'); }
                continue;
            }
            const above = placed.filter(entry => entry.board_index < after);
            const slot = above.length > 0 ? above[above.length - 1].position + 1 : placed[0].position;
            slots[slot].push(kind);
        }
        return slots;
    }
    return slots;
}

/** the story key of each note, undefined for one that is not a story or has no document path to join on */
export function storyKeysForNotes(notes: ReadonlyArray<NoteProps | undefined>, fallback_doc_path?: string): Array<ActivityStoryKey | undefined> {
    return notes.map(note => (note && isStoryNote(note) ? storyKeyForNote(note, fallback_doc_path) : undefined));
}

/** the line slots for a list of notes, which may be any mix of stories and other items */
export function boardLineSlotsForNotes(notes: ReadonlyArray<NoteProps | undefined>, boards: ReadonlyArray<ActivityBoardLines>, fallback_doc_path?: string): BoardLineSlots {
    return boardLineSlots(storyKeysForNotes(notes, fallback_doc_path), boards);
}

/** whether any note is a story of a board file, which is what makes the lines worth asking the host for; a path check only, so it is cheap to run on every render */
export function hasBoardStories(notes: ReadonlyArray<NoteProps | undefined>, fallback_doc_path?: string): boolean {
    return notes.some(note => !!note && note.seq !== undefined && isStoryNote(note) && hasBoardFiles([normaliseActivityPath(note.origin?.relative_path ?? fallback_doc_path)]));
}

/** whether a slot list draws any line at all */
export function hasAnyBoardLine(slots: BoardLineSlots): boolean {
    return slots.some(slot => slot.length > 0);
}

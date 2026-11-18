import { normaliseActivityPath, storyKeyForNote, type ActivityStoryKey } from "./agentactivityops";
import { hasBoardFiles } from "./coordinatorops";
import { isStoryNote } from "./progressops";
import type { ActivityCoordinator } from "../types/AgentActivity";
import type { NoteProps } from "../types/NoteProps";

/**
 * The build and ship lines across a view of a board's stories: the pure half. The build line marks the
 * last story the coordinator will build if left to run, and the ship line the last story that has passed
 * the release gate. Both belong to the view, not to a card, so this module answers one question for any
 * view: given the stories it shows in order, which lines are drawn before each of them and after the last.
 *
 * Each coordinator row carries both lines as a count of the board's stories at or above the line
 * (`build_after`, `ship_after`), and a story is placed on the board by its document path and id. A view
 * that has been sorted away from board order, or that shows no story of a coordinator's board, draws
 * nothing, because position there says nothing about the board.
 */

export const BOARD_LINE_KINDS = ['build', 'ship'] as const;
export type BoardLineKind = typeof BOARD_LINE_KINDS[number];

/** the line slots for a list of cards: slot `i` holds the lines drawn before card `i`, and the last slot those after the final card */
export type BoardLineSlots = BoardLineKind[][];

/** how many stories sit at or above a line, 0 when the snapshot predates the line or the board has none to mark */
function linePosition(coordinator: ActivityCoordinator, kind: BoardLineKind): number {
    const position = kind === 'build' ? coordinator.build_after : coordinator.ship_after;
    return typeof position === 'number' && Number.isFinite(position) ? position : 0;
}

/** the board index of a story key on a coordinator's board, -1 when the key is on another board or not a story of it */
function boardIndex(coordinator: ActivityCoordinator, key: ActivityStoryKey | undefined): number {
    if (!key || !coordinator.board_doc_path || normaliseActivityPath(coordinator.board_doc_path) !== normaliseActivityPath(key.doc_path)) { return -1; }
    return coordinator.board_stories.findIndex(story => story.id === key.id);
}

/**
 * The lines to draw among a list of cards, as slots (see BoardLineSlots), empty throughout when none
 * applies. The coordinator is the first one whose board holds one of the cards; cards that are not stories
 * of that board are stepped over. Lines are drawn only when the board's stories appear in board order:
 * otherwise position says nothing, and nothing is drawn.
 *
 * A line with `n` stories at or above it falls after the last card whose board index is below `n`. When
 * every card sits below it, it falls before the first story card (a group whose cards all sit below the
 * line draws it first), and when every card sits above it, after the last (so it draws last). A line that
 * marks no story at all is not drawn.
 */
export function boardLineSlots(keys: ReadonlyArray<ActivityStoryKey | undefined>, coordinators: ReadonlyArray<ActivityCoordinator>): BoardLineSlots {
    const slots: BoardLineSlots = Array.from({ length: keys.length + 1 }, () => []);
    for (const coordinator of coordinators) {
        const indices = keys.map(key => boardIndex(coordinator, key));
        const placed = indices.map((board_index, position) => ({ board_index, position })).filter(entry => entry.board_index >= 0);
        if (placed.length === 0) { continue; }
        if (placed.some((entry, i) => i > 0 && entry.board_index <= placed[i - 1].board_index)) { return slots; }
        for (const kind of BOARD_LINE_KINDS) {
            const after = linePosition(coordinator, kind);
            if (after <= 0) { continue; }
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
export function boardLineSlotsForNotes(notes: ReadonlyArray<NoteProps | undefined>, coordinators: ReadonlyArray<ActivityCoordinator>, fallback_doc_path?: string): BoardLineSlots {
    return boardLineSlots(storyKeysForNotes(notes, fallback_doc_path), coordinators);
}

/** whether any note is a story of a board file, which is what makes the lines worth asking the host for; a path check only, so it is cheap to run on every render */
export function hasBoardStories(notes: ReadonlyArray<NoteProps | undefined>, fallback_doc_path?: string): boolean {
    return notes.some(note => !!note && note.seq !== undefined && isStoryNote(note) && hasBoardFiles([normaliseActivityPath(note.origin?.relative_path ?? fallback_doc_path)]));
}

/** whether a slot list draws any line at all */
export function hasAnyBoardLine(slots: BoardLineSlots): boolean {
    return slots.some(slot => slot.length > 0);
}

import { useMemo } from "react";
import { useAgentActivity } from "./activityhooks";
import { boardLineSlotsForNotes, hasBoardStories, type BoardLineSlots } from "./boardlineops";
import type { NoteProps } from "../types/NoteProps";

/**
 * The build and ship line slots for the notes a view shows in order (see boardLineSlots), recomputed when
 * the notes or the activity snapshot change. Empty slots until the host has sent a snapshot.
 */
export function useBoardLineSlots(notes: ReadonlyArray<NoteProps | undefined>, fallback_doc_path?: string): BoardLineSlots {
    const snapshot = useAgentActivity();
    return useMemo(
        () => boardLineSlotsForNotes(notes, snapshot?.coordinators ?? [], fallback_doc_path),
        [notes, snapshot, fallback_doc_path],
    );
}

/**
 * The line slots of each group of a grouped view, in the order given, and whether any group shows a story
 * of a board file (which is when the host is asked for activity). A group draws the lines between its own
 * cards, so each group's slots are computed over that group's cards alone.
 */
export function useGroupBoardLines(groups: ReadonlyArray<ReadonlyArray<NoteProps>>, fallback_doc_path?: string): { slots: BoardLineSlots[]; has_board: boolean } {
    const snapshot = useAgentActivity();
    return useMemo(() => ({
        slots: groups.map(notes => boardLineSlotsForNotes(notes, snapshot?.coordinators ?? [], fallback_doc_path)),
        has_board: groups.some(notes => hasBoardStories(notes, fallback_doc_path)),
    }), [groups, snapshot, fallback_doc_path]);
}

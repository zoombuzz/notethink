import Debug from "debug";
import { useMemo } from "react";
import { useAgentActivity } from "../../../lib/activityhooks";
import {
    ACTIVITY_BAND_COMMITTED,
    ACTIVITY_BAND_UNCOMMITTED,
    AGENT_VIRTUAL_NAMESPACE,
    attributedFiles,
    producerForDocPath,
    producerForRoot,
    producerStateOf,
    sessionForUnboundKey,
    sessionsForStory,
    storyKeyForNote,
    treeForRoot,
    unattributedFiles,
    type ActivityBand,
    type ActivityProducerLiveness,
    type ActivityProducerState,
    type ActivityRefusal,
    type ActivitySessionState,
    type ActivitySnapshot,
    type ActivityStoryKey,
} from "../../../lib/agentactivityops";
import { virtualNoteKeyOf } from "../../../lib/virtualnoteops";
import type { ActivityChangedFile, ActivityTree } from "../../../types/AgentActivity";
import type { NoteProps } from "../../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:useAgentNoteModel");

/**
 * AgentFileEntry is one row of a file band: the changed file and the session accounting for it.
 * - session: undefined means unattributed, which is the safe reading and the only one a file with no matching write call is ever given
 */
export interface AgentFileEntry {
    file: ActivityChangedFile;
    session: ActivitySessionState | undefined;
}

/**
 * AgentNoteModel is everything one agent card draws, resolved from the workspace-wide snapshot down to
 * the single contract root this note's document sits inside.
 * - heard_from_host: false until the host has posted a snapshot at all, which is a different thing from it posting one saying nothing is writing
 * - producer_state: absent, unreadable, stopped or live, which is what an otherwise empty card has to say first
 * - refusals: contract files the host would not read in this root, drawn before any empty state, because an empty board over a failed read must not look like an idle one
 * - unreadable_session_ids: sessions this root's manifest declared and the host could not read, which is not the same as a session sitting idle
 * - is_virtual: the note is a minted stand-in for an agent that declared no story, rather than a parsed one
 * - story_key: the pair this card joins on, undefined when the story carries no authored id and so cannot be bound to at all
 * - root_path: the contract root every row's request is echoed back to the host with, absent when no producer covers this note
 */
export interface AgentNoteModel {
    heard_from_host: boolean;
    producer: ActivityProducerState | undefined;
    producer_state: ActivityProducerLiveness;
    refusals: ActivityRefusal[];
    unreadable_session_ids: string[];
    is_virtual: boolean;
    story_key: ActivityStoryKey | undefined;
    root_path: string | undefined;
    sessions: ActivitySessionState[];
    uncommitted: AgentFileEntry[];
    committed: AgentFileEntry[];
}

/** the sessions one note draws: the single minted-for session on a virtual note, else every agent that declared this story */
function sessionsForNote(snapshot: ActivitySnapshot | undefined, note: NoteProps, story_key: ActivityStoryKey | undefined): ActivitySessionState[] {
    const virtual_key = virtualNoteKeyOf(note, AGENT_VIRTUAL_NAMESPACE);
    if (virtual_key !== undefined) {
        const state = sessionForUnboundKey(snapshot, virtual_key);
        return state ? [state] : [];
    }
    return sessionsForStory(snapshot, story_key);
}

/**
 * One band's rows: the files this card's own sessions account for, then the files no session accounts
 * for. The unattributed rows appear on every agent card drawing this contract root, because nothing
 * places them on one - a file with no matching write call is never credited to a guessed agent.
 */
function fileEntriesFor(tree: ActivityTree | undefined, band: ActivityBand, sessions: ReadonlyArray<ActivitySessionState>): AgentFileEntry[] {
    const by_id = new Map(sessions.map(state => [state.session.session_id, state]));
    const mine = attributedFiles(tree, band, [...by_id.keys()])
        .map(file => ({ file, session: by_id.get(file.session_id!) }));
    const orphans = unattributedFiles(tree, band).map(file => ({ file, session: undefined }));
    return [...mine, ...orphans];
}

/** resolve the workspace-wide activity snapshot down to the one card this note draws */
export function useAgentNoteModel(note: NoteProps): AgentNoteModel {
    const snapshot = useAgentActivity();
    // the view's own document path, stamped by GenericView, is the single-file fallback for a note carrying no folder-mode origin
    const fallback_doc_path = note.display_options?.activity_doc_path as string | undefined;
    return useMemo(() => {
        const story_key = storyKeyForNote(note, fallback_doc_path);
        const sessions = sessionsForNote(snapshot, note, story_key);
        /*
         * A virtual note takes its contract root from the session it was minted for; a story note
         * from the root its own document sits inside, which is asked of the document rather than of
         * the story key: a story carrying no authored id cannot be joined to a session and still sits
         * in a repository, and must say which of the two it is short of.
         */
        const producer = sessions[0]
            ? producerForRoot(snapshot, sessions[0].root_path)
            : producerForDocPath(snapshot, note.origin?.relative_path ?? fallback_doc_path);
        const tree = treeForRoot(snapshot, producer?.root_path);
        debug('note %s joins %d session(s) in root %s', note.stable_id, sessions.length, producer?.root_relative ?? 'none');
        return {
            heard_from_host: snapshot !== undefined,
            producer,
            producer_state: producerStateOf(producer),
            refusals: producer?.refusals ?? [],
            unreadable_session_ids: producer?.unreadable_session_ids ?? [],
            is_virtual: virtualNoteKeyOf(note, AGENT_VIRTUAL_NAMESPACE) !== undefined,
            story_key,
            root_path: producer?.root_path,
            sessions,
            uncommitted: fileEntriesFor(tree, ACTIVITY_BAND_UNCOMMITTED, sessions),
            committed: fileEntriesFor(tree, ACTIVITY_BAND_COMMITTED, sessions),
        };
    }, [snapshot, note, fallback_doc_path]);
}

import Debug from "debug";
import { useMemo } from "react";
import { useAgentActivity } from "../../../lib/activityhooks";
import {
    AGENT_VIRTUAL_NAMESPACE,
    attributedCommits,
    unattributedCommits,
    attributedFiles,
    sessionForUnboundKey,
    sessionStateOf,
    sessionsForStory,
    storyKeyForNote,
    treeForDocPath,
    treeForRoot,
    unattributedFiles,
    type ActivityAnalyserState,
    type ActivityRefusal,
    type ActivitySessionState,
    type ActivitySnapshot,
    type ActivityStoryKey,
} from "../../../lib/agentactivityops";
import { virtualNoteKeyOf } from "../../../lib/virtualnoteops";
import type { ActivityChangedFile, ActivityCommit, ActivityState } from "../../../types/AgentActivity";
import type { NoteProps } from "../../../types/NoteProps";

/*
 * The rank a card's meta-row chip picks the "winning" agent state by, lowest wins.
 * `waiting` is this codebase's "waiting on you" - the design's blocked/needs-you tier - so it outranks
 * `working`, which outranks the quieter `idle`, `ended` and `unknown`.
 */
const AGENT_STATE_RANK: Record<ActivityState, number> = { waiting: 0, working: 1, idle: 2, ended: 3, unknown: 4 };

/** the state a multi-agent card is coloured and labelled by: the most urgent state among its sessions, undefined when it draws none */
function winningStateFor(sessions: ReadonlyArray<ActivitySessionState>): ActivityState | undefined {
    return sessions.reduce<ActivityState | undefined>((best, state) => {
        const current = sessionStateOf(state.session);
        return best === undefined || AGENT_STATE_RANK[current] < AGENT_STATE_RANK[best] ? current : best;
    }, undefined);
}

const debug = Debug("nodejs:notethink-views:useAgentNoteModel");

/**
 * AgentFileEntry is one row of the uncommitted band: the changed file and the session accounting for it.
 * - session: undefined means unattributed, which is the safe reading and the only one a file with no matching write call is ever given
 */
export interface AgentFileEntry {
    file: ActivityChangedFile;
    session: ActivitySessionState | undefined;
}

/** AgentCommitEntry is one row of the committed band: the commit and the session its own commit call accounted for */
export interface AgentCommitEntry {
    commit: ActivityCommit;
    session: ActivitySessionState | undefined;
}

/**
 * AgentNoteModel is everything one agent card draws, resolved from the workspace-wide snapshot down
 * to this note.
 * - heard_from_host: false until the host has posted a snapshot at all, which is a different thing from it posting one saying nothing is running
 * - unreadable_session_ids: sessions the analyser declared it could not fully read, drawn before any empty state, because an empty board over a failed read must not look like an idle one
 * - is_virtual: the note is a minted stand-in for an agent whose own write calls bound it to no story, rather than a parsed one
 * - story_key: the pair this card joins on, undefined when the note carries no document path to join on
 * - root_path: the repository every row's request is echoed back to the host with, absent when this note sits in none the analyser has read a tree for
 * - winning_state: the most urgent state among `sessions`, undefined on a card drawing none; the meta-row chip is coloured and labelled by it
 */
export interface AgentNoteModel {
    heard_from_host: boolean;
    analyser: ActivityAnalyserState | undefined;
    refusals: ActivityRefusal[];
    unreadable_session_ids: string[];
    is_virtual: boolean;
    story_key: ActivityStoryKey | undefined;
    root_path: string | undefined;
    sessions: ActivitySessionState[];
    winning_state: ActivityState | undefined;
    uncommitted: AgentFileEntry[];
    committed: AgentCommitEntry[];
}

/** the sessions one note draws: the single minted-for session on a virtual note, else every agent whose own write calls bound it to this story */
function sessionsForNote(snapshot: ActivitySnapshot | undefined, note: NoteProps, story_key: ActivityStoryKey | undefined): ActivitySessionState[] {
    const virtual_key = virtualNoteKeyOf(note, AGENT_VIRTUAL_NAMESPACE);
    if (virtual_key !== undefined) {
        const state = sessionForUnboundKey(snapshot, virtual_key);
        return state ? [state] : [];
    }
    return sessionsForStory(snapshot, story_key);
}

/** the session ids drawn on this card, sorted so the join below is deterministic */
function sessionIdsOf(sessions: ReadonlyArray<ActivitySessionState>): string[] {
    return sessions.map(state => state.session.session_id);
}

/** the uncommitted-band rows: files this card's sessions account for, then files no session accounts for, which appear on every card drawing this repository */
function uncommittedEntriesFor(tree: ReturnType<typeof treeForDocPath>, sessions: ReadonlyArray<ActivitySessionState>): AgentFileEntry[] {
    const by_id = new Map(sessions.map(state => [state.session.session_id, state]));
    const ids = sessionIdsOf(sessions);
    const mine = attributedFiles(tree?.tree, ids).map(file => ({ file, session: by_id.get(file.session_id!) }));
    const orphans = unattributedFiles(tree?.tree).map(file => ({ file, session: undefined }));
    return [...mine, ...orphans];
}

/** the committed-band rows: this card's sessions' own commits, in the order the analyser listed them */
function committedEntriesFor(tree: ReturnType<typeof treeForDocPath>, sessions: ReadonlyArray<ActivitySessionState>): AgentCommitEntry[] {
    const by_id = new Map(sessions.map(state => [state.session.session_id, state]));
    const mine = attributedCommits(tree?.tree, sessionIdsOf(sessions)).map(commit => ({ commit, session: by_id.get(commit.session_id!) }));
    const orphans = unattributedCommits(tree?.tree).map(commit => ({ commit, session: undefined }));
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
         * A virtual note takes its repository from the session it was minted for; a story note takes
         * it from its first bound session's root when one exists, else from its own document path,
         * since a note with no bound session still sits in a repository.
         */
        const tree = sessions[0]
            ? treeForRoot(snapshot, sessions[0].root_path)
            : treeForDocPath(snapshot, note.origin?.relative_path ?? fallback_doc_path);
        debug('note %s joins %d session(s) in root %s', note.stable_id, sessions.length, tree?.root_relative ?? 'none');
        return {
            heard_from_host: snapshot !== undefined,
            analyser: snapshot?.analyser,
            refusals: snapshot?.analyser.refusals ?? [],
            unreadable_session_ids: [...new Set((snapshot?.analyser.refusals ?? []).map(r => r.session_id).filter((id): id is string => id !== undefined))],
            is_virtual: virtualNoteKeyOf(note, AGENT_VIRTUAL_NAMESPACE) !== undefined,
            story_key,
            root_path: tree?.root_path,
            sessions,
            winning_state: winningStateFor(sessions),
            uncommitted: uncommittedEntriesFor(tree, sessions),
            committed: committedEntriesFor(tree, sessions),
        };
    }, [snapshot, note, fallback_doc_path]);
}

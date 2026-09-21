import React, { useCallback, useMemo, useState } from "react";
import { AGENT_CARD_TYPE } from "./cardregistryops";
import { useActivityUnavailable } from "../../lib/activityhooks";
import { ACTIVITY_OPEN_CHAT_MESSAGE_TYPE, ACTIVITY_OPEN_DIFF_MESSAGE_TYPE, type ActivityBand } from "../../lib/agentactivityops";
import { buildNoteStyles } from "../../lib/noteui";
import { getStandardNoteDataProps, renderMarkdownNoteHeadline } from "../../lib/renderops";
import type { NoteProps } from "../../types/NoteProps";
import MarkdownNoteHeadline from "./markdown/MarkdownNoteHeadline";
import AgentActivityBanner from "./agent/AgentActivityBanner";
import AgentFileBands from "./agent/AgentFileBands";
import AgentQuestionBand from "./agent/AgentQuestionBand";
import AgentSessionDrawerRegion from "./agent/AgentSessionDrawerRegion";
import AgentSessionRow from "./agent/AgentSessionRow";
import { useAgentNoteModel } from "./agent/useAgentNoteModel";
import agent_styles from "./AgentNote.module.scss";

/**
 * AgentNote, the agent card: which AI agents are working on this note's story, what each one is doing
 * now, what any of them is waiting on the operator for, and which files have changed.
 *
 * The third entry on the card axis, chosen independently of the view, so an agent card in a document
 * and an agent card in a kanban lane are the same card in two layouts. It draws one note like every
 * other card, and the note it draws is either a parsed story or a virtual one minted for an agent that
 * declared it is on no story - the card cannot tell the two apart and does not ask.
 *
 * The activity itself never rides on the note. NoteProps is the mdast contract and stays free of
 * agent, git and process fields, so the card reads the workspace-wide snapshot the extension host
 * posts and joins it here, at render, on the story's own document path and authored id.
 *
 * Both outbound requests echo back identifiers the host itself published - the contract root and the
 * path it listed, the vendor slug and the session id - and construct none of them, so a path the
 * contract never named cannot be turned into a file to open.
 *
 * Colour is spent on one thing: an agent's state. The vendor is a monospace monogram and the file
 * bands are unsaturated, so the only mark that draws the eye is the one worth acting on.
 */
export default function AgentNote(props: NoteProps): React.ReactElement {
    const note_props = props;
    const provided = note_props.display_options?.provided;
    const model = useAgentNoteModel(note_props);
    const unavailable = useActivityUnavailable();
    const [open_session_id, setOpenSessionId] = useState<string | undefined>(undefined);
    // the full card's headline parse, memoised on the same text, checkbox state and linetag start
    const memoized_headline = useMemo(() => {
        return renderMarkdownNoteHeadline(note_props, {
            render: 'strip_linetags',
            linetags_from: note_props.linetags_from,
        });
    }, [
        note_props.headline_raw,
        note_props.checked,
        note_props.linetags_from,
    ]);
    const post_message = note_props.handlers?.postMessage;
    const root_path = model.root_path;
    const handleSessionToggle = useCallback((session_id: string) => {
        setOpenSessionId(current => (current === session_id ? undefined : session_id));
    }, []);
    const handleOpenDiff = useCallback((path: string, band: ActivityBand) => {
        post_message?.({ type: ACTIVITY_OPEN_DIFF_MESSAGE_TYPE, root_path, path, band });
    }, [post_message, root_path]);
    const handleOpenChat = useCallback((vendor: string, session_id: string) => {
        post_message?.({ type: ACTIVITY_OPEN_CHAT_MESSAGE_TYPE, vendor, session_id });
    }, [post_message]);
    // take the props version of every attribute, because the memoized headline only augments the note
    const note: NoteProps = {
        headline: memoized_headline,
        ...note_props,
    };
    const card_id = note.display_options?.id ?? `agent-${note.seq}`;
    const drawer_id = `${card_id}-agent-drawer`;
    const open_session = model.sessions.find(state => state.session.session_id === open_session_id);
    return (
        <div className={buildNoteStyles(note, [agent_styles.agentNote, ...(note.display_options?.additional_classes ?? [])]).join(' ')}
             id={note.display_options?.id}
             {...getStandardNoteDataProps(note)}
             data-card-type={AGENT_CARD_TYPE}
             data-level={note.level}
             data-virtual-note={model.is_virtual}
             data-producer-state={model.producer_state}
             data-session-count={model.sessions.length}
             // passed-on inherited props (such as draggable)
             {...provided?.draggableProps}
             {...provided?.dragHandleProps}
             ref={provided?.innerRef}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
             style={provided?.draggableProps?.style as React.CSSProperties}
        >
            <MarkdownNoteHeadline note={note} />
            <AgentActivityBanner model={model} />
            {model.sessions.length > 0 && (
                <ul className={agent_styles.agentRows} data-testid="agent-rows">
                    {model.sessions.map(state => (
                        <AgentSessionRow
                            key={state.session.session_id}
                            state={state}
                            refusals={model.refusals.filter(refusal => refusal.session_id === state.session.session_id)}
                            drawerId={drawer_id}
                            open={open_session_id === state.session.session_id}
                            onToggle={handleSessionToggle}
                        />
                    ))}
                </ul>
            )}
            <AgentQuestionBand sessions={model.sessions} />
            <AgentSessionDrawerRegion
                drawerId={drawer_id}
                state={open_session}
                unavailable={unavailable}
                onOpenChat={handleOpenChat}
            />
            {model.sessions.length > 0 && <AgentFileBands model={model} unavailable={unavailable} onOpenDiff={handleOpenDiff} />}
        </div>
    );
}

import React, { useCallback, useMemo } from "react";
import { AGENT_CARD_TYPE } from "./cardregistryops";
import { useActivityUnavailable, useAgentActivityDemand } from "../../lib/activityhooks";
import { ACTIVITY_OPEN_CHAT_MESSAGE_TYPE, ACTIVITY_OPEN_DIFF_MESSAGE_TYPE, type ActivityBand } from "../../lib/agentactivityops";
import { isNoteManuallyExpanded } from "../../lib/noteops";
import { buildNoteStyles } from "../../lib/noteui";
import { getStandardNoteDataProps, renderMarkdownNoteHeadline } from "../../lib/renderops";
import type { NoteProps } from "../../types/NoteProps";
import MarkdownNoteHeadline from "./markdown/MarkdownNoteHeadline";
import AgentActivityBanner from "./agent/AgentActivityBanner";
import AgentFileBands from "./agent/AgentFileBands";
import AgentMetaRow from "./agent/AgentMetaRow";
import AgentQuestionBand from "./agent/AgentQuestionBand";
import AgentSessionRows from "./agent/AgentSessionRows";
import AgentUsageSummary from "./agent/AgentUsageSummary";
import { useAgentNoteModel } from "./agent/useAgentNoteModel";
import agent_styles from "./AgentNote.module.scss";
import view_specific_styles from "../ViewRenderer.module.scss";

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
 * posts and joins it here, at render, on the story's own document path and stable id (its authored
 * id, or the slug derived from its headline).
 *
 * Both outbound requests echo back identifiers the host itself published in the snapshot - the tree's
 * own root path and a file's own path for a diff request, the session's own vendor and session id for
 * a chat request - and construct none of them, so a path the snapshot never listed cannot be turned
 * into a file to open.
 *
 * A session's conversation is never drawn on the card: a card is the wrong place to read one. Clicking
 * an agent row opens that session in VS Code instead, in its vendor's own chat panel where there is
 * one, else as its transcript in an editor.
 *
 * Colour is spent on one thing: an agent's state. The vendor is a monospace monogram and the file
 * bands are unsaturated, so the only mark that draws the eye is the one worth acting on.
 */
export default function AgentNote(props: NoteProps): React.ReactElement {
    const note_props = props;
    const provided = note_props.display_options?.provided;
    const model = useAgentNoteModel(note_props);
    const unavailable = useActivityUnavailable();
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
    useAgentActivityDemand(post_message);
    const root_path = model.root_path;
    const handleOpenDiff = useCallback((path: string, band: ActivityBand) => {
        post_message?.({ type: ACTIVITY_OPEN_DIFF_MESSAGE_TYPE, root_path, path, band });
    }, [post_message, root_path]);
    const handleOpenChat = useCallback((vendor: string, session_id: string) => {
        post_message?.({ type: ACTIVITY_OPEN_CHAT_MESSAGE_TYPE, vendor, session_id });
    }, [post_message]);
    // the card's manual expansion is the view's, on the same view_expanded_ids list the default card's Show more / Show less write
    const expanded = isNoteManuallyExpanded(note_props);
    const stable_id = note_props.stable_id;
    const set_note_expanded = note_props.handlers?.setNoteExpanded;
    const handleToggleExpanded = useMemo(() => (stable_id !== undefined && set_note_expanded
        ? (next: boolean) => set_note_expanded(stable_id, next)
        : undefined), [stable_id, set_note_expanded]);
    // take the props version of every attribute, because the memoized headline only augments the note
    const note: NoteProps = {
        headline: memoized_headline,
        ...note_props,
    };
    return (
        <div className={buildNoteStyles(note, [agent_styles.agentNote, ...(note.display_options?.additional_classes ?? [])]).join(' ')}
             id={note.display_options?.id}
             {...getStandardNoteDataProps(note)}
             data-card-type={AGENT_CARD_TYPE}
             data-level={note.level}
             data-virtual-note={model.is_virtual}
             data-analyser-state={model.analyser?.state}
             data-session-count={model.sessions.length}
             data-winning-state={model.winning_state}
             // passed-on inherited props (such as draggable)
             {...provided?.draggableProps}
             {...provided?.dragHandleProps}
             ref={provided?.innerRef}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
             style={provided?.draggableProps?.style as React.CSSProperties}
        >
            <MarkdownNoteHeadline note={note} />
            <div className={`${view_specific_styles.body} ${agent_styles.agentBody}`}>
                <AgentMetaRow model={model} />
                <AgentUsageSummary sessions={model.sessions} storyKey={model.story_key} />
                <AgentActivityBanner model={model} />
                <AgentSessionRows
                    sessions={model.sessions}
                    storyKey={model.story_key}
                    refusals={model.refusals}
                    unavailable={unavailable}
                    onOpen={handleOpenChat}
                />
                <AgentQuestionBand sessions={model.sessions} />
                {model.sessions.length > 0 && <AgentFileBands model={model} unavailable={unavailable} onOpenDiff={handleOpenDiff} expanded={expanded} onToggleExpanded={handleToggleExpanded} />}
            </div>
        </div>
    );
}

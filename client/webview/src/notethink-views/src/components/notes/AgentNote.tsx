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
 * AgentNote, the agent card: which AI agents are working on this note's story, what each is doing
 * now, what any is waiting on the operator for, and which files have changed. The third entry on
 * the card axis, chosen independently of the view. It draws one note like every other card, and
 * that note is either a parsed story or a virtual one minted for an agent on no story - the card
 * cannot tell the two apart and does not ask.
 *
 * The activity itself never rides on the note: NoteProps stays free of agent/git/process fields, so
 * the card reads the workspace-wide snapshot the extension host posts and joins it here, at render,
 * on the story's own document path and stable id. Both outbound requests (open diff, open chat)
 * echo back identifiers the host itself published in the snapshot and construct none of them, so a
 * path the snapshot never listed cannot be turned into a file to open.
 *
 * A session's conversation is never drawn on the card; clicking an agent row opens that session in
 * VS Code instead. Colour is spent on one thing, an agent's state, so the vendor monogram and file
 * bands stay unsaturated.
 *
 * While the card's very first scan is in progress, the snapshot is a growing subset of the eventual
 * one: session rows, the question band and story binding draw as they arrive, token/cost totals draw
 * dimmed, and the uncommitted-file band waits for the scan to finish (crediting a file needs every
 * session's write calls). Every later scan is different: once a scan has ever completed, a later
 * rescan is never reflected on the card at all - it keeps showing its last completed data untouched
 * until the next one finishes and replaces it outright (`model.has_completed_scan` is this
 * component's own backstop for that).
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
    // 'scanning' means "no information yet" only before the first completed scan; has_completed_scan guards that
    const scanning = !model.has_completed_scan && model.analyser?.state === 'scanning';
    // manual expansion is the view's, on the same view_expanded_ids list the default card's Show more writes
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
                <AgentUsageSummary sessions={model.sessions} storyKey={model.story_key} scanning={scanning} />
                <AgentActivityBanner model={model} />
                <AgentSessionRows
                    sessions={model.sessions}
                    storyKey={model.story_key}
                    refusals={model.refusals}
                    unavailable={unavailable}
                    onOpen={handleOpenChat}
                />
                <AgentQuestionBand sessions={model.sessions} />
                {/* waits for a completed scan, since crediting a file needs every session's write calls */}
                {model.sessions.length > 0 && (model.analyser?.state === 'live' || model.has_completed_scan) && <AgentFileBands model={model} unavailable={unavailable} onOpenDiff={handleOpenDiff} expanded={expanded} onToggleExpanded={handleToggleExpanded} />}
            </div>
        </div>
    );
}

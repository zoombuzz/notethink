import { useMemo } from "react";
import type { MouseEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { requestCoordinatorCompose, useAgentActivity } from "../../lib/activityhooks";
import { storyKeyForNote } from "../../lib/agentactivityops";
import { isStoryNote } from "../../lib/progressops";
import { INTEGRATION_MODE_FOLDER } from "../../types/IntegrationMode";
import type { NoteProps } from "../../types/NoteProps";
import styles from "./StorySendButton.module.scss";

interface StorySendButtonProps {
    note: NoteProps;
}

/**
 * The small send action on a story's headline, drawn by every card type beside the progress pie: it
 * opens the coordinator panel's send form for the agent that owns this story's board, with the story
 * named. It appears only on a story that sits on a registered coordinator's own board, in a folder view
 * (where the panel is), and sends nothing itself: the user still writes the message and presses Send.
 */
export default function StorySendButton(props: StorySendButtonProps): ReactElement | null {
    const { note } = props;
    if (!isStoryNote(note) || note.display_options?.integration_mode !== INTEGRATION_MODE_FOLDER) { return null; }
    return <MatchedSendButton note={note} />;
}

function MatchedSendButton(props: StorySendButtonProps): ReactElement | null {
    const { note } = props;
    const snapshot = useAgentActivity();
    const key = useMemo(() => storyKeyForNote(note, note.display_options?.activity_doc_path as string | undefined), [note]);
    const coordinator = useMemo(
        () => (key ? snapshot?.coordinators.find(candidate => candidate.board_doc_path === key.doc_path && candidate.board_stories.some(story => story.id === key.id)) : undefined),
        [snapshot, key],
    );
    if (!key || !coordinator) { return null; }
    const label = l10n.t('Send this story to {0}', coordinator.agent);
    function handleClick(event: MouseEvent<HTMLButtonElement>): void {
        // the headline's own click selects the note; this one only opens the form
        event.stopPropagation();
        requestCoordinatorCompose(coordinator!.agent, l10n.t('About story {0}: ', key!.id));
    }
    return (
        <button type="button" className={styles.sendButton} aria-label={label} title={label} data-testid="story-send-button" onClick={handleClick}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M1.5 3.5h13v9h-13z M1.5 3.5l6.5 5 6.5-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
        </button>
    );
}

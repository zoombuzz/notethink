import { useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import ConfirmModal from "../ConfirmModal";
import { useAgentActivity, useCoordinatorResult } from "../../lib/activityhooks";
import { COORDINATOR_SEND_MESSAGE_TYPE, storyKeyForNote } from "../../lib/agentactivityops";
import { coordinatorResultMessage } from "../../lib/coordinatorops";
import { ACTION_TRAY_ATTRIBUTE, isInnermostHighlighted, titleEndOffset } from "../../lib/noteops";
import { isStoryNote } from "../../lib/progressops";
import { isVirtualNote } from "../../lib/virtualnoteops";
import { INTEGRATION_MODE_FOLDER } from "../../types/IntegrationMode";
import type { NoteProps } from "../../types/NoteProps";
import styles from "./NoteActionTray.module.scss";

interface NoteActionTrayProps {
    note: NoteProps;
}

/**
 * The row of action icons at a highlighted card's bottom-right corner, outside the highlight ring,
 * drawn by every card type from one place. It shows on the innermost highlighted note only (focused or
 * selected), never on an outer note whose ring is faded to give way to an inner one, and nothing
 * otherwise. Two actions: a pencil, which puts the text editor's caret at the end of the note's title
 * text, and an envelope, which asks before sending the story to the coordinator that owns its board.
 * The pencil shows on every note with a source position (a virtual note, which no file holds, has none),
 * except the view's own container note and the root; the envelope only on a story in a folder view
 * that sits on a registered coordinator's own board.
 */
export default function NoteActionTray(props: NoteActionTrayProps): ReactElement | null {
    const { note } = props;
    const is_view_container = note.seq === note.display_options?.parent_context_seq;
    if (note.type === 'root' || is_view_container || isVirtualNote(note) || !isInnermostHighlighted(note)) { return null; }
    return <TrayActions note={note} />;
}

function TrayActions(props: NoteActionTrayProps): ReactElement | null {
    const { note } = props;
    const snapshot = useAgentActivity();
    const result = useCoordinatorResult();
    const [confirming, setConfirming] = useState(false);
    // the host answers a send some time after it is asked, so the answer this tray waits for is the next one
    const [answer_after, setAnswerAfter] = useState<number | undefined>(undefined);
    const mail_ref = useRef<HTMLButtonElement>(null);
    const title_end = titleEndOffset(note);
    const key = useMemo(() => (
        isStoryNote(note) && note.display_options?.integration_mode === INTEGRATION_MODE_FOLDER
            ? storyKeyForNote(note, note.display_options?.activity_doc_path as string | undefined)
            : undefined
    ), [note]);
    const coordinator = useMemo(
        () => (key ? snapshot?.coordinators.find(candidate => candidate.board_doc_path === key.doc_path && candidate.board_stories.some(story => story.id === key.id)) : undefined),
        [snapshot, key],
    );
    if (title_end === undefined && !coordinator) { return null; }
    const own_answer = answer_after !== undefined && result?.request === 'send' && result.agent === coordinator?.agent && (result.seq ?? 0) > answer_after ? result : undefined;
    const answer_text = own_answer ? coordinatorResultMessage(own_answer) : undefined;
    const edit_label = l10n.t('Edit the title in the text editor');
    const send_label = coordinator ? l10n.t('Send this story to {0}', coordinator.agent) : '';
    function handleEdit(event: MouseEvent<HTMLButtonElement>): void {
        // the card's own clicks select the note; a tray action only acts
        event.stopPropagation();
        note.handlers?.postMessage?.({
            type: 'selectRange',
            from: title_end,
            to: title_end,
            docPath: note.origin?.doc_path,
            forceOpen: true,
        });
    }
    function handleAskToSend(event: MouseEvent<HTMLButtonElement>): void {
        event.stopPropagation();
        setConfirming(true);
    }
    function handleCancel(): void {
        setConfirming(false);
        mail_ref.current?.focus();
    }
    function handleConfirm(): void {
        setConfirming(false);
        mail_ref.current?.focus();
        setAnswerAfter(result?.seq ?? 0);
        note.handlers?.postMessage?.({
            type: COORDINATOR_SEND_MESSAGE_TYPE,
            agent: coordinator!.agent,
            body: l10n.t('Please pick up story {0} from {1} and include it in your current batch.', key!.id, key!.doc_path),
        });
    }
    return (
        <div className={styles.tray} role="group" aria-label={l10n.t('Card actions')} data-testid="note-action-tray" {...{ [ACTION_TRAY_ATTRIBUTE]: '' }} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            {answer_text && <span className={styles.answer} role="status" data-testid="note-action-tray-status" data-code={own_answer?.code}>{answer_text}</span>}
            {title_end !== undefined && (
                <button type="button" className={styles.action} aria-label={edit_label} title={edit_label} data-testid="note-edit-button" onClick={handleEdit}>
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d="M10.5 2.5l3 3-8 8H2.5v-3z M9 4l3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                </button>
            )}
            {coordinator && (
                <button ref={mail_ref} type="button" className={styles.action} aria-label={send_label} title={send_label} data-testid="story-send-button" onClick={handleAskToSend}>
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d="M1.5 3.5h13v9h-13z M1.5 3.5l6.5 5 6.5-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                </button>
            )}
            {coordinator && (
                <ConfirmModal
                    opened={confirming}
                    title={send_label}
                    message={l10n.t('Ask {0} to pick up story {1} and include it in its current batch?', coordinator.agent, key!.id)}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                />
            )}
        </div>
    );
}

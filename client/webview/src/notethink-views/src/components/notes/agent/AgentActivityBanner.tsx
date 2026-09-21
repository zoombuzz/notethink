import React from "react";
import * as l10n from "@vscode/l10n";
import { ACTIVITY_DIR } from "../../../types/AgentActivity";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * What the card says when it has little or nothing to draw, which is the half of this feature that has
 * to be got right: an empty board must never read as idle agents.
 *
 * The error path is stated before the empty one. A contract file the host refused is drawn whether or
 * not there are sessions, because an empty board over a failed read is a worse bug for looking fine,
 * and so is a session the manifest declared that the host could not read - three declared and two read
 * is a fact a reader is owed. Below that the card separates nothing writing at all, from a contract
 * directory whose manifest could not be read, from a producer that has stopped, from a story nothing
 * has declared, from a story nothing COULD declare because it carries no authored id. Each is a
 * different thing to tell a user and only one of them means the agents are quiet.
 *
 * PATTERNS.md > Empty states names Mantine's EmptyState as the canonical. notethink has no Mantine and
 * is a VS Code webview themed by the host's own variables, so the component half does not apply here;
 * the half that does, fixing the error path before the presentation, is what the ordering above is.
 */
export interface AgentActivityBannerProps {
    model: AgentNoteModel;
}

/** the notice for a card with no sessions to draw, or undefined when there is nothing to say */
function emptyNotice(model: AgentNoteModel): string | undefined {
    if (!model.heard_from_host) {
        return l10n.t('Waiting for NoteThink to report what is writing agent activity.');
    }
    if (model.producer_state === 'absent') {
        return l10n.t('No producer is writing agent activity for this repository. NoteThink reads files a producer writes into a {0} directory inside a repository in this workspace, and cannot see one writing anywhere else.', ACTIVITY_DIR);
    }
    if (model.producer_state === 'unreadable') {
        return l10n.t('A {0} directory is here and its manifest could not be read, so nothing below can be trusted to be complete.', ACTIVITY_DIR);
    }
    if (model.producer_state === 'stopped') {
        return l10n.t('{0} has stopped writing, so anything below is as it was when it stopped.', model.producer?.producer?.name ?? l10n.t('The producer'));
    }
    if (model.is_virtual) { return undefined; }
    if (!model.story_key) {
        return l10n.t('This story carries no id linetag, so no agent can declare that it is working on it.');
    }
    if (model.sessions.length === 0) {
        return l10n.t('No agent has declared this story.');
    }
    return undefined;
}

function AgentActivityBanner(props: AgentActivityBannerProps): React.ReactElement | null {
    const { model } = props;
    const notice = emptyNotice(model);
    // a refusal naming a session is drawn on that session's own row instead, where a reader is looking at it
    const card_refusals = model.refusals.filter(refusal => refusal.session_id === undefined);
    const unreadable = model.unreadable_session_ids.length;
    if (card_refusals.length === 0 && unreadable === 0 && notice === undefined) { return null; }
    return (
        <div className={styles.banner} data-testid="agent-banner">
            {card_refusals.length > 0 && (
                <ul className={styles.bannerRefusals} data-testid="agent-banner-refusals">
                    {card_refusals.map(refusal => (
                        <li key={`${refusal.file}:${refusal.code}`} className={styles.bannerRefusal}>
                            {l10n.t('{0} could not be read: {1}', refusal.file, refusal.reason)}
                        </li>
                    ))}
                </ul>
            )}
            {unreadable > 0 && (
                <p className={styles.bannerNotice} data-testid="agent-banner-unreadable">
                    {l10n.t('{0} of the {1} sessions this producer declares could not be read, so this card is not the whole picture.', unreadable, model.producer?.declared_session_ids.length ?? unreadable)}
                </p>
            )}
            {notice !== undefined && (
                <p className={styles.bannerNotice} data-testid="agent-banner-notice" data-producer-state={model.producer_state}>{notice}</p>
            )}
        </div>
    );
}

export default React.memo(AgentActivityBanner);

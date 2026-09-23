import React from "react";
import * as l10n from "@vscode/l10n";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * What the card says when it has little or nothing to draw: an empty board must never read as idle
 * agents.
 *
 * A story-level refusal (naming no particular session) is drawn first, whether or not the card has
 * sessions, because an empty board over a failed read is a worse bug than looking fine; a refusal
 * naming a session is drawn on that session's own row instead. Below the refusals, one notice covers
 * whichever of these applies: sessions that could not be fully read, the host not having reported yet,
 * the analyser being unavailable, still scanning, having failed, or - for a real (non-virtual) note -
 * no agent activity in the last 30 days.
 *
 * Each notice is one short line, with its full explanation carried as the line's `title` for a reader
 * who hovers.
 *
 * PATTERNS.md > Empty states: fix the error path before the presentation, which the ordering above is.
 */
export interface AgentActivityBannerProps {
    model: AgentNoteModel;
}

/** a one-line notice with its full explanation kept for a hover */
type EmptyNotice = { text: string; detail: string };

/** the notice for a card with no sessions to draw, or undefined when there is nothing to say */
function emptyNotice(model: AgentNoteModel): EmptyNotice | undefined {
    if (!model.heard_from_host || !model.analyser) {
        return { text: l10n.t('Waiting for agent activity'), detail: l10n.t('Waiting for NoteThink to report agent activity.') };
    }
    if (model.analyser.state === 'unavailable') {
        return {
            text: l10n.t('Agent activity unavailable'),
            detail: l10n.t('NoteThink cannot read local agent session files in this host. {0}', model.analyser.reason ?? l10n.t('This usually means a web host with no local disk.')),
        };
    }
    if (model.analyser.state === 'scanning') {
        return { text: l10n.t('Scanning agent activity...'), detail: l10n.t('NoteThink is still scanning for local agent sessions.') };
    }
    if (model.analyser.state === 'failed') {
        return {
            text: l10n.t('Agent activity analyser failed'),
            detail: l10n.t('The agent activity analyser failed. {0}', model.analyser.reason ?? l10n.t('See the extension log for detail.')),
        };
    }
    if (model.is_virtual) { return undefined; }
    if (model.sessions.length === 0) {
        return { text: l10n.t('No agent activity in 30 days'), detail: l10n.t('No agent has worked on this story in the last 30 days.') };
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
                    {l10n.t('{0} session(s) could not be fully read, so this card is not the whole picture.', unreadable)}
                </p>
            )}
            {notice !== undefined && (
                <p className={styles.bannerNotice} data-testid="agent-banner-notice" data-analyser-state={model.analyser?.state} title={notice.detail}>{notice.text}</p>
            )}
        </div>
    );
}

export default React.memo(AgentActivityBanner);

import React from "react";
import * as l10n from "@vscode/l10n";
import { ACTIVITY_ARG_MAX_CHARS } from "../../../types/AgentActivity";
import { factStateFor, truncateActivityArg } from "../../../lib/agentactivityops";
import type { ActivitySessionState, ActivityUnavailable } from "../../../lib/agentactivityops";
import styles from "../../notes/AgentNote.module.scss";

/**
 * The agent drawer: one session's conversation, its recent tool calls and the facts the producer put
 * beside it. The conversation opens here rather than scrolling as bubbles on the card, so a card stays
 * the size of a card whatever a session has been doing.
 *
 * The digest is bounded by the contract - agent transcripts run past 100 MB and the host reads whole
 * files only - so the drawer states its own window from the digest's own `kept` and `dropped` counts.
 * A bounded list that does not say it is bounded gives a partial answer that looks complete, which is
 * worse than no answer.
 *
 * Handing a session to its vendor's own chat panel is offered here, inside the drawer, rather than as
 * the row's action. Measured against Claude Code 2.1.274, its command resolves and opens a tab even
 * for a session id it does not know, so a call that does not throw is no evidence the conversation
 * loaded: the only failure the host can report is an outright rejection. The affordance therefore
 * says what it does - hand the session over - rather than claiming an outcome, and the digest stays
 * on screen behind it, so a reader who lands on an empty vendor tab still has the conversation here.
 *
 * With no digest at all the drawer says which of the two reasons applies: a vendor whose producer
 * writes no digest for this session, or a session whose digest has not been written yet. Every string
 * it draws comes from a transcript this codebase did not author, and is rendered as text. Nothing in
 * it is a link: an event's `arg`, a digest tool call's `arg` and a fact's value are display text the
 * producer wrote for a person, frequently path-shaped and deliberately truncated, and never locators.
 */
export interface AgentDrawerProps {
    state: ActivitySessionState;
    unavailable: ActivityUnavailable | undefined;
    onOpenChat: (vendor: string, session_id: string) => void;
}

/** the window a bounded slice covers, in words, so a partial answer never looks like a complete one */
function windowLabel(kept: number, dropped: number): string {
    if (dropped === 0) { return l10n.t('All {0}', kept); }
    return l10n.t('Last {0} of {1}', kept, kept + dropped);
}

/** the host's answer when a vendor's chat panel could not be handed the session */
function chatRefusalLabel(reason: string, vendor: string): string {
    switch (reason) {
        case 'no_chat_panel': return l10n.t('{0} has no chat panel in VS Code, so the conversation stays here.', vendor);
        case 'bad_request': return l10n.t('That session id is not one NoteThink will hand over.');
        default: return l10n.t('{0} did not accept the session, so the conversation stays here.', vendor);
    }
}

function AgentDrawer(props: AgentDrawerProps): React.ReactElement {
    const { session, digest } = { session: props.state.session, digest: props.state.digest };
    const chat_refused = props.unavailable?.request === 'chat' && props.unavailable.session_id === session.session_id;
    const handover = (
        <div className={styles.drawerHandover}>
            <button
                type="button"
                className={styles.drawerHandoverButton}
                data-testid="agent-open-chat"
                onClick={(event) => { event.stopPropagation(); props.onOpenChat(session.vendor, session.session_id); }}
            >{l10n.t('Open in {0}', session.vendor)}</button>
            <span className={styles.drawerHandoverNote} data-testid="agent-open-chat-note">
                {chat_refused
                    ? chatRefusalLabel(props.unavailable!.reason, session.vendor)
                    : l10n.t('Hands the session to {0}. NoteThink cannot tell whether it found the conversation, so this drawer stays as it is.', session.vendor)}
            </span>
        </div>
    );
    if (!digest) {
        const fact = factStateFor(session, 'digest', false);
        return (
            <div className={styles.drawerBody} data-testid="agent-drawer-body">
                <p className={styles.drawerEmpty} data-testid="agent-drawer-empty" data-fact={fact}>
                    {fact === 'unsupported'
                        ? l10n.t('{0} writes no digest for this session, so there is no conversation to show.', session.vendor)
                        : l10n.t('No digest has been written for this session yet.')}
                </p>
                {handover}
            </div>
        );
    }
    return (
        <div className={styles.drawerBody} data-testid="agent-drawer-body">
            <section className={styles.drawerSection}>
                <h5 className={styles.drawerHeading}>
                    {l10n.t('Conversation')}
                    <span className={styles.drawerWindow} data-testid="agent-drawer-message-window">{windowLabel(digest.messages.kept, digest.messages.dropped)}</span>
                </h5>
                <ul className={styles.drawerList} data-testid="agent-drawer-messages">
                    {digest.messages.items.map((message, index) => (
                        <li key={`${message.at}-${index}`} className={styles.drawerMessage} data-role={message.role}>
                            <span className={styles.drawerRole}>{message.role}</span>
                            <span className={styles.drawerText}>{message.text}</span>
                        </li>
                    ))}
                </ul>
            </section>
            <section className={styles.drawerSection}>
                <h5 className={styles.drawerHeading}>
                    {l10n.t('Tool calls')}
                    <span className={styles.drawerWindow} data-testid="agent-drawer-tool-window">{windowLabel(digest.tool_calls.kept, digest.tool_calls.dropped)}</span>
                </h5>
                <ul className={styles.drawerList} data-testid="agent-drawer-tool-calls">
                    {digest.tool_calls.items.map((call, index) => (
                        <li key={`${call.at}-${index}`} className={styles.drawerToolCall} data-outcome={call.outcome}>
                            <span className={styles.drawerTool}>{call.tool}</span>
                            <span className={styles.drawerText}>{truncateActivityArg(call.arg, ACTIVITY_ARG_MAX_CHARS)}</span>
                        </li>
                    ))}
                </ul>
            </section>
            {digest.facts && Object.keys(digest.facts).length > 0 && (
                <section className={styles.drawerSection}>
                    <h5 className={styles.drawerHeading}>{l10n.t('Session')}</h5>
                    <dl className={styles.drawerFacts} data-testid="agent-drawer-facts">
                        {Object.entries(digest.facts).map(([key, value]) => (
                            <React.Fragment key={key}>
                                <dt className={styles.drawerFactKey}>{key}</dt>
                                <dd className={styles.drawerFactValue}>{value}</dd>
                            </React.Fragment>
                        ))}
                    </dl>
                </section>
            )}
            {handover}
        </div>
    );
}

export default React.memo(AgentDrawer);

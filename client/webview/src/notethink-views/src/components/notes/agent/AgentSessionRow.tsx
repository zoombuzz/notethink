import React from "react";
import * as l10n from "@vscode/l10n";
import { ACTIVITY_ARG_MAX_CHARS } from "../../../types/AgentActivity";
import { factStateFor, sessionStateOf, truncateActivityArg, vendorMonogram } from "../../../lib/agentactivityops";
import type { ActivityRefusal, ActivitySessionState } from "../../../lib/agentactivityops";
import styles from "../AgentNote.module.scss";

/**
 * One agent on a card: the state rail, the vendor's monospace monogram, and the one live line saying
 * what the agent is doing now.
 *
 * State owns the colour and the monogram is monochrome type, so the only saturated mark on the card is
 * the one worth acting on. The live line distinguishes the three things it may honestly say: the tool
 * call when there is one, "nothing running" when the producer could have reported one and did not, and
 * "not reported" when this vendor cannot report one at all. A blank line would read as the first of
 * those whichever of the three was true.
 *
 * A file the host refused that belongs to this session is drawn on this row rather than only in the
 * card's banner, so a session whose digest or event log could not be read says so where a reader is
 * looking at that session.
 *
 * The whole row is one native button rather than a div carrying tabIndex and a hand-rolled key
 * handler: Enter and Space, focus order and the disclosure semantics all come for free, and the ARIA
 * state stays on the control rather than on the row wrapper.
 */
export interface AgentSessionRowProps {
    state: ActivitySessionState;
    refusals: ReadonlyArray<ActivityRefusal>;
    drawerId: string;
    open: boolean;
    onToggle: (session_id: string) => void;
}

/** the state's own word, so a colour-blind reader and a screen reader both get the state in text */
function stateLabel(state: ActivitySessionState): string {
    switch (sessionStateOf(state.session)) {
        case 'working': return l10n.t('Working');
        case 'waiting': return l10n.t('Waiting on you');
        case 'idle': return l10n.t('Idle');
        case 'ended': return l10n.t('Ended');
        default: return l10n.t('State not reported');
    }
}

/** the live line's text, and which of the three honest answers it is */
function liveLine(state: ActivitySessionState): { text: string; fact: string } {
    const session = state.session;
    const current = session.current;
    const fact = factStateFor(session, 'live_tool_call', current !== undefined);
    if (fact === 'unsupported') {
        return { fact, text: l10n.t('{0} cannot report what it is running', session.vendor) };
    }
    if (fact === 'quiet' || !current) {
        return { fact, text: l10n.t('Nothing running') };
    }
    const arg = truncateActivityArg(current.arg, ACTIVITY_ARG_MAX_CHARS);
    if (current.tool) {
        return { fact, text: arg ? `${current.tool} ${arg}` : current.tool };
    }
    return { fact, text: arg || current.kind };
}

function AgentSessionRow(props: AgentSessionRowProps): React.ReactElement {
    const session = props.state.session;
    const live = liveLine(props.state);
    return (
        <li className={styles.agentRow} data-state={sessionStateOf(session)} data-testid="agent-row">
            <button
                type="button"
                className={styles.agentRowButton}
                data-testid="agent-row-button"
                aria-expanded={props.open}
                aria-controls={props.drawerId}
                title={l10n.t('Show this session')}
                onClick={(event) => { event.stopPropagation(); props.onToggle(session.session_id); }}
            >
                <span className={styles.agentRail} aria-hidden={true} />
                <span className={styles.agentMonogram} data-testid="agent-monogram" title={session.vendor}>{vendorMonogram(session.vendor)}</span>
                <span className={styles.agentState} data-testid="agent-state">{stateLabel(props.state)}</span>
                <span className={styles.agentLive} data-testid="agent-live" data-fact={live.fact}>{live.text}</span>
            </button>
            {props.refusals.length > 0 && (
                <ul className={styles.agentRowRefusals} data-testid="agent-row-refusals">
                    {props.refusals.map(refusal => (
                        <li key={`${refusal.file}:${refusal.code}`}>{l10n.t('{0} could not be read: {1}', refusal.file, refusal.reason)}</li>
                    ))}
                </ul>
            )}
        </li>
    );
}

export default React.memo(AgentSessionRow);

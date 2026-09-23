import React from "react";
import AgentSessionRow from "./AgentSessionRow";
import type { ActivityRefusal, ActivitySessionState, ActivityStoryKey, ActivityUnavailable } from "../../../lib/agentactivityops";
import styles from "../AgentNote.module.scss";

/**
 * The roster: one row per session drawn on this card, each opening its session in VS Code.
 * - storyKey: this card's join key, so each row counts only its session's share of this story
 * - unavailable: the host's last refusal, drawn on the row whose session it names
 */
export interface AgentSessionRowsProps {
    sessions: ReadonlyArray<ActivitySessionState>;
    storyKey?: ActivityStoryKey;
    refusals: ReadonlyArray<ActivityRefusal>;
    unavailable: ActivityUnavailable | undefined;
    onOpen: (vendor: string, session_id: string) => void;
}

function AgentSessionRows(props: AgentSessionRowsProps): React.ReactElement | null {
    if (props.sessions.length === 0) { return null; }
    const chat_refusal = props.unavailable?.request === 'chat' ? props.unavailable : undefined;
    return (
        <ul className={styles.agentRows} data-testid="agent-rows">
            {props.sessions.map(state => (
                <AgentSessionRow
                    key={state.session.session_id}
                    state={state}
                    storyKey={props.storyKey}
                    refusals={props.refusals.filter(refusal => refusal.session_id === state.session.session_id)}
                    openRefusal={chat_refusal?.session_id === state.session.session_id ? chat_refusal.reason : undefined}
                    onOpen={props.onOpen}
                />
            ))}
        </ul>
    );
}

export default React.memo(AgentSessionRows);

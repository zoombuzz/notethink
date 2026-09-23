import React from "react";
import * as l10n from "@vscode/l10n";
import { agentStateLabel } from "./agentStateLabel";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * The meta row: a state chip naming the card's winning state (the most urgent state among its
 * sessions, `useAgentNoteModel`'s `winning_state`) and how many agents are on the card. Drawn only
 * when the card has at least one session; a story with none says so in the banner's one muted line
 * instead.
 */
export interface AgentMetaRowProps {
    model: AgentNoteModel;
}

function AgentMetaRow(props: AgentMetaRowProps): React.ReactElement | null {
    const { model } = props;
    if (model.sessions.length === 0 || model.winning_state === undefined) { return null; }
    return (
        <div className={styles.metaRow} data-testid="agent-meta-row">
            <span className={styles.stateChip} data-testid="agent-state-chip" data-state={model.winning_state}>
                <span className={styles.beacon} aria-hidden={true} />
                {agentStateLabel(model.winning_state)}
            </span>
            <span className={styles.agentCount} data-testid="agent-count">
                {l10n.t('{0} agent(s)', String(model.sessions.length))}
            </span>
        </div>
    );
}

export default React.memo(AgentMetaRow);

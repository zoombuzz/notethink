import React, { useMemo } from "react";
import * as l10n from "@vscode/l10n";
import { formatStatusUsage, totalActivityUsage } from "../../../lib/agentactivityops";
import { agentStateLabel } from "./agentStateLabel";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * The status line: a state chip naming the card's winning state (the most urgent state among its
 * sessions, `useAgentNoteModel`'s `winning_state`), then how many agents are on the card and their
 * combined usage, as `1 ag, 8.2Mt, ~$12.40`. The line never wraps: a narrow card clips its end.
 * Drawn only when the card has at least one session; a story with none says so in the banner's one
 * muted line instead.
 *
 * While scanning, the posted sessions are only a growing subset of the total, so the figures are
 * dimmed and marked busy for assistive tech - they must never read as final.
 * - scanning: true while the analyser's first pass has not yet posted its last batch
 */
export interface AgentMetaRowProps {
    model: AgentNoteModel;
    scanning?: boolean;
}

function AgentMetaRow(props: AgentMetaRowProps): React.ReactElement | null {
    const { model } = props;
    const usage = useMemo(() => totalActivityUsage(model.sessions, model.story_key), [model.sessions, model.story_key]);
    if (model.sessions.length === 0 || model.winning_state === undefined) { return null; }
    return (
        <div className={styles.metaRow} data-testid="agent-meta-row">
            <span className={styles.stateChip} data-testid="agent-state-chip" data-state={model.winning_state}>
                <span className={styles.beacon} aria-hidden={true} />
                {agentStateLabel(model.winning_state)}
            </span>
            <span className={styles.agentCount} data-testid="agent-count"
                  data-scanning={props.scanning ? 'true' : undefined}
                  aria-busy={props.scanning ? 'true' : undefined}
                  title={l10n.t('Tokens and estimated cost over the last 30 days of agent activity on this story')}>
                {`${l10n.t('{0} ag', String(model.sessions.length))}, ${formatStatusUsage(usage)}`}
            </span>
        </div>
    );
}

export default React.memo(AgentMetaRow);

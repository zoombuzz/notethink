import React, { useState } from "react";
import * as l10n from "@vscode/l10n";
import { childDisplayName, childStateOf, formatActivityUsage, formatChildClock, shortModelId, splitChildrenForDisplay, truncateActivityArg, vendorMonogram } from "../../../lib/agentactivityops";
import { ACTIVITY_ARG_MAX_CHARS, type ActivityChildSession } from "../../../types/AgentActivity";
import { agentStateLabel } from "./agentStateLabel";
import { useAgentClockNow } from "./useAgentClockNow";
import styles from "../AgentNote.module.scss";

/**
 * One session's subagents, drawn as a tree under the session's own row: each child sits indented on
 * its own rail, coloured by the child's state, with its vendor monogram, model, state, how long it has
 * run, its title and its tokens. A finished child dims, and finished ones past the latest few fold
 * behind a count button that expands them.
 *
 * A child row is plain text rather than a button: a subagent has no session of its own to open, so
 * the one control here is the count. Every cell truncates onto one line and carries its whole text as
 * a hover title, exactly as the session row does, and the live call of a running child rides in that
 * title rather than taking a line of its own.
 * - vendor: the parent's vendor, whose monogram the children share
 * - omitted: how many finished children the host's cap left out, named once the rest are expanded
 */
export interface AgentChildRowsProps {
    vendor: string;
    items: ReadonlyArray<ActivityChildSession>;
    omitted?: number;
}

function childTitleText(child: ActivityChildSession): string {
    const name = childDisplayName(child);
    const current = child.current;
    if (child.state !== 'working' || !current) { return name; }
    const arg = truncateActivityArg(current.arg, ACTIVITY_ARG_MAX_CHARS);
    const call = current.tool ? (arg ? `${current.tool} ${arg}` : current.tool) : (arg || current.kind);
    return `${name}\n${call}`;
}

function AgentChildRows(props: AgentChildRowsProps): React.ReactElement | null {
    const [expanded, setExpanded] = useState(false);
    const split = splitChildrenForDisplay(props.items);
    const now_ms = useAgentClockNow(props.items.some(child => childStateOf(child) !== 'ended'));
    if (props.items.length === 0) { return null; }
    const shown = expanded ? props.items : split.visible;
    const omitted = props.omitted ?? 0;
    return (
        <ul className={styles.agentChildren} data-testid="agent-children">
            {split.collapsed.length > 0 && (
                <li className={styles.agentChildToggleItem}>
                    <button
                        type="button"
                        className={styles.agentChildToggle}
                        data-testid="agent-children-toggle"
                        aria-expanded={expanded}
                        onClick={(event) => { event.stopPropagation(); setExpanded(open => !open); }}
                    >
                        {expanded
                            ? l10n.t('Hide {0} earlier finished subagents', split.collapsed.length)
                            : l10n.t('Show {0} earlier finished subagents', split.collapsed.length)}
                    </button>
                </li>
            )}
            {shown.map(child => {
                const state = childStateOf(child);
                const usage = formatActivityUsage(child.usage);
                const model = shortModelId(child.model);
                const clock = formatChildClock(child, now_ms);
                return (
                    <li key={child.child_id} className={styles.agentChild} data-state={state} data-testid="agent-child-row">
                        <span className={styles.agentRail} aria-hidden={true} />
                        <span className={styles.agentIdent}>
                            <span className={styles.agentMonogram} data-testid="agent-child-monogram" title={props.vendor}>{vendorMonogram(props.vendor)}</span>
                            <span className={styles.agentModel} data-testid="agent-child-model" title={child.model}>{model}</span>
                        </span>
                        <span className={styles.agentStatus}>
                            <span className={styles.agentState} data-testid="agent-child-state">{agentStateLabel(state)}</span>
                            <span className={styles.agentClock} data-testid="agent-child-clock" title={l10n.t('Ran from {0} to {1}', child.started_at, child.updated_at)}>{clock}</span>
                        </span>
                        <span className={styles.agentLive} data-testid="agent-child-title" title={childTitleText(child)}>{childDisplayName(child)}</span>
                        <span className={styles.agentUsage} data-testid="agent-child-usage" title={usage}>{usage}</span>
                    </li>
                );
            })}
            {expanded && omitted > 0 && (
                <li className={styles.agentChildNote} data-testid="agent-children-omitted">{l10n.t('{0} older finished subagents are not listed', omitted)}</li>
            )}
        </ul>
    );
}

export default React.memo(AgentChildRows);

import React from "react";
import * as l10n from "@vscode/l10n";
import { childDisplayName, childStateOf, formatActivityUsage, formatChildClock, shortModelId, splitChildrenForDisplay, truncateActivityArg, vendorMonogram } from "../../../lib/agentactivityops";
import { ACTIVITY_ARG_MAX_CHARS, type ActivityChildSession } from "../../../types/AgentActivity";
import AgentChevron from "./AgentChevron";
import { agentStateDrawn, agentStateLabel } from "./agentStateLabel";
import { useAgentClockNow } from "./useAgentClockNow";
import styles from "../AgentNote.module.scss";

/**
 * One expanded session's subagents, the group inside its tree item: each running child sits indented
 * on its own rail, coloured by the child's state, with one quiet header line: its vendor monogram and
 * title, how long it has run, then its model, and its tokens beside it. Like the session row, it draws
 * no state word for a working child. Every finished child waits behind one "Show N finished subagents"
 * item, which is itself a tree item that opens and closes, and a finished child dims.
 *
 * A child row is plain text rather than a button: a subagent has no session of its own to open, so
 * the one control here is the finished item. Every cell truncates onto one line and carries its whole
 * text as a hover title, exactly as the session row does, and the live call of a running child rides
 * in that title rather than taking a line of its own.
 * - vendor: the parent's vendor, whose monogram the children share
 * - omitted: how many finished children the host's cap left out, named once the finished ones are shown
 * - finished_open / onToggleFinished: owned by the session row, so the choice outlives the group being
 *   collapsed and drawn again
 */
export interface AgentChildRowsProps {
    vendor: string;
    items: ReadonlyArray<ActivityChildSession>;
    omitted?: number;
    finished_open: boolean;
    onToggleFinished: (open: boolean) => void;
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
    const split = splitChildrenForDisplay(props.items);
    const now_ms = useAgentClockNow(split.running.length > 0);
    if (props.items.length === 0) { return null; }
    const omitted = props.omitted ?? 0;
    const finished_open = props.finished_open;
    const drawChild = (child: ActivityChildSession): React.ReactElement => {
        const state = childStateOf(child);
        const usage = formatActivityUsage(child.usage);
        const model = shortModelId(child.model);
        const clock = formatChildClock(child, now_ms);
        return (
            <li key={child.child_id} role="treeitem" aria-level={2} aria-selected={false} className={styles.agentChild} data-state={state} data-testid="agent-child-row">
                <span className={styles.agentRail} aria-hidden={true} />
                <span className={styles.agentHeader}>
                    <span className={styles.agentIdent}>
                        <span className={styles.agentMonogram} data-testid="agent-child-monogram" title={props.vendor}>{vendorMonogram(props.vendor)}</span>
                        <span className={styles.agentName} data-testid="agent-child-title" title={childTitleText(child)}>{childDisplayName(child)}</span>
                    </span>
                    {agentStateDrawn(state)
                        ? <span className={styles.agentState} data-testid="agent-child-state">{agentStateLabel(state)}</span>
                        : <span className={styles.agentStateQuiet} data-testid="agent-child-state-quiet">{agentStateLabel(state)}</span>}
                    <span className={styles.agentClock} data-testid="agent-child-clock" title={l10n.t('Ran from {0} to {1}', child.started_at, child.updated_at)}>{clock}</span>
                    <span className={styles.agentModel} data-testid="agent-child-model" title={child.model}>{model}</span>
                </span>
                <span className={styles.agentUsage} data-testid="agent-child-usage" title={usage}>{usage}</span>
            </li>
        );
    };
    const toggleKey = (event: React.KeyboardEvent): void => {
        if (event.key === 'ArrowRight' && !finished_open) { event.preventDefault(); event.stopPropagation(); props.onToggleFinished(true); }
        if (event.key === 'ArrowLeft' && finished_open) { event.preventDefault(); event.stopPropagation(); props.onToggleFinished(false); }
    };
    return (
        <ul className={styles.agentChildren} role="group" data-testid="agent-children">
            {split.running.map(drawChild)}
            {split.finished.length > 0 && (
                <li role="treeitem" aria-level={2} aria-selected={false} aria-expanded={finished_open} className={styles.agentChildToggleItem} onKeyDown={toggleKey}>
                    <button
                        type="button"
                        className={styles.agentChildToggle}
                        data-testid="agent-children-toggle"
                        onClick={(event) => { event.stopPropagation(); props.onToggleFinished(!finished_open); }}
                    >
                        <AgentChevron open={finished_open} />
                        {finished_open
                            ? l10n.t('Hide {0} finished subagents', split.finished.length)
                            : l10n.t('Show {0} finished subagents', split.finished.length)}
                    </button>
                </li>
            )}
            {finished_open && split.finished.map(drawChild)}
            {finished_open && omitted > 0 && (
                <li role="none" className={styles.agentChildNote} data-testid="agent-children-omitted">{l10n.t('{0} older finished subagents are not listed', omitted)}</li>
            )}
        </ul>
    );
}

export default React.memo(AgentChildRows);

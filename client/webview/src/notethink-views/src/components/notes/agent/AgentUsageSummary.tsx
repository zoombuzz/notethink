import React, { useMemo } from "react";
import * as l10n from "@vscode/l10n";
import { activityUsageWindow, earliestCountedActivity, formatActivityUsage, totalActivityUsage, type ActivitySessionState, type ActivityStoryKey } from "../../../lib/agentactivityops";
import styles from "../AgentNote.module.scss";

/**
 * The story's own token and cost counter: the combined usage of every session drawn on this card, so
 * no separate figure needs shipping from the host.
 *
 * The span it states runs from the earliest activity it counts to now, capped at the analyser's 30 day
 * window, so a story begun two days ago reads "2d" rather than claiming a month of history.
 *
 * While scanning, the posted sessions are only a growing subset of the total, so the figure is
 * dimmed and marked busy for assistive tech - it must never read as final.
 * - storyKey: this card's join key, passed through to `totalActivityUsage` so a session bound to more
 *   than one story counts only its own split share here, not its whole-session usage on every one of
 *   them; undefined on a virtual note, whose one session has no story to split against
 * - scanning: true while the analyser's current pass has not yet posted its last batch
 * - now: the clock the span is measured against, for tests; the current time when omitted
 */
export interface AgentUsageSummaryProps {
    sessions: ReadonlyArray<ActivitySessionState>;
    storyKey?: ActivityStoryKey;
    scanning?: boolean;
    now?: number;
}

function AgentUsageSummary(props: AgentUsageSummaryProps): React.ReactElement | null {
    const usage = useMemo(() => totalActivityUsage(props.sessions, props.storyKey), [props.sessions, props.storyKey]);
    if (props.sessions.length === 0) { return null; }
    const window = activityUsageWindow(earliestCountedActivity(props.sessions, props.storyKey), props.now);
    return (
        <p className={styles.usageSummary} data-testid="agent-usage-summary"
           data-scanning={props.scanning ? 'true' : undefined}
           aria-busy={props.scanning ? 'true' : undefined}
           title={l10n.t('Tokens and estimated cost since the earliest agent activity on this story, over at most the last 30 days')}>
            {formatActivityUsage(usage, window)}
        </p>
    );
}

export default React.memo(AgentUsageSummary);

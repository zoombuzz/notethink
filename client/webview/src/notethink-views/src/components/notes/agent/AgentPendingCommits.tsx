import React from "react";
import * as l10n from "@vscode/l10n";
import styles from "../AgentNote.module.scss";

/**
 * The pending commits row: local commits not yet pushed, the count the branch is ahead of its
 * upstream. Grey with none (`No pending commits`) and in the "Waiting on you" colour with some
 * (`2 pending commits`), since unpushed work is the operator's next move. A branch with no upstream
 * has nothing to be ahead of, so it reads `No upstream` in grey.
 * - count: the ahead count, undefined when the branch has no upstream
 */
export interface AgentPendingCommitsProps {
    count: number | undefined;
}

function AgentPendingCommits(props: AgentPendingCommitsProps): React.ReactElement {
    const { count } = props;
    const pending = count !== undefined && count > 0;
    let label: string;
    if (count === undefined) { label = l10n.t('No upstream'); }
    else if (count === 0) { label = l10n.t('No pending commits'); }
    else { label = count === 1 ? l10n.t('1 pending commit') : l10n.t('{0} pending commits', String(count)); }
    return (
        <p className={styles.pendingCommits} data-testid="agent-pending-commits" data-pending={pending ? 'true' : 'false'}>{label}</p>
    );
}

export default React.memo(AgentPendingCommits);

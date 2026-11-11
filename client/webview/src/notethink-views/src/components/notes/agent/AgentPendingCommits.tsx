import React, { useState } from "react";
import * as l10n from "@vscode/l10n";
import AgentChevron from "./AgentChevron";
import { LineDiffCounts } from "./AgentFileBand";
import type { ActivityPendingCommit } from "../../../types/AgentActivity";
import styles from "../AgentNote.module.scss";

/**
 * The pending commits row: local commits not yet pushed, the count the branch is ahead of its
 * upstream. Grey with none (`No pending commits`) and in the "Waiting on you" colour with some
 * (`2 pending commits`), since unpushed work is the operator's next move. A branch with no upstream
 * has nothing to be ahead of, so it reads `No upstream` in grey.
 *
 * With pending commits and their detail read, the row unfolds like the uncommitted files row, collapsed
 * by default: the summary carries the green and red line totals (`2 pending commits +120 -34`) and the
 * unfolded list gives each commit's short hash and `N files`. The list is bounded, and a bounded one says
 * so (`Showing the latest 20 of 35 pending commits`) rather than reading as the whole branch. With no
 * detail (a packed object store, say) the row stays a plain line and does not unfold.
 * - count: the ahead count, undefined when the branch has no upstream
 * - detail: the newest pending commits, newest first; undefined or empty leaves the row non-expandable
 * - expanded, onToggleExpanded: the row's own expansion, held by the card beside the files row's and separate from it; without `onToggleExpanded` the row keeps its own
 */
export interface AgentPendingCommitsProps {
    count: number | undefined;
    detail?: ReadonlyArray<ActivityPendingCommit>;
    expanded?: boolean;
    onToggleExpanded?: (expanded: boolean) => void;
}

function labelFor(count: number | undefined): string {
    if (count === undefined) { return l10n.t('No upstream'); }
    if (count === 0) { return l10n.t('No pending commits'); }
    return count === 1 ? l10n.t('1 pending commit') : l10n.t('{0} pending commits', String(count));
}

function filesLabel(files: number): string {
    return files === 1 ? l10n.t('1 file') : l10n.t('{0} files', String(files));
}

// the summary's totals sum only commits the analyser diffed, never a guess for one it could not
function totalsFor(detail: ReadonlyArray<ActivityPendingCommit>): { added: number; removed: number; covered: number } | undefined {
    const diffed = detail.filter(commit => commit.added !== undefined && commit.removed !== undefined);
    if (diffed.length === 0) { return undefined; }
    return diffed.reduce((total, commit) => ({ added: total.added + (commit.added ?? 0), removed: total.removed + (commit.removed ?? 0), covered: total.covered + 1 }), { added: 0, removed: 0, covered: 0 });
}

function AgentPendingCommits(props: AgentPendingCommitsProps): React.ReactElement {
    const { count, detail } = props;
    const [own_expanded, setOwnExpanded] = useState(false);
    const pending = count !== undefined && count > 0;
    const label = labelFor(count);
    if (!pending || !detail || detail.length === 0) {
        return (
            <p className={pending ? styles.pendingCommits : styles.quietRow} data-testid="agent-pending-commits" data-pending={pending ? 'true' : 'false'}>{label}</p>
        );
    }
    const owner_toggle = props.onToggleExpanded;
    const expanded = owner_toggle ? props.expanded === true : own_expanded;
    const toggle = owner_toggle ?? setOwnExpanded;
    const totals = totalsFor(detail);
    const bounded = detail.length < count;
    const coverage = totals && (bounded || totals.covered < detail.length) ? l10n.t('Line counts cover {0} of {1} pending commits', String(totals.covered), String(count)) : undefined;
    return (
        <section className={`${styles.fileBand} ${styles.pendingCommitsBand}`} data-testid="agent-pending-commits" data-pending="true">
            <button
                type="button"
                className={styles.fileBandSummary}
                data-testid="agent-pending-commits-toggle"
                aria-expanded={expanded}
                title={coverage}
                onClick={(event) => { event.stopPropagation(); toggle(!expanded); }}
            >
                <AgentChevron open={expanded} />
                <span>{label}</span>
                {' '}
                {totals && <LineDiffCounts added={totals.added} removed={totals.removed} testid="agent-pending-commits-line-diff" />}
            </button>
            {expanded && (
                <>
                    <ul className={styles.fileRows}>
                        {detail.map(commit => (
                            <li key={commit.short_sha} className={styles.pendingCommitRow} data-testid="agent-pending-commit-row">
                                <span className={styles.commitSha}>{commit.short_sha}</span>
                                {commit.files !== undefined && <span className={styles.fileChange}>{filesLabel(commit.files)}</span>}
                            </li>
                        ))}
                    </ul>
                    {bounded && <p className={styles.fileDetailLine} data-testid="agent-pending-commits-bound">{l10n.t('Showing the latest {0} of {1} pending commits', String(detail.length), String(count))}</p>}
                </>
            )}
        </section>
    );
}

export default React.memo(AgentPendingCommits);

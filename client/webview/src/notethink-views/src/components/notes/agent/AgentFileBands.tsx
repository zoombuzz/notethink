import React from "react";
import * as l10n from "@vscode/l10n";
import AgentFileBand from "./AgentFileBand";
import AgentPendingCommits from "./AgentPendingCommits";
import { ACTIVITY_BAND_UNCOMMITTED, type ActivityBand, type ActivityUnavailable } from "../../../lib/agentactivityops";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * The working tree's uncommitted summary: one row, `5 uncommitted files +120 -34`, collapsed by default
 * and unfolding to every changed file, each openable as a diff. With nothing uncommitted it reads
 * `No uncommitted files` and does not unfold, because "nothing uncommitted" is a different statement
 * from a row left off the card. Under it sits the pending commits row, except that with nothing
 * uncommitted and nothing pending (or no upstream) the two fold into one quiet line. The model still carries the
 * branch's commits and `AgentCommitBand` can draw them; the card leaves that band off because a
 * long-lived branch lists every commit since it forked, which buries the story's own activity.
 * - expanded, onToggleExpanded: the card's own expansion of the files row
 * - pendingExpanded, onTogglePendingExpanded: the same kind of expansion for the pending commits row, held separately so each row opens on its own
 */
export interface AgentFileBandsProps {
    model: AgentNoteModel;
    unavailable: ActivityUnavailable | undefined;
    onOpenDiff: (path: string, band: ActivityBand) => void;
    expanded?: boolean;
    onToggleExpanded?: (expanded: boolean) => void;
    pendingExpanded?: boolean;
    onTogglePendingExpanded?: (expanded: boolean) => void;
}

// the header's +added/-removed sums only entries the analyser actually diffed, never guessed for one it skipped
function totalLineDiffFor(entries: AgentFileBandsProps['model']['uncommitted']): { added: number; removed: number } | undefined {
    const diffed = entries.filter(entry => entry.file.added !== undefined && entry.file.removed !== undefined);
    if (diffed.length === 0) { return undefined; }
    return diffed.reduce((total, entry) => ({ added: total.added + (entry.file.added ?? 0), removed: total.removed + (entry.file.removed ?? 0) }), { added: 0, removed: 0 });
}

// the one line for a card with nothing uncommitted and nothing to push, or no upstream to push to
function quietLineFor(model: AgentNoteModel): string | undefined {
    if (model.uncommitted.length > 0 || !model.has_git_tree) { return undefined; }
    if (model.pending_commits === undefined) { return l10n.t('No uncommitted files, no upstream'); }
    if (model.pending_commits === 0) { return l10n.t('No uncommitted files or pending commits'); }
    return undefined;
}

function AgentFileBands(props: AgentFileBandsProps): React.ReactElement {
    const uncommitted_count = props.model.uncommitted.length;
    const quiet_line = quietLineFor(props.model);
    if (quiet_line !== undefined) {
        return (
            <div className={styles.fileBands} data-testid="agent-file-bands">
                <p className={styles.quietRow} data-testid="agent-file-bands-empty">{quiet_line}</p>
            </div>
        );
    }
    const pending = props.model.has_git_tree && <AgentPendingCommits count={props.model.pending_commits} detail={props.model.pending_detail} expanded={props.pendingExpanded} onToggleExpanded={props.onTogglePendingExpanded} />;
    if (uncommitted_count === 0) {
        return (
            <div className={styles.fileBands} data-testid="agent-file-bands">
                <p className={styles.quietRow} data-testid="agent-file-bands-empty">{l10n.t('No uncommitted files')}</p>
                {pending}
            </div>
        );
    }
    const total_line_diff = totalLineDiffFor(props.model.uncommitted);
    const counted = props.model.uncommitted.filter(entry => entry.file.added !== undefined && entry.file.removed !== undefined).length;
    return (
        <div className={styles.fileBands} data-testid="agent-file-bands">
            <AgentFileBand
                title={uncommitted_count === 1 ? l10n.t('1 uncommitted file') : l10n.t('{0} uncommitted files', String(uncommitted_count))}
                band={ACTIVITY_BAND_UNCOMMITTED}
                entries={props.model.uncommitted}
                unavailable={props.unavailable}
                onOpenDiff={props.onOpenDiff}
                totalLineDiff={total_line_diff}
                coverageTitle={counted < uncommitted_count ? l10n.t('Line counts cover {0} of {1} files', String(counted), String(uncommitted_count)) : undefined}
                expanded={props.expanded}
                onToggleExpanded={props.onToggleExpanded}
            />
            {pending}
        </div>
    );
}

export default React.memo(AgentFileBands);

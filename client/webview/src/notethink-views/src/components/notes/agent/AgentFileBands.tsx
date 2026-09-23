import React from "react";
import * as l10n from "@vscode/l10n";
import AgentFileBand from "./AgentFileBand";
import { ACTIVITY_BAND_UNCOMMITTED, type ActivityBand, type ActivityUnavailable } from "../../../lib/agentactivityops";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/*
 * The number of uncommitted rows the card draws before folding the rest into one "and N more" line.
 * The design caps the band at 3 so a busy repository does not grow the card without bound. The cap
 * is display-only: "and N more" unfolds the rest into the card, and "Show less" folds them back.
 */
const UNCOMMITTED_ROW_LIMIT = 3;

/**
 * The working tree's uncommitted band: changed and not yet committed, each openable as a diff. An
 * empty band still says so, because "nothing uncommitted" is a different statement from a band that was
 * left off the card, but says it as one muted line so an idle story does not spend a header and a body
 * on it. The model still carries the branch's commits and `AgentCommitBand` can draw them; the card
 * leaves that band off because a long-lived branch lists every commit since it forked, which buries the
 * story's own activity.
 * - expanded, onToggleExpanded: the card's own expansion, passed through to unfold the capped band
 */
export interface AgentFileBandsProps {
    model: AgentNoteModel;
    unavailable: ActivityUnavailable | undefined;
    onOpenDiff: (path: string, band: ActivityBand) => void;
    expanded?: boolean;
    onToggleExpanded?: (expanded: boolean) => void;
}

// the header's own +added -removed: summed only across entries the analyser actually diffed, never guessed for one it declined or never reached
function totalLineDiffFor(entries: AgentFileBandsProps['model']['uncommitted']): { added: number; removed: number } | undefined {
    const diffed = entries.filter(entry => entry.file.added !== undefined && entry.file.removed !== undefined);
    if (diffed.length === 0) { return undefined; }
    return diffed.reduce((total, entry) => ({ added: total.added + (entry.file.added ?? 0), removed: total.removed + (entry.file.removed ?? 0) }), { added: 0, removed: 0 });
}

function AgentFileBands(props: AgentFileBandsProps): React.ReactElement {
    const uncommitted_count = props.model.uncommitted.length;
    if (uncommitted_count === 0) {
        return (
            <div className={styles.fileBands} data-testid="agent-file-bands">
                <p className={styles.fileBandEmpty} data-testid="agent-file-bands-empty">{l10n.t('Nothing uncommitted')}</p>
            </div>
        );
    }
    return (
        <div className={styles.fileBands} data-testid="agent-file-bands">
            <AgentFileBand
                title={l10n.t('{0} uncommitted', String(uncommitted_count))}
                band={ACTIVITY_BAND_UNCOMMITTED}
                entries={props.model.uncommitted}
                emptyLabel={l10n.t('Nothing uncommitted')}
                unavailable={props.unavailable}
                onOpenDiff={props.onOpenDiff}
                maxRows={UNCOMMITTED_ROW_LIMIT}
                totalLineDiff={totalLineDiffFor(props.model.uncommitted)}
                expanded={props.expanded}
                onToggleExpanded={props.onToggleExpanded}
            />
        </div>
    );
}

export default React.memo(AgentFileBands);

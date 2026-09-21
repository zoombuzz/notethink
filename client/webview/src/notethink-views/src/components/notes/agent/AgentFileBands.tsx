import React from "react";
import * as l10n from "@vscode/l10n";
import AgentFileBand from "./AgentFileBand";
import { ACTIVITY_BAND_COMMITTED, ACTIVITY_BAND_UNCOMMITTED, type ActivityBand, type ActivityUnavailable } from "../../../lib/agentactivityops";
import type { AgentNoteModel } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * The working tree in the two bands the contract writes it in: changed and not yet committed, and
 * changed by commits on this branch. Both are drawn even when empty, because "nothing uncommitted" is
 * a different statement from a band that was left off the card.
 *
 * A producer that does not run git declares `tree_state` unsupported and writes no tree at all, which
 * arrives here as two empty bands; the card leaves them off in that case by not rendering this
 * component when there is no session to attribute anything to.
 */
export interface AgentFileBandsProps {
    model: AgentNoteModel;
    unavailable: ActivityUnavailable | undefined;
    onOpenDiff: (path: string, band: ActivityBand) => void;
}

function AgentFileBands(props: AgentFileBandsProps): React.ReactElement {
    return (
        <div className={styles.fileBands} data-testid="agent-file-bands">
            <AgentFileBand
                title={l10n.t('Uncommitted')}
                band={ACTIVITY_BAND_UNCOMMITTED}
                entries={props.model.uncommitted}
                emptyLabel={l10n.t('Nothing uncommitted')}
                unavailable={props.unavailable}
                onOpenDiff={props.onOpenDiff}
            />
            <AgentFileBand
                title={l10n.t('Committed on this branch')}
                band={ACTIVITY_BAND_COMMITTED}
                entries={props.model.committed}
                emptyLabel={l10n.t('Nothing committed on this branch')}
                unavailable={props.unavailable}
                onOpenDiff={props.onOpenDiff}
            />
        </div>
    );
}

export default React.memo(AgentFileBands);

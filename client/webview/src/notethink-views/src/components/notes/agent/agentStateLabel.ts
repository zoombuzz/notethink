import * as l10n from "@vscode/l10n";
import type { ActivityState } from "../../../types/AgentActivity";

/** the state's own word, so a colour-blind reader and a screen reader both get the state in text; shared by the row and the card's own meta-row chip so the two never disagree */
export function agentStateLabel(state: ActivityState): string {
    switch (state) {
        case 'working': return l10n.t('Working');
        case 'waiting': return l10n.t('Waiting on you');
        case 'idle': return l10n.t('Idle');
        case 'ended': return l10n.t('Ended');
        default: return l10n.t('State not reported');
    }
}

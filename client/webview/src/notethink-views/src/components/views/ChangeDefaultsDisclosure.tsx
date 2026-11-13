import type { ReactElement, ReactNode } from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";
import { divergedCountLabel } from "./settingRows";

/**
 * ChangeDefaultsDisclosureProps.
 * - divergedCount: how many of the settings the hosting drawer shows differ from their saved default; the
 *   caller counts them, because only it knows which keys its drawer covers
 * - children: further actions for the hosting drawer alone, rendered after the two shared buttons
 */
interface ChangeDefaultsDisclosureProps {
    divergedCount: number;
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    canResetToDefault?: boolean;
    children?: ReactNode;
}

/**
 * The default actions of every drawer that offers them, collapsed behind one disclosure so the drawer
 * leads with its settings rather than with a row of buttons. Both buttons drive the diverged count to
 * zero: saving promotes every value to the user scope, reverting clears the workspace scope, and each is
 * disabled while it would do nothing - saving needs something to have diverged, reverting needs a
 * workspace override to clear. The panel therefore never offers an action it cannot carry out, which is
 * what the tally beside its name is for. Both actions reach every NoteThink setting whichever drawer
 * hosts them; only the tally is scoped to the settings the host shows. Restoring the built-in defaults is
 * deliberately not part of the shared panel: the Files drawer passes it as a child, which is where a
 * wiped filter has to be recoverable from.
 */
export default function ChangeDefaultsDisclosure(props: ChangeDefaultsDisclosureProps): ReactElement {
    return (
        <details className={styles.settingsChangeDefaults} data-testid="change-defaults">
            <summary data-testid="change-defaults-summary">
                <span className={styles.settingsChangeDefaultsLabel}>{l10n.t('Change defaults')}</span>
                {' '}
                <span className={styles.settingsDivergedTally} data-testid="diverged-count">
                    ({divergedCountLabel(props.divergedCount)})
                </span>
            </summary>
            <div className={styles.settingsDisclosureBody}>
                <p className={styles.settingsDivergedNote}>
                    {props.divergedCount === 0
                        ? l10n.t('Nothing here differs from your saved defaults.')
                        : l10n.t('Settings diverged from the defaults and are already saved')}
                </p>
                <div className={styles.settingsDisclosureActions}>
                    <button
                        type="button"
                        data-testid="save-as-default"
                        onClick={props.onMakeDefault}
                        disabled={props.divergedCount === 0}
                        title={l10n.t('Save every current setting as your default across every VS Code window.')}
                    >
                        {l10n.t('Save as user default')}
                    </button>
                    <button
                        type="button"
                        data-testid="revert-to-defaults"
                        onClick={props.onResetToDefault}
                        disabled={!props.canResetToDefault}
                        title={l10n.t("Clear this workspace's overrides and fall back to your defaults.")}
                    >
                        {l10n.t('Revert to user default')}
                    </button>
                    {props.children}
                </div>
            </div>
        </details>
    );
}

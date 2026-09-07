import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";

interface SettingsCascadeButtonsProps {
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    canResetToDefault?: boolean;
    onRestoreBuiltinDefault: () => void;
    canRestoreBuiltinDefault?: boolean;
}

/**
 * Workspace to user cascade controls, mounted in the Files drawer's meta column. All three actions
 * reach EVERY NoteThink setting rather than the drawer they sit in: each posts a bare message the
 * extension applies over settingKeys(), so a view setting and a card setting move with the file
 * filters. That whole-cascade scope is what separates them from the per-setting controls (the
 * per-row revert, the group-order reset) that live beside the rows themselves.
 *
 * "Reset to user default" clears Workspace overrides only (falls back to the User
 * value); "Reset to built-in default" clears Workspace AND User overrides (falls
 * back to NoteThink's shipped defaults) - the recovery path when the user default
 * itself has been edited away, e.g. a wiped exclude filter that's painful to retype.
 */
export default function SettingsCascadeButtons(props: SettingsCascadeButtonsProps): ReactElement {
    return (
        <div data-testid="folder-view-cascade-controls" className={styles.cascadeControls}>
            <button
                type="button"
                onClick={props.onMakeDefault}
                title={l10n.t('Save every current NoteThink setting as your user default across every VS Code window.')}
            >
                {l10n.t('Make user default')}
            </button>
            <button
                type="button"
                onClick={props.onResetToDefault}
                disabled={!props.canResetToDefault}
                title={l10n.t("Clear this workspace's NoteThink overrides and fall back to your user defaults.")}
            >
                {l10n.t('Reset to user default')}
            </button>
            <button
                type="button"
                onClick={props.onRestoreBuiltinDefault}
                disabled={!props.canRestoreBuiltinDefault}
                title={l10n.t("Clear both this workspace's and your user overrides for every NoteThink setting and restore the built-in defaults.")}
            >
                {l10n.t('Reset to built-in default')}
            </button>
        </div>
    );
}

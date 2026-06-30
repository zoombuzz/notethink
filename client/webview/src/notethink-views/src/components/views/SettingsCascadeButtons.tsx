import Debug from "debug";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:SettingsCascadeButtons");

interface SettingsCascadeButtonsProps {
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    canResetToDefault?: boolean;
    onRestoreBuiltinDefault: () => void;
    canRestoreBuiltinDefault?: boolean;
}

/**
 * Workspace ↔ user cascade controls, rendered in the bottom-right meta column of
 * every drawer for visual consistency. All three actions affect every folder-view
 * setting (not just the drawer the buttons happen to sit in) - they are global
 * to the folder-view cascade, intentionally separated from per-setting controls
 * (e.g. column-order reset) that live on the left.
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
                title={l10n.t('Save your current folder view settings as your user default across every VS Code window.')}
            >
                {l10n.t('Make user default')}
            </button>
            <button
                type="button"
                onClick={props.onResetToDefault}
                disabled={!props.canResetToDefault}
                title={l10n.t("Clear this workspace's folder view overrides and fall back to your user default.")}
            >
                {l10n.t('Reset to user default')}
            </button>
            <button
                type="button"
                onClick={props.onRestoreBuiltinDefault}
                disabled={!props.canRestoreBuiltinDefault}
                title={l10n.t("Clear both this workspace's and your user folder view overrides and restore NoteThink's built-in defaults.")}
            >
                {l10n.t('Reset to built-in default')}
            </button>
        </div>
    );
}

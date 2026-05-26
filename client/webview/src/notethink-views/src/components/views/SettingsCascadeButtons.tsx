import Debug from "debug";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:SettingsCascadeButtons");

interface SettingsCascadeButtonsProps {
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    canResetToDefault?: boolean;
}

/**
 * Workspace ↔ user cascade controls, rendered in the bottom-right meta column of
 * every drawer for visual consistency. Both actions affect every folder-view
 * setting (not just the drawer the buttons happen to sit in) — they are global
 * to the folder-view cascade, intentionally separated from per-setting controls
 * (e.g. column-order reset) that live on the left.
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
        </div>
    );
}

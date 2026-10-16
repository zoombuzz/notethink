import React from "react";
import * as l10n from "@vscode/l10n";
import type { ReactNode } from "react";
import styles from "../ViewRenderer.module.scss";

/**
 * One settings row, laid out as the five columns the drawer aligns: the name, the inherited-or-specific
 * pill, the diverged (M) pill, the control, and the pill naming the view the effective value comes
 * from. The row is `display: contents`, so its five cells join the pane's own grid rather than forming
 * a row box of their own - that is what keeps names and controls aligned down the whole list instead of
 * per row, and it is why a caller must render these inside a five-column grid.
 *
 * It carries no knowledge of what a setting means or which axis it belongs to, so the card drawer
 * renders its rows through this same component with "Card type" over the last column; the card drawer
 * has no per-view map, so it never passes `inheritedFrom` / `specificFrom`.
 *
 * Every cell is always emitted, because a missing one would shift every later cell into the wrong
 * column, but a pill is only NAMED (given a testid) when it says something, so a test asking for one is
 * asking whether it is there rather than what it happens to contain.
 * - rowKey: the setting key this row writes; the suffix on every testid the row publishes
 * - ownerLabel: the view the effective value comes from, omitted for a setting that belongs to no view type (a global)
 * - diverged: the value differs from its saved default, so the row takes the M pill and a modified tint
 * - inheritedFrom: the view label the value is inherited from; renders the grey eye pill. Omitted at the
 *   setting's own home view and whenever the selected view genuinely stores its own value.
 * - inheritedIsBuiltinDefault: true when `inheritedFrom` names a node supplying the value from its own
 *   built-in default rather than something saved - the hover then names it as that node's built-in
 *   default instead of saying "inherited from" a node that holds nothing.
 * - specificFrom: the view label the selected view would inherit from if cleared; renders the white VS
 *   pill. Omitted unless the selected view genuinely stores its own value away from the setting's home.
 */
export interface SettingsRowProps {
    rowKey: string;
    label: string;
    control: ReactNode;
    ownerLabel?: string;
    diverged?: boolean;
    inheritedFrom?: string;
    inheritedIsBuiltinDefault?: boolean;
    specificFrom?: string;
}

/** a small inline eye, since the webview has no icon font to reach for */
function EyeGlyph(): React.ReactElement {
    return (
        <svg viewBox="0 0 16 16" width="0.9em" height="0.9em" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M8 3.5c-3.2 0-5.6 2.1-6.9 4.1a.6.6 0 0 0 0 .8C2.4 10.4 4.8 12.5 8 12.5s5.6-2.1 6.9-4.1a.6.6 0 0 0 0-.8C13.6 5.6 11.2 3.5 8 3.5Zm0 7.2A2.7 2.7 0 1 1 8 5.3a2.7 2.7 0 0 1 0 5.4Z"
            />
        </svg>
    );
}

function SettingsRow(props: SettingsRowProps): React.ReactElement {
    const diverged_classes = props.diverged ? [styles.settingsRowDiverged] : [];
    return (
        <div
            className={styles.settingsRow}
            data-testid={`setting-row-${props.rowKey}`}
            data-diverged={props.diverged ? 'true' : 'false'}
        >
            <span className={[styles.settingsRowName, ...diverged_classes].join(' ')}>{props.label}</span>
            <span className={styles.settingsRowState}>
                {props.inheritedFrom !== undefined && (
                    <span
                        className={styles.settingsPillInherited}
                        data-testid={`setting-pill-inherited-${props.rowKey}`}
                        title={props.inheritedIsBuiltinDefault
                            ? l10n.t("{0}'s built-in default", props.inheritedFrom)
                            : l10n.t('Inherited from {0}', props.inheritedFrom)}
                    >
                        <EyeGlyph />
                    </span>
                )}
                {props.specificFrom !== undefined && (
                    <span
                        className={styles.settingsPillSpecific}
                        data-testid={`setting-pill-specific-${props.rowKey}`}
                        title={l10n.t('Specific to this view; set it to the inherited value to inherit from {0} again', props.specificFrom)}
                    >
                        {l10n.t('VS')}
                    </span>
                )}
            </span>
            <span className={styles.settingsRowMarker}>
                {props.diverged && (
                    <span
                        className={styles.settingsPillDiverged}
                        data-testid={`setting-marker-${props.rowKey}`}
                        title={l10n.t('Differs from your saved user default')}
                    >
                        {l10n.t('M')}
                    </span>
                )}
            </span>
            <div className={styles.settingsRowControl}>{props.control}</div>
            <span className={styles.settingsRowPill} data-testid={props.ownerLabel === undefined ? undefined : `setting-pill-${props.rowKey}`}>
                {props.ownerLabel ?? ''}
            </span>
        </div>
    );
}

export default React.memo(SettingsRow);

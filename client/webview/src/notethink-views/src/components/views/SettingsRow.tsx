import React from "react";
import * as l10n from "@vscode/l10n";
import type { ReactNode } from "react";
import styles from "../ViewRenderer.module.scss";

/**
 * One settings row, laid out as the four columns the drawer aligns: the diverged marker, the setting's
 * name, its control, and the pill naming the type that owns it. The row is `display: contents`, so its
 * four cells join the pane's own grid rather than forming a row box of their own - that is what keeps
 * names and controls aligned down the whole list instead of per row, and it is why a caller must render
 * these inside a four-column grid.
 *
 * It carries no knowledge of what a setting means or which axis it belongs to, so the card drawer
 * renders its rows through this same component with "Card type" over the last column.
 *
 * All four cells are always emitted, because a missing one would shift every later cell into the wrong
 * column, but the marker and the pill are only NAMED when they say something: a row with nothing to
 * report publishes no marker testid and a row belonging to no type publishes no pill testid, so a test
 * asking for one is asking whether it is there rather than what it happens to contain.
 * - rowKey: the setting key this row writes; the suffix on every testid the row publishes
 * - ownerLabel: the owning type's name, omitted for a setting that belongs to no type (a global)
 * - diverged: the value differs from its saved default, so the row takes an M and the modified tint
 */
export interface SettingsRowProps {
    rowKey: string;
    label: string;
    control: ReactNode;
    ownerLabel?: string;
    diverged?: boolean;
}

function SettingsRow(props: SettingsRowProps): React.ReactElement {
    const diverged_classes = props.diverged ? [styles.settingsRowDiverged] : [];
    return (
        <div
            className={styles.settingsRow}
            data-testid={`setting-row-${props.rowKey}`}
            data-diverged={props.diverged ? 'true' : 'false'}
        >
            <span
                className={[styles.settingsRowMarker, ...diverged_classes].join(' ')}
                data-testid={props.diverged ? `setting-marker-${props.rowKey}` : undefined}
                title={props.diverged ? l10n.t('Modified from the saved default') : undefined}
            >
                {props.diverged ? 'M' : ''}
            </span>
            <span className={[styles.settingsRowName, ...diverged_classes].join(' ')}>{props.label}</span>
            <div className={styles.settingsRowControl}>{props.control}</div>
            <span className={styles.settingsRowPill} data-testid={props.ownerLabel === undefined ? undefined : `setting-pill-${props.rowKey}`}>
                {props.ownerLabel ?? ''}
            </span>
        </div>
    );
}

export default React.memo(SettingsRow);

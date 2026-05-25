import Debug from "debug";
import React, { useCallback } from "react";
import * as l10n from "@vscode/l10n";
import { formatColumnLabel } from "../../lib/noteops";
import styles from "../ViewRenderer.module.scss";
import SettingsCommonControls, { type CommonSettings, type CommonSettingKey } from "./SettingsCommonControls";
import type { GlobalSettingKey } from "../../types/Messages";

const debug = Debug("nodejs:notethink-views:SettingsKanbanDrawer");

declare const NOTETHINK_VERSION: string | undefined;

export interface KanbanSettings extends CommonSettings {
    column_order?: string[];
}

interface SettingsKanbanDrawerProps {
    settings: KanbanSettings;
    naturalColumnOrder: string[];
    showLineNumbers?: boolean;
    watchUnopenedFilesInViewer?: boolean;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: GlobalSettingKey, value: boolean) => void;
    onColumnOrderChange: (next_order: string[]) => void;
    onMakeDefault?: () => void;
    onResetToDefault?: () => void;
    canResetToDefault?: boolean;
}

function SettingsKanbanDrawer(props: SettingsKanbanDrawerProps): React.ReactElement {

    // every column the board shows must be reorderable here: start from the saved order, then append any live column (a new status like testing, or untagged) not yet in it — otherwise a status absent from a stale saved order is unreachable in this list
    const saved_order = props.settings.column_order;
    const ordered_columns: string[] = (saved_order && saved_order.length > 0)
        ? [...saved_order, ...props.naturalColumnOrder.filter(value => !saved_order.includes(value))]
        : props.naturalColumnOrder;

    const handleMoveUp = useCallback((index: number) => {
        if (index <= 0) { return; }
        const next = [...ordered_columns];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        props.onColumnOrderChange(next);
    }, [ordered_columns, props]);

    const handleMoveDown = useCallback((index: number) => {
        if (index >= ordered_columns.length - 1) { return; }
        const next = [...ordered_columns];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        props.onColumnOrderChange(next);
    }, [ordered_columns, props]);

    const handleResetOrder = useCallback(() => {
        props.onColumnOrderChange([...props.naturalColumnOrder]);
    }, [props]);

    return (
        <div className={styles.settingsDrawerBody} data-testid="settings-drawer-kanban">
            <div className={styles.settingsDrawerGroups}>
                <section className={styles.settingsDrawerGroup}>
                    <p><strong>{l10n.t('Column order')}</strong></p>
                    <ul className={styles.settingsDrawerColumnOrder}>
                        {ordered_columns.map((column_name, index) => {
                            const formatted_label = formatColumnLabel(column_name);
                            return (
                                <li key={column_name}>
                                    <button
                                        type="button"
                                        disabled={index === 0}
                                        onClick={() => handleMoveUp(index)}
                                        aria-label={l10n.t('Move {0} up', formatted_label)}
                                    >&#9650;</button>
                                    <button
                                        type="button"
                                        disabled={index === ordered_columns.length - 1}
                                        onClick={() => handleMoveDown(index)}
                                        aria-label={l10n.t('Move {0} down', formatted_label)}
                                        style={{ marginLeft: '0.25em' }}
                                    >&#9660;</button>
                                    <span>{formatted_label}</span>
                                </li>
                            );
                        })}
                    </ul>
                    <p>
                        <button type="button" onClick={handleResetOrder}>{l10n.t('Reset order')}</button>
                    </p>
                </section>

                <section className={styles.settingsDrawerGroup}>
                    <SettingsCommonControls
                        settings={props.settings}
                        showLineNumbers={props.showLineNumbers}
                        watchUnopenedFilesInViewer={props.watchUnopenedFilesInViewer}
                        onSettingChange={props.onSettingChange}
                        onGlobalSettingChange={props.onGlobalSettingChange}
                        onMakeDefault={props.onMakeDefault}
                        onResetToDefault={props.onResetToDefault}
                        canResetToDefault={props.canResetToDefault}
                    />
                </section>
            </div>

            <aside className={styles.settingsDrawerMeta}>
                <h3>{l10n.t('Kanban Settings')}</h3>
                <p className={styles.settingsDrawerVersion} data-testid="version-label">
                    NoteThink v{typeof NOTETHINK_VERSION !== 'undefined' ? NOTETHINK_VERSION : 'dev'}
                    {' '}(ext: {(window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ as string || '?'})
                </p>
            </aside>
        </div>
    );
}

export default React.memo(SettingsKanbanDrawer);

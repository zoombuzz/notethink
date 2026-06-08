import Debug from "debug";
import React from "react";
import * as l10n from "@vscode/l10n";
import styles from "../../ViewRenderer.module.scss";
import SettingsCommonControls, { type CommonSettings, type CommonSettingKey } from "../SettingsCommonControls";
import SettingsCascadeButtons from "../SettingsCascadeButtons";
import type { GlobalSettingKey } from "../../../types/Messages";

const debug = Debug("nodejs:notethink-views:SettingsDocumentDrawer");

declare const NOTETHINK_VERSION: string | undefined;

export type DocumentSettings = CommonSettings;

interface SettingsDocumentDrawerProps {
    settings: DocumentSettings;
    showLineNumbers?: boolean;
    watchUnopenedFilesInViewer?: boolean;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: GlobalSettingKey, value: boolean) => void;
    onMakeDefault?: () => void;
    onResetToDefault?: () => void;
    canResetToDefault?: boolean;
}

function SettingsDocumentDrawer(props: SettingsDocumentDrawerProps): React.ReactElement {
    return (
        <div className={styles.drawerBody} data-testid="settings-drawer-document">
            <div className={styles.drawerGroups}>
                <section className={styles.drawerGroup}>
                    <SettingsCommonControls
                        settings={props.settings}
                        showLineNumbers={props.showLineNumbers}
                        watchUnopenedFilesInViewer={props.watchUnopenedFilesInViewer}
                        onSettingChange={props.onSettingChange}
                        onGlobalSettingChange={props.onGlobalSettingChange}
                    />
                </section>
            </div>

            <aside className={styles.drawerMeta}>
                <h3>{l10n.t('Document Settings')}</h3>
                <p className={styles.settingsDrawerVersion} data-testid="version-label">
                    NoteThink v{typeof NOTETHINK_VERSION !== 'undefined' ? NOTETHINK_VERSION : 'dev'}
                    {' '}(ext: {(window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ as string || '?'})
                </p>
                {props.onMakeDefault && props.onResetToDefault && (
                    <SettingsCascadeButtons
                        onMakeDefault={props.onMakeDefault}
                        onResetToDefault={props.onResetToDefault}
                        canResetToDefault={props.canResetToDefault}
                    />
                )}
            </aside>
        </div>
    );
}

export default React.memo(SettingsDocumentDrawer);

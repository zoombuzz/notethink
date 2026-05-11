import Debug from "debug";
import React from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";
import SettingsCommonControls, { type CommonSettings, type CommonSettingKey } from "./SettingsCommonControls";

const debug = Debug("nodejs:notethink-views:SettingsDocumentDrawer");

declare const NOTETHINK_VERSION: string | undefined;

export type DocumentSettings = CommonSettings;

interface SettingsDocumentDrawerProps {
    settings: DocumentSettings;
    showLineNumbers?: boolean;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: 'show_line_numbers', value: boolean) => void;
}

function SettingsDocumentDrawer(props: SettingsDocumentDrawerProps) {
    return (
        <div className={styles.settingsDrawerBody} data-testid="settings-drawer-document">
            <div className={styles.settingsDrawerGroups}>
                <section className={styles.settingsDrawerGroup}>
                    <SettingsCommonControls
                        settings={props.settings}
                        showLineNumbers={props.showLineNumbers}
                        onSettingChange={props.onSettingChange}
                        onGlobalSettingChange={props.onGlobalSettingChange}
                    />
                </section>
            </div>

            <aside className={styles.settingsDrawerMeta}>
                <h3>{l10n.t('Document Settings')}</h3>
                <p className={styles.settingsDrawerVersion} data-testid="version-label">
                    NoteThink v{typeof NOTETHINK_VERSION !== 'undefined' ? NOTETHINK_VERSION : 'dev'}
                    {' '}(ext: {(window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ as string || '?'})
                </p>
            </aside>
        </div>
    );
}

export default React.memo(SettingsDocumentDrawer);

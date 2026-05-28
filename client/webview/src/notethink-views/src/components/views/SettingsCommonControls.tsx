import Debug from "debug";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { usePendingWorkContext } from "../../hooks/PendingWorkContext";
import Spinner from "../Spinner";
import type { GlobalSettingKey } from "../../types/Messages";

const debug = Debug("nodejs:notethink-views:SettingsCommonControls");

export interface CommonSettings {
    showLinetagsInHeadlines?: boolean;
    scrollNoteIntoView?: boolean;
    autoExpandFocusedNote?: boolean;
}

export type CommonSettingKey = keyof CommonSettings;

interface SettingsCommonControlsProps {
    settings: CommonSettings;
    showLineNumbers?: boolean;
    watchUnopenedFilesInViewer?: boolean;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: GlobalSettingKey, value: boolean) => void;
}

export default function SettingsCommonControls(props: SettingsCommonControlsProps): ReactElement {
    const show_linetags = props.settings.showLinetagsInHeadlines ?? false;
    const scroll_into_view = props.settings.scrollNoteIntoView ?? false;
    const auto_expand = props.settings.autoExpandFocusedNote ?? false;
    const line_numbers = props.showLineNumbers ?? false;
    // default true matches the extension-side default (notethink.watchUnopenedFilesInViewer)
    const watch_unopened = props.watchUnopenedFilesInViewer ?? true;
    const { pending } = usePendingWorkContext();

    return (
        <>
            {pending && (
                <p data-testid="settings-drawer-spinner">
                    <Spinner positionClass="InlineLoader" ariaLabel={l10n.t('Working')} />
                    <span>{' '}{l10n.t('Applying...')}</span>
                </p>
            )}
            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={show_linetags}
                        onChange={(e) => props.onSettingChange('showLinetagsInHeadlines', e.target.checked)}
                    />
                    {' '}{l10n.t('Show linetags in headlines')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={scroll_into_view}
                        onChange={(e) => props.onSettingChange('scrollNoteIntoView', e.target.checked)}
                    />
                    {' '}{l10n.t('Scroll note into view')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={auto_expand}
                        onChange={(e) => props.onSettingChange('autoExpandFocusedNote', e.target.checked)}
                    />
                    {' '}{l10n.t('Auto-expand focused note')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={line_numbers}
                        onChange={(e) => props.onGlobalSettingChange('showLineNumbers', e.target.checked)}
                    />
                    {' '}{l10n.t('Show line numbers')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={watch_unopened}
                        onChange={(e) => props.onGlobalSettingChange('watchUnopenedFilesInViewer', e.target.checked)}
                    />
                    {' '}{l10n.t('Watch unopened files in viewer')}
                </label>
            </p>
        </>
    );
}

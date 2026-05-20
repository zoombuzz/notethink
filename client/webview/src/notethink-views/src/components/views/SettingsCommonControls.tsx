import Debug from "debug";
import * as l10n from "@vscode/l10n";
import type { GlobalSettingKey } from "../../types/Messages";

const debug = Debug("nodejs:notethink-views:SettingsCommonControls");

export interface CommonSettings {
    show_linetags_in_headlines?: boolean;
    scroll_note_into_view?: boolean;
    auto_expand_focused_note?: boolean;
}

export type CommonSettingKey = keyof CommonSettings;

interface SettingsCommonControlsProps {
    settings: CommonSettings;
    showLineNumbers?: boolean;
    watchUnopenedFilesInViewer?: boolean;
    onSettingChange: (key: CommonSettingKey, value: boolean) => void;
    onGlobalSettingChange: (key: GlobalSettingKey, value: boolean) => void;
}

export default function SettingsCommonControls(props: SettingsCommonControlsProps) {
    const show_linetags = props.settings.show_linetags_in_headlines ?? false;
    const scroll_into_view = props.settings.scroll_note_into_view ?? false;
    const auto_expand = props.settings.auto_expand_focused_note ?? false;
    const line_numbers = props.showLineNumbers ?? false;
    // default true matches the extension-side default (notethink.watchUnopenedFilesInViewer)
    const watch_unopened = props.watchUnopenedFilesInViewer ?? true;

    return (
        <>
            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={show_linetags}
                        onChange={(e) => props.onSettingChange('show_linetags_in_headlines', e.target.checked)}
                    />
                    {' '}{l10n.t('Show linetags in headlines')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={scroll_into_view}
                        onChange={(e) => props.onSettingChange('scroll_note_into_view', e.target.checked)}
                    />
                    {' '}{l10n.t('Scroll note into view')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={auto_expand}
                        onChange={(e) => props.onSettingChange('auto_expand_focused_note', e.target.checked)}
                    />
                    {' '}{l10n.t('Auto-expand focused note')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={line_numbers}
                        onChange={(e) => props.onGlobalSettingChange('show_line_numbers', e.target.checked)}
                    />
                    {' '}{l10n.t('Show line numbers')}
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={watch_unopened}
                        onChange={(e) => props.onGlobalSettingChange('watch_unopened_files_in_viewer', e.target.checked)}
                    />
                    {' '}{l10n.t('Watch unopened files in viewer')}
                </label>
            </p>
        </>
    );
}

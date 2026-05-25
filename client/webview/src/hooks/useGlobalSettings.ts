import Debug from 'debug';
import { useState } from 'react';
import type { GlobalSettingsPayload } from '../notethink-views/src/types/Messages';

const debug = Debug("nodejs:notethink:useGlobalSettings");

interface GlobalSettingsState {
    global_settings: GlobalSettingsPayload;
    setGlobalSettings: (settings: GlobalSettingsPayload) => void;
}

const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsPayload = {
    show_line_numbers: false,
    watch_unopened_files_in_viewer: true,
};

// hold the host-pushed global settings (line numbers, unopened-file watching)
export function useGlobalSettings(): GlobalSettingsState {
    const [global_settings, setGlobalSettings] = useState<GlobalSettingsPayload>(DEFAULT_GLOBAL_SETTINGS);
    return { global_settings, setGlobalSettings };
}

import { useState } from 'react';
import type { SettingsCascadePayload } from '../notethink-views/src/types/Messages';
import { DEFAULT_SETTINGS_CASCADE } from '../constants';

interface SettingsCascadeState {
    settings_cascade: SettingsCascadePayload;
    setSettingsCascade: (settings: SettingsCascadePayload) => void;
}

// hold the host-pushed settings cascade - every notethink setting, resolved by the extension under notethink.settings.* and the only tier the webview reads
export function useSettingsCascade(): SettingsCascadeState {
    const [settings_cascade, setSettingsCascade] = useState<SettingsCascadePayload>(DEFAULT_SETTINGS_CASCADE);
    return { settings_cascade, setSettingsCascade };
}

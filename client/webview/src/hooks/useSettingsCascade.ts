import Debug from 'debug';
import { useState } from 'react';
import type { SettingsCascadePayload } from '../notethink-views/src/types/Messages';
import { DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, DEFAULT_MAX_NOTES_PER_FILE, DEFAULT_COLUMN_ORDER } from '../constants';

const debug = Debug("nodejs:notethink:useSettingsCascade");

interface SettingsCascadeState {
    settings_cascade: SettingsCascadePayload;
    setSettingsCascade: (settings: SettingsCascadePayload) => void;
}

const DEFAULT_SETTINGS_CASCADE: SettingsCascadePayload = {
    viewType: 'auto',
    columnOrder: DEFAULT_COLUMN_ORDER,
    includeFilter: DEFAULT_INCLUDE_FILTER,
    excludeFilter: DEFAULT_EXCLUDE_FILTER,
    maxNotesPerFile: DEFAULT_MAX_NOTES_PER_FILE,
    showContextBars: true,
    hasWorkspaceOverrides: false,
};

// hold the host-pushed settings cascade (view type, column order, filters, etc.) resolved by the extension under notethink.settings.*
export function useSettingsCascade(): SettingsCascadeState {
    const [settings_cascade, setSettingsCascade] = useState<SettingsCascadePayload>(DEFAULT_SETTINGS_CASCADE);
    return { settings_cascade, setSettingsCascade };
}

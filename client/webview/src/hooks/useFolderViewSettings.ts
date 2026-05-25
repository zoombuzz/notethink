import Debug from 'debug';
import { useState } from 'react';
import type { FolderViewSettingsPayload } from '../notethink-views/src/types/Messages';
import { DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER, DEFAULT_MAX_NOTES_PER_FILE, DEFAULT_FOLDER_VIEW_COLUMN_ORDER } from '../constants';

const debug = Debug("nodejs:notethink:useFolderViewSettings");

interface FolderViewSettingsState {
    folder_view_settings: FolderViewSettingsPayload;
    setFolderViewSettings: (settings: FolderViewSettingsPayload) => void;
}

const DEFAULT_FOLDER_VIEW_SETTINGS: FolderViewSettingsPayload = {
    view_type: 'auto',
    column_order: DEFAULT_FOLDER_VIEW_COLUMN_ORDER,
    include_filter: DEFAULT_INCLUDE_FILTER,
    exclude_filter: DEFAULT_EXCLUDE_FILTER,
    max_notes_per_file: DEFAULT_MAX_NOTES_PER_FILE,
    show_context_bars: true,
    has_workspace_overrides: false,
};

// hold the host-pushed folder-view settings (view type, column order, filters)
export function useFolderViewSettings(): FolderViewSettingsState {
    const [folder_view_settings, setFolderViewSettings] = useState<FolderViewSettingsPayload>(DEFAULT_FOLDER_VIEW_SETTINGS);
    return { folder_view_settings, setFolderViewSettings };
}

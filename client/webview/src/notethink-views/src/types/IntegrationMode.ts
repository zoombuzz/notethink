import Debug from "debug";

const debug = Debug("nodejs:notethink-views:IntegrationMode");

export const INTEGRATION_MODE_CURRENT_FILE = 'current_file' as const;
export const INTEGRATION_MODE_FOLDER = 'folder' as const;
export const INTEGRATION_MODES = [INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER] as const;
export type IntegrationMode = typeof INTEGRATION_MODES[number];

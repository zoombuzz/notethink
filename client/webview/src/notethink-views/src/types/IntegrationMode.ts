export const INTEGRATION_MODE_AUTO = 'auto' as const;
export const INTEGRATION_MODE_CURRENT_FILE = 'current_file' as const;
export const INTEGRATION_MODE_FOLDER = 'folder' as const;
// `auto` resolves to a concrete mode before setIntegration posts, so the extension's mirrored constants list omit it
export const INTEGRATION_MODES = [INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER] as const;
export type IntegrationMode = typeof INTEGRATION_MODES[number];

// the concrete modes auto can resolve to - never 'auto' itself
export type ConcreteIntegrationMode = typeof INTEGRATION_MODE_CURRENT_FILE | typeof INTEGRATION_MODE_FOLDER;

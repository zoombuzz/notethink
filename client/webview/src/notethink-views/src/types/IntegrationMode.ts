import Debug from "debug";

const debug = Debug("nodejs:notethink-views:IntegrationMode");

export const INTEGRATION_MODE_AUTO = 'auto' as const;
export const INTEGRATION_MODE_CURRENT_FILE = 'current_file' as const;
export const INTEGRATION_MODE_FOLDER = 'folder' as const;
/*
 * auto first — it is the default selection (mirrors view-type 'auto'): while auto, the displayed mode follows the opened file's nt_integration_mode / nt_breadcrumb_last linetags
 * the extension constants mirror (client/extension/src/constants.ts) intentionally OMITS auto: the webview only ever resolves auto down to a concrete current_file / folder before posting setIntegration, so the extension never sees 'auto' on the wire
 */
export const INTEGRATION_MODES = [INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER] as const;
export type IntegrationMode = typeof INTEGRATION_MODES[number];

// the concrete modes auto can resolve to — never 'auto' itself
export type ConcreteIntegrationMode = typeof INTEGRATION_MODE_CURRENT_FILE | typeof INTEGRATION_MODE_FOLDER;

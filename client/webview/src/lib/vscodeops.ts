import Debug from "debug";
import { INTEGRATION_MODE_FOLDER } from "../notethink-views/src/types/IntegrationMode";
import type { HashMapOf, Doc } from "../types/general";
import type { ViewState } from "../hooks/usePersistedViewStates";

const debug = Debug("nodejs:notethink:vscodeops");

/**
 * VSCodeState is the persisted shape held under vscode.setState(...) for the NoteThink
 * webview. The camelCase key `viewStates` is the on-the-wire/persisted key (read by
 * migrateSavedState and produced by persistVscodeState) and must not be renamed.
 */
export type VSCodeState = {
    docs?: HashMapOf<Doc>;
    viewStates?: Record<string, ViewState>;
};

/**
 * Normalise persisted viewState across past renames so downstream reads only see the
 * current shape. Migration ledger:
 * - the folder-mode viewState key '__aggregate__' → '__folder__'
 * - per-viewState display_options.integration_mode 'directory' → 'folder'
 * - legacy aggregate_* display_options fields → includeFilter / excludeFilter / maxNotesPerFile
 *
 * Returns the same `s` reference (mutated in place) so callers can chain or destructure.
 * Returns the input unchanged when there are no viewStates to migrate (undefined input,
 * or `{docs}`-only payloads from very-early sessions).
 */
export function migrateSavedState(s: VSCodeState | undefined): VSCodeState | undefined {
    if (!s?.viewStates) { return s; }
    // rename the legacy folder-mode viewState key on the map
    if ('__aggregate__' in s.viewStates && !('__folder__' in s.viewStates)) {
        s.viewStates['__folder__'] = s.viewStates['__aggregate__'];
        delete s.viewStates['__aggregate__'];
    }
    for (const id of Object.keys(s.viewStates)) {
        const dopts = s.viewStates[id]?.display_options as (Record<string, unknown> | undefined);
        if (!dopts) { continue; }
        if (dopts.integration_mode === 'directory') {
            dopts.integration_mode = INTEGRATION_MODE_FOLDER;
        }
        if ('aggregate_include' in dopts) {
            dopts.includeFilter = dopts.aggregate_include;
            delete dopts.aggregate_include;
        }
        if ('aggregate_exclude' in dopts) {
            dopts.excludeFilter = dopts.aggregate_exclude;
            delete dopts.aggregate_exclude;
        }
        if ('aggregate_max_notes_per_file' in dopts) {
            dopts.maxNotesPerFile = dopts.aggregate_max_notes_per_file;
            delete dopts.aggregate_max_notes_per_file;
        }
    }
    return s;
}

/**
 * Reuse the API instance acquired in the inline boot script (notethinkEditor.ts) and
 * cached on window.__notethinkVscodeApi; fall back to acquireVsCodeApi() for test
 * environments where the inline script doesn't run. The result is memoised on the
 * window so subsequent calls return the same instance (acquireVsCodeApi throws if
 * called more than once in a real webview).
 */
export function getVscodeApi(): ReturnType<typeof acquireVsCodeApi<VSCodeState>> {
    const win = window as Window & { __notethinkVscodeApi?: ReturnType<typeof acquireVsCodeApi<VSCodeState>> };
    if (win.__notethinkVscodeApi) {
        return win.__notethinkVscodeApi;
    }
    const api = acquireVsCodeApi<VSCodeState>();
    win.__notethinkVscodeApi = api;
    return api;
}

/**
 * Send a message to the extension host. Thin wrapper around the cached vscode api so
 * callers don't have to acquire it themselves and tests can stub acquireVsCodeApi once.
 */
export function postMessageToExtension(message: unknown): void {
    getVscodeApi().postMessage(message);
}

/**
 * Persist webview state via vscode.setState. The persisted shape's `viewStates` key is
 * camelCase because it is the on-the-wire/persisted key (read back by migrateSavedState
 * and produced here), even though the local hook value is snake_case view_states.
 */
export function persistVscodeState(state: VSCodeState): void {
    getVscodeApi().setState(state);
}

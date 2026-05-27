import Debug from 'debug';
import React, { useRef } from 'react';
import * as l10n from '@vscode/l10n';
import { useVscodeMessages } from '../hooks/useVscodeMessages';
import { usePersistedViewStates, useVscodeStatePersistence } from '../hooks/usePersistedViewStates';
import { useGlobalSettings } from '../hooks/useGlobalSettings';
import { useSettingsCascade } from '../hooks/useSettingsCascade';
import { useLinkInterceptor } from '../hooks/useLinkInterceptor';
import { useConnectionTimeout } from '../hooks/useConnectionTimeout';
import { INTEGRATION_MODE_FOLDER } from '../notethink-views/src/types/IntegrationMode';
import type { HashMapOf, Doc } from '../types/general';
import type { ViewState } from '../hooks/usePersistedViewStates';
import NoteRenderer from './NoteRenderer';

const debug = Debug("nodejs:notethink:ExtensionReceiver");

type VSCodeState = {
    docs?: HashMapOf<Doc>;
    viewStates?: Record<string, ViewState>;
}

// re-exported so NoteRenderer (and any other consumer) keeps importing ViewState from this module
export type { ViewState };

// reuse the API instance acquired in the inline boot script (notethinkEditor.ts);
// fall back to acquireVsCodeApi() for test environments where the inline script doesn't run
function getVscodeApi(): ReturnType<typeof acquireVsCodeApi<VSCodeState>> {
    const win = window as Window & { __notethinkVscodeApi?: ReturnType<typeof acquireVsCodeApi<VSCodeState>> };
    if (win.__notethinkVscodeApi) {
        return win.__notethinkVscodeApi;
    }
    const api = acquireVsCodeApi<VSCodeState>();
    win.__notethinkVscodeApi = api;
    return api;
}
const vscode = getVscodeApi();

export function postMessageToExtension(message: unknown): void {
    vscode.postMessage(message);
}

// persist via the vscode api; the camelCase key `viewStates` is the on-the-wire/persisted key (read by migrateSavedState and saved_state.viewStates) and must not be renamed
function persistVscodeState(state: { docs: HashMapOf<Doc>; viewStates: Record<string, ViewState> }): void {
    vscode.setState(state);
}

// normalise persisted viewState across past renames so downstream reads only see the current shape:
// integration_mode 'directory' → 'folder', legacy aggregate_* display_options fields → includeFilter / excludeFilter / maxNotesPerFile, and the folder-mode viewState key '__aggregate__' → '__folder__'
function migrateSavedState(s: VSCodeState | undefined): VSCodeState | undefined {
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

const saved_state = migrateSavedState(vscode.getState());

export default function ExtensionReceiver(): React.ReactElement {
    // hooks
    const navigation_callback_ref = useRef<((direction: string) => void) | undefined>(undefined);
    const { connected, timed_out, markConnected } = useConnectionTimeout(
        !!saved_state?.docs && Object.keys(saved_state.docs).length > 0,
    );
    const { global_settings, setGlobalSettings } = useGlobalSettings();
    const { settings_cascade, setSettingsCascade } = useSettingsCascade();
    const {
        view_states,
        view_states_ref,
        updateAllViewStates,
        handleSetViewManagedState,
    } = usePersistedViewStates(saved_state?.viewStates || {});
    const {
        docs,
        selections,
        workspace_root,
        workspace_projects,
        aggregate_total_discovered,
        includeFilter,
        excludeFilter,
    } = useVscodeMessages({
        initial_docs: saved_state?.docs,
        saved_view_states: saved_state?.viewStates,
        postMessage: postMessageToExtension,
        markConnected,
        setGlobalSettings,
        setSettingsCascade,
        updateAllViewStates,
        view_states_ref,
        navigation_callback_ref,
    });

    // effects
    useLinkInterceptor(postMessageToExtension);
    useVscodeStatePersistence(docs, view_states, persistVscodeState);

    // early returns
    const has_docs = docs && Object.keys(docs).length > 0;
    if (!has_docs && !connected && timed_out) {
        return <div style={{ padding: '24px', color: 'var(--vscode-foreground)', fontFamily: 'var(--vscode-font-family)' }}>
            <p>{l10n.t('Waiting for extension host...')}</p>
            <p style={{ fontSize: '12px', opacity: 0.7 }}>
                {l10n.t('If this persists, reload the window: Ctrl+Shift+P → "Developer: Reload Window"')}
            </p>
        </div>;
    }

    // render
    return <NoteRenderer
        notes={docs || {}}
        selections={selections}
        postMessage={postMessageToExtension}
        viewStates={view_states}
        setViewManagedState={handleSetViewManagedState}
        onNavigationCommand={navigation_callback_ref}
        workspace_root={workspace_root}
        workspace_projects={workspace_projects}
        aggregate_total_discovered={aggregate_total_discovered}
        includeFilter={includeFilter}
        excludeFilter={excludeFilter}
        globalSettings={global_settings}
        settingsCascade={settings_cascade}
    />;
}

import Debug from 'debug';
import React, { useRef } from 'react';
import * as l10n from '@vscode/l10n';
import { useVscodeMessages } from '../hooks/useVscodeMessages';
import { usePersistedViewStates, useVscodeStatePersistence } from '../hooks/usePersistedViewStates';
import { useGlobalSettings } from '../hooks/useGlobalSettings';
import { useSettingsCascade } from '../hooks/useSettingsCascade';
import { useLinkInterceptor } from '../hooks/useLinkInterceptor';
import { useConnectionTimeout } from '../hooks/useConnectionTimeout';
import { getVscodeApi, migrateSavedState, postMessageToExtension, persistVscodeState } from '../lib/vscodeops';
import type { UsePendingWorkApi } from '../notethink-views/src/hooks/usePendingWork';
import type { ViewState } from '../hooks/usePersistedViewStates';
import NoteRenderer from './NoteRenderer';

const debug = Debug("nodejs:notethink:ExtensionReceiver");

// re-exported so NoteRenderer (and any other consumer) keeps importing ViewState from this module
export type { ViewState };

const saved_state = migrateSavedState(getVscodeApi().getState());

interface ExtensionReceiverProps {
    pendingWorkApi: UsePendingWorkApi;
}

export default function ExtensionReceiver(props: ExtensionReceiverProps): React.ReactElement {
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
        active_editor_doc_path,
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
        markPending: props.pendingWorkApi.markPending,
        clearPending: props.pendingWorkApi.clearPending,
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
        activeEditorDocPath={active_editor_doc_path}
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

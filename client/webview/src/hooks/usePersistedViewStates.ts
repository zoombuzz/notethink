import Debug from 'debug';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/mergeAggregateRoot';
import type { HashMapOf, Doc } from '../types/general';
import type { NoteDisplayOptions } from '../notethink-views/src/types/NoteProps';

const debug = Debug("nodejs:notethink:usePersistedViewStates");

export interface ViewState {
    type?: string;
    display_options?: NoteDisplayOptions;
}

interface PersistedViewStatesState {
    view_states: Record<string, ViewState>;
    view_states_ref: React.MutableRefObject<Record<string, ViewState>>;
    setViewStates: React.Dispatch<React.SetStateAction<Record<string, ViewState>>>;
    updateAllViewStates: (updater: (view_state: ViewState) => ViewState) => void;
    handleSetViewManagedState: (updates: Array<Record<string, unknown>>) => void;
}

type PersistVscodeState = (state: { docs: HashMapOf<Doc>; viewStates: Record<string, ViewState> }) => void;

// true if any persisted viewState (canonical key or otherwise) is tagged folder mode
export function anyViewStateTaggedFolder(view_states: Record<string, ViewState>): boolean {
    if (view_states[FOLDER_VIEW_STATE_ID]?.display_options?.integration_mode === 'folder') { return true; }
    for (const id of Object.keys(view_states)) {
        if (id === FOLDER_VIEW_STATE_ID) { continue; }
        if (view_states[id]?.display_options?.integration_mode === 'folder') { return true; }
    }
    return false;
}

// own the view-state map plus its ref mirror and mutators (the persistence effect lives in useVscodeStatePersistence)
export function usePersistedViewStates(
    initial_view_states: Record<string, ViewState>,
): PersistedViewStatesState {
    const [view_states, setViewStates] = useState<Record<string, ViewState>>(initial_view_states);

    // ref mirror so the empty-deps onMessage callback can read the current view_states without re-binding
    const view_states_ref = useRef<Record<string, ViewState>>(view_states);
    useEffect(() => { view_states_ref.current = view_states; }, [view_states]);

    const updateAllViewStates = useCallback((updater: (view_state: ViewState) => ViewState) => {
        setViewStates(prev => {
            const next = { ...prev };
            for (const id of Object.keys(next)) {
                next[id] = updater(next[id]);
            }
            if (Object.keys(next).length === 0) {
                next['__default'] = updater({});
            }
            return next;
        });
    }, []);

    const handleSetViewManagedState = useCallback((updates: Array<Record<string, unknown>>) => {
        setViewStates(prev => {
            const next = { ...prev };
            for (const update of updates) {
                const id = update.id as string;
                if (!id) {continue;}
                next[id] = {
                    ...next[id],
                    ...update,
                    display_options: {
                        ...next[id]?.display_options,
                        ...(update.display_options as NoteDisplayOptions | undefined),
                    },
                };
            }
            return next;
        });
    }, []);

    return { view_states, view_states_ref, setViewStates, updateAllViewStates, handleSetViewManagedState };
}

// persist docs+viewStates so the webview can restore instantly if VS Code recreates it
// skip empty docs to prevent blank-panel-on-restore when VS Code restarts before the extension sends the first document
// the persisted object keeps the camelCase key `viewStates` (the on-the-wire/persisted key read back by migrateSavedState / saved_state.viewStates), even though the local hook value is snake_case view_states
export function useVscodeStatePersistence(
    docs: HashMapOf<Doc> | undefined,
    view_states: Record<string, ViewState>,
    persist: PersistVscodeState,
): void {
    useEffect(() => {
        if (!docs || Object.keys(docs).length === 0) { return; }
        debug('persisting %d docs', Object.keys(docs).length);
        persist({ docs, viewStates: view_states });
    }, [docs, view_states, persist]);
}

import Debug from 'debug';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toPersistedDocs, type VSCodeState } from '../lib/vscodeops';
import { emitPersistState } from '../lib/persistStateProbe';
import type { HashMapOf, Doc } from '../types/general';
import type { NoteDisplayOptions } from '../notethink-views/src/types/NoteProps';

const debug = Debug("nodejs:notethink:usePersistedViewStates");

// trailing debounce: a burst of docs/view_states changes collapses into one persist this long after the last one
export const PERSIST_DEBOUNCE_MS = 500;

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

type PersistVscodeState = (state: VSCodeState) => void;

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

/**
 * Persists docs and view states so the webview can restore instantly if VS Code recreates it. Empty
 * docs are skipped to avoid a blank panel on restore before the extension sends the first document.
 * The persisted key stays camelCase `viewStates` (read by migrateSavedState) though the hook value is
 * snake_case. Also flushes on visibilitychange and unmount, so a pending change never lags the debounce window.
 */
export function useVscodeStatePersistence(
    docs: HashMapOf<Doc> | undefined,
    view_states: Record<string, ViewState>,
    persist: PersistVscodeState,
): void {
    const pending_ref = useRef<{ docs: HashMapOf<Doc>; view_states: Record<string, ViewState> } | undefined>(undefined);
    // lets the empty-deps visibilitychange/dispose effect always call through to the latest flush body
    const flush_ref = useRef<() => void>(() => {});
    flush_ref.current = () => {
        const pending = pending_ref.current;
        if (!pending) { return; }
        pending_ref.current = undefined;
        const persisted_docs = toPersistedDocs(pending.docs);
        const state: VSCodeState = { docs: persisted_docs, viewStates: pending.view_states };
        debug('persisting %d docs (metadata only)', Object.keys(persisted_docs).length);
        emitPersistState({ bytes: JSON.stringify(state).length, docs: Object.keys(persisted_docs).length, at: performance.now() });
        persist(state);
    };
    useEffect(() => {
        if (!docs || Object.keys(docs).length === 0) { return; }
        pending_ref.current = { docs, view_states };
        const timer = setTimeout(() => flush_ref.current(), PERSIST_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [docs, view_states]);
    useEffect(() => {
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') { flush_ref.current(); }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        // flush any still-pending change on dispose (unmount) so it isn't lost to the debounce window
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            flush_ref.current();
        };
    }, []);
}

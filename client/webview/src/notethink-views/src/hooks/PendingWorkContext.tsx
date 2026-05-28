import Debug from "debug";
import React, { createContext, useContext } from "react";
import { usePendingWork, type UsePendingWorkApi } from "./usePendingWork";

const debug = Debug("nodejs:notethink-views:PendingWorkContext");

// default ctx-value: a no-op markPending/clearPending and `pending=false`. Lets consumers call markPending unconditionally even when no provider is mounted (tests, isolated component renders); the spinner just stays hidden
const NOOP_API: UsePendingWorkApi = {
    pending: false,
    markPending: () => {},
    clearPending: () => {},
    clearAll: () => {},
};

const PendingWorkCtx = createContext<UsePendingWorkApi>(NOOP_API);

/**
 * Provider props for PendingWorkProvider.
 * - api: an externally-owned hook instance — lets the parent wire the same instance into ExtensionReceiver's message reducer and the tree's components without two hooks fighting over state; when omitted the provider creates its own instance
 */
interface PendingWorkProviderProps {
    children: React.ReactNode;
    api?: UsePendingWorkApi;
}

function PendingWorkProviderExternal(props: { api: UsePendingWorkApi; children: React.ReactNode }): React.ReactElement {
    return (
        <PendingWorkCtx.Provider value={props.api}>
            {props.children}
        </PendingWorkCtx.Provider>
    );
}

function PendingWorkProviderInternal(props: { children: React.ReactNode }): React.ReactElement {
    const internal_api = usePendingWork();
    return (
        <PendingWorkCtx.Provider value={internal_api}>
            {props.children}
        </PendingWorkCtx.Provider>
    );
}

/**
 * Lifts a single usePendingWork instance to the React tree so the drawers, the
 * toolbar, and the extension-message reducer all observe and mutate the same
 * pending-work state.
 *
 * Most callers should mount this at the common ancestor of every consumer
 * (notethink's `base/App.tsx` wraps `ExtensionReceiver` and provides the
 * instance to NoteRenderer). If `api` is supplied the provider just passes it
 * through; otherwise it constructs an instance internally. The internal vs
 * external paths are separate components so the internal `usePendingWork()`
 * is not called on the external path (Rules of Hooks rule out a single-function
 * conditional call). Callers should pin the api/no-api choice at mount time;
 * toggling at runtime would remount the inner subtree.
 */
export function PendingWorkProvider(props: PendingWorkProviderProps): React.ReactElement {
    if (props.api) {
        return <PendingWorkProviderExternal api={props.api}>{props.children}</PendingWorkProviderExternal>;
    }
    return <PendingWorkProviderInternal>{props.children}</PendingWorkProviderInternal>;
}

// subscribe to the ambient pending-work api (or the no-op default when no provider is mounted)
export function usePendingWorkContext(): UsePendingWorkApi {
    return useContext(PendingWorkCtx);
}

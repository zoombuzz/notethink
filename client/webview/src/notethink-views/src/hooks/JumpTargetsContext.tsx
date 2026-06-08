import Debug from "debug";
import React, { createContext, useContext } from "react";
import { useJumpTargets, type UseJumpTargetsApi } from "./useJumpTargets";

const debug = Debug("nodejs:notethink-views:JumpTargetsContext");

// default ctx-value: no latest response and no-op setters. Lets consumers read jump_targets / call the setters unconditionally even when no provider is mounted (tests, isolated component renders)
const NOOP_API: UseJumpTargetsApi = {
    jump_targets: undefined,
    setJumpTargets: () => {},
};

const JumpTargetsCtx = createContext<UseJumpTargetsApi>(NOOP_API);

/**
 * provider props for JumpTargetsProvider.
 * - api: an externally-owned hook instance — lets the parent wire the same instance into ExtensionReceiver's message reducer and the tree's components without two hooks fighting over state; when omitted the provider creates its own instance
 */
interface JumpTargetsProviderProps {
    children: React.ReactNode;
    api?: UseJumpTargetsApi;
}

function JumpTargetsProviderExternal(props: { api: UseJumpTargetsApi; children: React.ReactNode }): React.ReactElement {
    return (
        <JumpTargetsCtx.Provider value={props.api}>
            {props.children}
        </JumpTargetsCtx.Provider>
    );
}

function JumpTargetsProviderInternal(props: { children: React.ReactNode }): React.ReactElement {
    const internal_api = useJumpTargets();
    return (
        <JumpTargetsCtx.Provider value={internal_api}>
            {props.children}
        </JumpTargetsCtx.Provider>
    );
}

/**
 * lifts a single useJumpTargets instance to the React tree so the jump drawer and the
 * extension-message reducer observe and mutate the same latest-response state.
 *
 * Most callers should mount this at the common ancestor of every consumer (notethink's
 * `base/App.tsx` wraps `ExtensionReceiver`). If `api` is supplied the provider just passes
 * it through; otherwise it constructs an instance internally. The internal vs external paths
 * are separate components so the internal `useJumpTargets()` is not called on the external
 * path (Rules of Hooks rule out a single-function conditional call). Callers should pin the
 * api/no-api choice at mount time; toggling at runtime would remount the inner subtree.
 */
export function JumpTargetsProvider(props: JumpTargetsProviderProps): React.ReactElement {
    debug('JumpTargetsProvider mounted (external=%s)', !!props.api);
    if (props.api) {
        return <JumpTargetsProviderExternal api={props.api}>{props.children}</JumpTargetsProviderExternal>;
    }
    return <JumpTargetsProviderInternal>{props.children}</JumpTargetsProviderInternal>;
}

// subscribe to the ambient jump-targets api (or the no-op default when no provider is mounted)
export function useJumpTargetsContext(): UseJumpTargetsApi {
    return useContext(JumpTargetsCtx);
}

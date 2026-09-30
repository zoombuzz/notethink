import Debug from "debug";
import { useCallback, useState } from "react";
import type { JumpTargetsMessage } from "../types/Messages";

const debug = Debug("nodejs:notethink-views:useJumpTargets");

export interface UseJumpTargetsApi {
    jump_targets: JumpTargetsMessage | undefined;
    setJumpTargets: (response: JumpTargetsMessage) => void;
}

/**
 * Holds the latest jumpTargets response from the extension. The webview posts requestJumpTargets and
 * the extension replies asynchronously with jumpTargets; the message reducer routes it here via
 * setJumpTargets so the jump drawer can render the entries. The drawer suppresses a stale slot by
 * matching jump_targets.path against the leaf it requested, so no explicit reset is needed.
 */
export function useJumpTargets(): UseJumpTargetsApi {
    const [jump_targets, setJumpTargetsState] = useState<JumpTargetsMessage | undefined>(undefined);
    const setJumpTargets = useCallback((response: JumpTargetsMessage): void => {
        debug('setJumpTargets mode=%s path=%s entries=%d', response.mode, response.path, response.entries.length);
        setJumpTargetsState(response);
    }, []);
    return { jump_targets, setJumpTargets };
}

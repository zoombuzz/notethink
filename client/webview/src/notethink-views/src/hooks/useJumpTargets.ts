import Debug from "debug";
import { useCallback, useState } from "react";
import type { JumpTargetsMessage } from "../types/Messages";

const debug = Debug("nodejs:notethink-views:useJumpTargets");

export interface UseJumpTargetsApi {
    jump_targets: JumpTargetsMessage | undefined;
    setJumpTargets: (response: JumpTargetsMessage) => void;
}

/**
 * holds the latest jumpTargets response from the extension.
 *
 * The webview posts a requestJumpTargets message and the extension replies asynchronously
 * with a jumpTargets message; the message reducer routes that reply here via setJumpTargets
 * so the jump drawer can render the entries. The drawer suppresses a stale slot by matching
 * jump_targets.path against the leaf it requested, so no explicit reset is needed.
 *
 * Returns snake_case `jump_targets` (a hook return value) alongside camelCase setJumpTargets
 * (a function name) per CODING_STANDARDS.md hook conventions.
 */
export function useJumpTargets(): UseJumpTargetsApi {
    const [jump_targets, setJumpTargetsState] = useState<JumpTargetsMessage | undefined>(undefined);

    const setJumpTargets = useCallback((response: JumpTargetsMessage): void => {
        debug('setJumpTargets mode=%s path=%s entries=%d', response.mode, response.path, response.entries.length);
        setJumpTargetsState(response);
    }, []);

    return { jump_targets, setJumpTargets };
}

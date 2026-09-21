import { useCallback, useEffect } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import { settingWriteFor } from "../../../lib/viewregistryops";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import type { ViewProps } from "../../../types/ViewProps";
import { clampBreadth } from "./columnwidthops";
import { setBreadthDraft, useBreadthDraft } from "./useBreadthDraft";

/**
 * The lane breadth the board draws at, and the write a dragged boundary makes.
 *
 * A drag holds its breadth in the shared draft until the setting echoes back, so the lanes follow the
 * pointer and the drawer's text box reads the same number; the echo changes the saved breadth, which is
 * what drops the draft. The write is routed as the drawer routes a row change - into the rendered custom
 * view type when it holds the key, otherwise at workspace scope.
 */
export function useLaneBreadth(view: ViewProps, display_options: NoteDisplayOptions): { breadth: number; commitBreadth: (next: number) => void } {
    const saved_breadth = display_options.settings?.lineBreadth;
    const draft_breadth = useBreadthDraft(view.id);
    useEffect(() => { setBreadthDraft(view.id, undefined); }, [view.id, saved_breadth]);
    const { markPending } = usePendingWorkContext();
    const user_types = display_options.settings?.viewUserTypes;
    const rendered_type = view.type;
    const postMessage = view.handlers?.postMessage;
    const commitBreadth = useCallback((next: number): void => {
        const rendered_user_type = (user_types ?? []).find(type => type.id === rendered_type);
        const write = settingWriteFor(user_types ?? [], rendered_user_type, 'lineBreadth', next);
        markPending(write.setting);
        markPending('settingsCascade');
        postMessage?.({ type: 'updateSetting', setting: write.setting, value: write.value });
    }, [user_types, rendered_type, markPending, postMessage]);
    return { breadth: clampBreadth(draft_breadth ?? saved_breadth), commitBreadth };
}

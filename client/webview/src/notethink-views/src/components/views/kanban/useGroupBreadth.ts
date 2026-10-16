import { useCallback, useEffect } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import { registryWithUserTypes, settingWriteFor, type ViewOverridesMap } from "../../../lib/viewregistryops";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import type { ViewProps } from "../../../types/ViewProps";
import { clampBreadth } from "./columnwidthops";
import { setBreadthDraft, useBreadthDraft } from "./useBreadthDraft";

/**
 * The group breadth the board draws at, and the write a dragged boundary makes.
 *
 * A drag holds its breadth in the shared draft until the setting echoes back, so the groups follow the
 * pointer and the drawer's text box reads the same number; the echo changes the saved breadth, which is
 * what drops the draft. The write is routed as the drawer routes a row change - into the rendered view's
 * own value (a saved type's overrides, or its entry in the viewOverrides map), else at the flat home.
 */
export function useGroupBreadth(view: ViewProps, display_options: NoteDisplayOptions): { breadth: number; commitBreadth: (next: number) => void } {
    const saved_breadth = display_options.settings?.lineBreadth;
    const draft_breadth = useBreadthDraft(view.id);
    useEffect(() => { setBreadthDraft(view.id, undefined); }, [view.id, saved_breadth]);
    const { markPending } = usePendingWorkContext();
    const user_types = display_options.settings?.viewUserTypes ?? [];
    const view_overrides = (display_options.settings?.viewOverrides as ViewOverridesMap | undefined) ?? {};
    const rendered_type = view.type;
    const postMessage = view.handlers?.postMessage;
    const commitBreadth = useCallback((next: number): void => {
        const registry = registryWithUserTypes(user_types);
        const write = settingWriteFor(registry, user_types, view_overrides, rendered_type, 'lineBreadth', next, saved_breadth);
        markPending(write.setting);
        markPending('settingsCascade');
        postMessage?.({ type: 'updateSetting', setting: write.setting, value: write.value });
    }, [user_types, view_overrides, rendered_type, saved_breadth, markPending, postMessage]);
    return { breadth: clampBreadth(draft_breadth ?? saved_breadth), commitBreadth };
}

import Debug from "debug";
import { useMemo } from "react";
import { findStableIdCollisions } from "../../../lib/noteops";
import { useViewContext } from "./useViewContext";
import { useViewHandlers } from "./useViewHandlers";
import { useToolbarDrawers } from "./useToolbarDrawers";
import { useJumpDrawer } from "./useJumpDrawer";
import { useViewNavigation } from "./useViewNavigation";
import { useViewToolbar } from "./useViewToolbar";
import { useInsertModal } from "./useInsertModal";
import type { ViewProps } from "../../../types/ViewProps";
import type { StableIdCollision } from "../../../lib/noteops";

const debug = Debug("nodejs:notethink-views:useGenericView");

type ViewHandlersResult = ReturnType<typeof useViewHandlers>;

export interface GenericViewModel {
    view_context: ReturnType<typeof useViewContext>;
    handlers: ViewHandlersResult["handlers"];
    handle_folder_click: ViewHandlersResult["handle_folder_click"];
    handle_apply_filters: ViewHandlersResult["handle_apply_filters"];
    handle_file_jump: ViewHandlersResult["handle_file_jump"];
    drawers: ReturnType<typeof useToolbarDrawers>;
    jump: ReturnType<typeof useJumpDrawer>;
    collisions: StableIdCollision[];
    toolbar: ReturnType<typeof useViewToolbar>;
    insert: ReturnType<typeof useInsertModal>;
    auto_resolved_type: string | undefined;
}

/**
 * orchestrates every hook a GenericView leaf needs - view context, handlers, the
 * toolbar drawers, the jump drawer's requested leaf, duplicate-stable_id collisions, keyboard
 * navigation, the toolbar dispatchers, and the insert modal - and returns a flat model so the component body
 * stays render-only. keeping the Rules-of-Hooks cluster here (rather than inline) is the
 * prescribed React decomposition: a long component body shortens by lifting hooks into a
 * custom hook, never by splitting at an arbitrary line.
 */
export function useGenericView(props: ViewProps): GenericViewModel {
    const view_context = useViewContext(props);
    const { display_options, parent_context, parent_context_seq, notes_within_parent_context } = view_context;
    const { handlers, handle_folder_click, handle_apply_filters, handle_jump_request, handle_file_jump } = useViewHandlers(props, view_context.selection_ref);
    const drawers = useToolbarDrawers(props.id);
    const jump = useJumpDrawer(props, drawers.toggle_jump, handle_jump_request);
    // collisions are mode-independent: props.notes is the merged set in folder mode, the single-file flat list in current_file mode
    const collisions = useMemo(() => findStableIdCollisions(props.notes ?? []), [props.notes]);
    useViewNavigation({
        display_options,
        notes_within_parent_context,
        parent_context,
        parent_context_seq,
        handlers,
        navigation_command_ref: props.handlers?.onNavigationCommand,
    });
    const toolbar = useViewToolbar(props, handlers, display_options, notes_within_parent_context);
    const insert = useInsertModal(props, handlers);
    debug("collisions=%d active_drawer=%s", collisions.length, drawers.active_drawer);
    return {
        view_context,
        handlers,
        handle_folder_click,
        handle_apply_filters,
        handle_file_jump,
        drawers,
        jump,
        collisions,
        toolbar,
        insert,
        auto_resolved_type: props.nested?.auto_resolved_type,
    };
}

import Debug from "debug";
import { useMemo } from "react";
import { useAgentActivity } from "../../../lib/activityhooks";
import { virtualNotesForActivity } from "../../../lib/agentactivityops";
import { findStableIdCollisions } from "../../../lib/noteops";
import { admitVirtualNotes, guardVirtualNoteWrites } from "../../../lib/virtualnoteops";
import { AGENT_CARD_TYPE, cardRegistryWithViewSettings, resolveCardType } from "../../notes/cardregistryops";
import { useViewContext } from "./useViewContext";
import { useViewHandlers } from "./useViewHandlers";
import { useToolbarDrawers } from "./useToolbarDrawers";
import { useJumpDrawer } from "./useJumpDrawer";
import { useViewNavigation } from "./useViewNavigation";
import { useViewToolbar } from "./useViewToolbar";
import { useInsertModal } from "./useInsertModal";
import type { NoteProps } from "../../../types/NoteProps";
import type { ViewProps } from "../../../types/ViewProps";
import type { StableIdCollision } from "../../../lib/noteops";

const debug = Debug("nodejs:notethink-views:useGenericView");

// one shared empty list, so a view admitting nothing hands the same array identity to the memo below on every render
const NO_VIRTUAL_NOTES: ReadonlyArray<NoteProps> = [];

type ViewHandlersResult = ReturnType<typeof useViewHandlers>;

export interface GenericViewModel {
    view_props: ViewProps;
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
 * The card this view's notes are about to draw as, resolved here rather than read off the toolbar
 * because virtual notes are admitted before any of the toolbar's hooks run. It is the same resolution
 * useViewToolbar performs, minus the per-file majority vote: at an `auto` level the vote has not
 * happened yet, and AutoView re-renders GenericView with `auto_resolved_card_type` stamped once it
 * has, so the concrete level below answers for it.
 */
function resolvedCardTypeHint(props: ViewProps): string {
    if (props.nested?.auto_resolved_card_type !== undefined) { return props.nested.auto_resolved_card_type; }
    const settings = props.display_options?.settings;
    return resolveCardType(settings?.cardType, props.type, settings?.viewUserTypes ?? [], cardRegistryWithViewSettings(settings));
}

/**
 * Admit virtual notes and guard the handler surface, once, on behalf of every view.
 *
 * GenericView is the single component every view renders through and the one both composers reach,
 * so this is the only seam the abstraction needs: injecting per composer, or per view, would be two
 * seams rather than one and would let a view tell a virtual note from a parsed one. The guarded
 * handlers are applied here rather than to the hook's output because useViewHandlers closes over the
 * props surface as well as returning one, so anything downstream of this point is covered.
 *
 * The admission is gated on the agent card, which is the axis the question belongs to: a virtual note
 * exists to be drawn as a card, and drawing an unbound agent into a board the user has on the full
 * card would put an agent among their stories uninvited.
 */
function useAdmittedViewProps(props: ViewProps): ViewProps {
    const activity = useAgentActivity();
    const card_type_hint = resolvedCardTypeHint(props);
    const virtual_notes = useMemo(
        () => (card_type_hint === AGENT_CARD_TYPE ? virtualNotesForActivity(activity) : NO_VIRTUAL_NOTES),
        [activity, card_type_hint],
    );
    const admitted_notes = useMemo(() => admitVirtualNotes(props.notes, virtual_notes), [props.notes, virtual_notes]);
    const guarded_handlers = useMemo(() => guardVirtualNoteWrites(props.handlers), [props.handlers]);
    return { ...props, notes: admitted_notes, handlers: guarded_handlers };
}

/**
 * orchestrates every hook a GenericView leaf needs - the virtual-note admission, view context, handlers, the
 * toolbar drawers, the jump drawer's requested leaf, duplicate-stable_id collisions, keyboard
 * navigation, the toolbar dispatchers, and the insert modal - and returns a flat model so the component body
 * stays render-only. keeping the Rules-of-Hooks cluster here (rather than inline) is the
 * prescribed React decomposition: a long component body shortens by lifting hooks into a
 * custom hook, never by splitting at an arbitrary line.
 *
 * `view_props` is returned as well as consumed, because every hook below saw it and the component body
 * has to render against the same set the hooks derived from, not the raw props.
 */
export function useGenericView(raw_props: ViewProps): GenericViewModel {
    const props = useAdmittedViewProps(raw_props);
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
        view_props: props,
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

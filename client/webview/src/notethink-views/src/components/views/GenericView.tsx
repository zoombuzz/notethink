import React, { lazy } from "react";
import { documentRootForStrip } from "../../lib/noteops";
import { chainOf, registryWithUserTypes } from "../../lib/viewregistryops";
import type { UserViewType } from "../../types/Messages";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteAttributes from "../notes/GenericNoteAttributes";
import InsertModal from "../InsertModal";
import GenericViewBreadcrumb from "./generic/GenericViewBreadcrumb";
import GenericViewToolbar from "./generic/GenericViewToolbar";
import { useGenericView } from "./generic/useGenericView";

/*
 * component per concrete view id, keyed by the same ids the view registry declares. dynamic import() is
 * required by React.lazy for per-view code-splitting; static imports would pull every view into the
 * initial bundle. `auto` is not a registry node - it is the majority-vote meta-selection that delegates
 * to a concrete type. Adding a view is one registry entry plus one line here.
 */
const VIEW_COMPONENTS: Record<string, React.ComponentType<ViewProps>> = {
    auto: lazy(() => import('./AutoView')),
    document: lazy(() => import('./DocumentView')),
    line: lazy(() => import('./LineView')),
    kanban: lazy(() => import('./KanbanView')),
};

/**
 * The component that draws a view type: its own where one is wired, else the nearest ancestor's, so a
 * type the user minted ("Kanban by Assignee") draws as the board it was saved from. Only a minted id
 * ever misses on the first lookup, so the built-in rungs pay nothing for this.
 *
 * The chain is walked against the registry with the user's saved types merged in, because a minted id
 * is absent from the built-in registry and would otherwise have no chain at all. That input comes from
 * settings.json and is untrusted: a saved type whose parent has since been removed yields a chain that
 * stops early and a wholly unknown id yields none, and both fall through to undefined, which the caller
 * renders as no board rather than throwing.
 */
function viewComponentFor(view_type: string, user_types: UserViewType[]): React.ComponentType<ViewProps> | undefined {
    const direct = VIEW_COMPONENTS[view_type];
    if (direct) { return direct; }
    for (const node_id of chainOf(view_type, registryWithUserTypes(user_types))) {
        const inherited = VIEW_COMPONENTS[node_id];
        if (inherited) { return inherited; }
    }
    return undefined;
}

export default function GenericView(props: ViewProps): React.ReactElement {
    const { view_context, handlers, handle_folder_click, handle_apply_filters, handle_file_jump, drawers, jump, collisions, toolbar, insert, auto_resolved_type } = useGenericView(props);
    const { display_options, parent_context, deepest, notes_within_parent_context } = view_context;
    /*
     * document-level front-matter strip: bound to the document root (notes[0]), single-file mode only
     * built once here and handed to whichever leaf view renders it, so the views don't each re-derive it
     */
    const document_root = documentRootForStrip(props.notes, display_options.integration_mode);
    const document_strip = document_root ? <GenericNoteAttributes {...document_root} /> : undefined;
    const breadcrumb_trail = (
        <GenericViewBreadcrumb
            props={props}
            parentContext={parent_context}
            handlers={handlers}
            activeDrawer={drawers.active_drawer}
            hasCollisions={collisions.length > 0}
            onFolderClick={handle_folder_click}
            onFileCountClick={drawers.toggle_files}
            onCollisionsClick={drawers.toggle_collisions}
            onLeafClick={jump.open_jump_drawer}
        />
    );
    // render the toolbar at the leaf level only - when type is 'auto', AutoView delegates to a concrete type that renders GenericView again with the toolbar
    const show_toolbar = props.type !== 'auto';
    // the registry-keyed component for this type, inheriting a minted type's renderer from its parent
    const ViewComponent = viewComponentFor(props.type, display_options.settings?.viewUserTypes ?? []);
    /*
     * The props the rendered view component receives.
     * - display_options.settings.cardType: the resolved card, stamped here rather than in AutoView alone.
     *   AutoView only mounts for `auto`, so pinning a view type used to take the stamp with it and every
     *   note fell back to the view's default card. The stamp is skipped at an `auto` level, because the
     *   AutoView below is about to do its own and reads this same field to recover the user's raw choice -
     *   stamping over it there costs the card tab its "Auto (Sticky)" label.
     */
    const enriched_props: ViewProps = {
        ...props,
        display_options: {
            ...display_options,
            deepest,
            settings: show_toolbar
                ? { ...display_options.settings, cardType: toolbar.resolved_card_type }
                : display_options.settings,
        },
        notes: props.notes as Array<NoteProps>,
        notes_within_parent_context,
        nested: { ...props.nested, parent_context, breadcrumb_trail, auto_resolved_type, document_strip, document_root },
        handlers,
    };
    return (
        <>
            {show_toolbar && (
                <GenericViewToolbar
                    props={props}
                    handlers={handlers}
                    displayOptions={display_options}
                    breadcrumbTrail={breadcrumb_trail}
                    integrationSelection={toolbar.integration_selection}
                    integrationMode={toolbar.integration_mode}
                    onIntegrationChange={toolbar.handle_integration_change}
                    viewTypeSelection={toolbar.view_type_selection}
                    autoResolvedType={toolbar.auto_resolved_type}
                    onViewTypeChange={toolbar.handle_view_type_change}
                    cardTypeSelection={toolbar.card_type_selection}
                    resolvedCardType={toolbar.resolved_card_type}
                    onCardTypeChange={toolbar.handle_card_type_change}
                    naturalColumnOrder={toolbar.natural_column_order}
                    collisions={collisions}
                    activeDrawer={drawers.active_drawer}
                    requestedJumpPath={jump.requested_jump_path}
                    onFolderJump={handle_folder_click}
                    onFileJump={handle_file_jump}
                    gearButtonRef={drawers.gear_button_ref}
                    onCloseDrawer={drawers.close_drawer}
                    onSettingsToggle={drawers.toggle_settings}
                    onCardsToggle={drawers.toggle_cards}
                    onInsertOpen={insert.open_insert_modal}
                    onSettingChange={toolbar.handle_setting_change}
                    onColumnOrderChange={toolbar.handle_column_order_change}
                    onMakeDefault={toolbar.handle_make_default}
                    onResetToDefault={toolbar.handle_reset_to_default}
                    onRestoreBuiltinDefault={toolbar.handle_restore_builtin_default}
                    onApplyFilters={handle_apply_filters}
                />
            )}
            {ViewComponent && <ViewComponent {...enriched_props} />}
            <InsertModal
                opened={insert.insert_modal_open}
                onClose={insert.close_insert_modal}
                onInsert={insert.handle_insert}
            />
        </>
    );
}

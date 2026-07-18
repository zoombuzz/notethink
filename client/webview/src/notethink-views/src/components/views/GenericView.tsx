import Debug from "debug";
import React, { lazy } from "react";
import { documentRootForStrip } from "../../lib/noteops";
import { selectableViewIds } from "../../lib/viewregistryops";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteAttributes from "../notes/GenericNoteAttributes";
import InsertModal from "../InsertModal";
import GenericViewBreadcrumb from "./generic/GenericViewBreadcrumb";
import GenericViewToolbar from "./generic/GenericViewToolbar";
import { useGenericView } from "./generic/useGenericView";

const debug = Debug("nodejs:notethink-views:GenericView");

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
 * the ordered view types the selector offers: `auto` plus every selectable registry view that has a
 * component wired here. A registry view declared without a component is not offered, so the view tree can
 * grow ahead of its renderers.
 */
export function selectableViewTypes(): string[] {
    return ['auto', ...selectableViewIds().filter(id => id in VIEW_COMPONENTS)];
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
    // dispatch to the registry-keyed component for this view type; an unknown type maps to nothing (toolbar still shows)
    const ViewComponent = VIEW_COMPONENTS[props.type];
    const enriched_props: ViewProps = {
        ...props,
        display_options: { ...display_options, deepest },
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
                    naturalColumnOrder={toolbar.natural_column_order}
                    collisions={collisions}
                    activeDrawer={drawers.active_drawer}
                    requestedJumpPath={jump.requested_jump_path}
                    onFolderJump={handle_folder_click}
                    onFileJump={handle_file_jump}
                    gearButtonRef={drawers.gear_button_ref}
                    onCloseDrawer={drawers.close_drawer}
                    onSettingsToggle={drawers.toggle_settings}
                    onInsertOpen={insert.open_insert_modal}
                    onSettingChange={toolbar.handle_setting_change}
                    onGlobalSettingChange={toolbar.handle_global_setting_change}
                    onColumnOrderChange={toolbar.handle_column_order_change}
                    onGroupByChange={toolbar.handle_group_by_change}
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

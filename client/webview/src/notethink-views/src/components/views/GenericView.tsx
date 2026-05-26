import Debug from "debug";
import React, { lazy } from "react";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps } from "../../types/NoteProps";
import InsertModal from "../InsertModal";
import GenericViewBreadcrumb from "./generic/GenericViewBreadcrumb";
import GenericViewToolbar from "./generic/GenericViewToolbar";
import { useInsertModal } from "./generic/useInsertModal";
import { useToolbarDrawers } from "./generic/useToolbarDrawers";
import { useViewContext } from "./generic/useViewContext";
import { useViewHandlers } from "./generic/useViewHandlers";
import { useViewNavigation } from "./generic/useViewNavigation";
import { useViewToolbar } from "./generic/useViewToolbar";

const debug = Debug("nodejs:notethink-views:GenericView");

// dynamic import() is required by React.lazy for per-view code-splitting; static imports would pull every view into the initial bundle
const AutoView = lazy(() => import('./AutoView'));
const DocumentView = lazy(() => import('./DocumentView'));
const KanbanView = lazy(() => import('./KanbanView'));

export const SELECTABLE_VIEWTYPES = ['auto', 'document', 'kanban'];

export default function GenericView(props: ViewProps): React.ReactElement {
    // view context: cascaded display_options, parent context, visible notes, focus/selection
    const view_context = useViewContext(props);
    const { display_options, parent_context, parent_context_seq, notes_within_parent_context, deepest } = view_context;

    // view-level ViewApi + the folder/file dispatchers wired through it
    const { handlers, handle_folder_click, handle_apply_filters } = useViewHandlers(props, view_context.selection_ref);

    // at-most-one-open toolbar drawer (settings | files) with scroll-anchor / Escape / outside-click behaviour
    const { active_drawer, gear_button_ref, toggle_settings, toggle_files } = useToolbarDrawers(props.id);

    // keyboard navigation handler, registered on the parent-provided ref
    useViewNavigation({
        display_options,
        notes_within_parent_context,
        parent_context,
        parent_context_seq,
        handlers,
        navigation_command_ref: props.handlers?.onNavigationCommand,
    });

    // toolbar state: integration mode, natural column order, settings / column-order / cascade dispatchers
    const toolbar = useViewToolbar(props, handlers, display_options, notes_within_parent_context);

    // insert modal open state + insertion-point resolver
    const insert = useInsertModal(props, handlers);

    // determine the auto-resolved type label for the view selector
    const auto_resolved_type = props.nested?.auto_resolved_type;

    // create standard breadcrumb component for display in views
    const breadcrumb_trail = (
        <GenericViewBreadcrumb
            props={props}
            parentContext={parent_context}
            handlers={handlers}
            onFolderClick={handle_folder_click}
            onFileCountClick={toggle_files}
        />
    );

    // render toolbar and settings drawer at the leaf level only - when type is 'auto', AutoView will delegate to a concrete type which renders GenericView again with the toolbar
    const show_toolbar = props.type !== 'auto';

    const enriched_props: ViewProps = {
        ...props,
        display_options: {
            ...display_options,
            deepest: deepest,
        },
        notes: props.notes as Array<NoteProps>,
        notes_within_parent_context,
        nested: {
            ...props.nested,
            parent_context,
            breadcrumb_trail,
            auto_resolved_type,
        },
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
                    autoResolvedType={auto_resolved_type}
                    integrationMode={toolbar.integration_mode}
                    naturalColumnOrder={toolbar.natural_column_order}
                    activeDrawer={active_drawer}
                    gearButtonRef={gear_button_ref}
                    onSettingsToggle={toggle_settings}
                    onInsertOpen={insert.open_insert_modal}
                    onIntegrationChange={toolbar.handle_integration_change}
                    onSettingChange={toolbar.handle_setting_change}
                    onGlobalSettingChange={toolbar.handle_global_setting_change}
                    onColumnOrderChange={toolbar.handle_column_order_change}
                    onMakeDefault={toolbar.handle_make_default}
                    onResetToDefault={toolbar.handle_reset_to_default}
                    onApplyFilters={handle_apply_filters}
                    onCascadeWrite={toolbar.cascade_write_setting}
                />
            )}
            {props.type === 'auto' && <AutoView {...enriched_props} />}
            {props.type === 'document' && <DocumentView {...enriched_props} />}
            {props.type === 'kanban' && <KanbanView {...enriched_props} />}
            <InsertModal
                opened={insert.insert_modal_open}
                onClose={insert.close_insert_modal}
                onInsert={insert.handle_insert}
            />
        </>
    );
}

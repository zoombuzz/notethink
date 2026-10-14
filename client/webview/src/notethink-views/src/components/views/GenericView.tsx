import React, { lazy } from "react";
import { documentRootForStrip, hasVisibleCard } from "../../lib/noteops";
import { chainOf, isGroupedViewType, registryWithUserTypes } from "../../lib/viewregistryops";
import { INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode } from "../../types/IntegrationMode";
import type { UserViewType } from "../../types/Messages";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteAttributes from "../notes/GenericNoteAttributes";
import InsertModal from "../InsertModal";
import GenericViewBreadcrumb from "./generic/GenericViewBreadcrumb";
import GenericViewToolbar from "./generic/GenericViewToolbar";
import EmptyStoriesOverlay, { type FolderStatusMode } from "./EmptyStoriesOverlay";
import { useGenericView } from "./generic/useGenericView";
import view_styles from "../ViewRenderer.module.scss";

/*
 * Component per concrete view id, keyed by the ids the view registry declares. Dynamic import()
 * enables React.lazy per-view code-splitting; static imports would bloat the initial bundle. `auto`
 * is not a registry node, but the majority-vote meta-selection that delegates to a concrete type.
 * Adding a view is one registry entry plus one line here.
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

/**
 * The folder-aggregate status note to lay over the board, or undefined for none. Folder mode only:
 * a single file opened deliberately with no ### headings is unremarkable, so current_file mode never
 * shows one, while folder mode's columns render empty rather than blank and the note says why.
 * - scanning: discovery_scanning is set from the start of a discovery run until its first aggregate
 *   payload lands, but only while no card is actually VISIBLE yet - a per-file merge update can land
 *   notes well before the scan settles, and a doc whose every note sits in a lane the group-display
 *   hides must not drop the panel for an empty-looking board; while it shows, the board is not
 *   rendered at all, so no empty lane headings appear under it, and it never covers a board already
 *   showing a card. The same mode also covers the narrower window before discovery_scanning has even
 *   been raised yet - a folder-mode view restored from persisted state renders before any message
 *   from the extension host has arrived, so aggregate_total_discovered is undefined there too; without
 *   this the board flashed empty columns for a frame on every reopen
 * - no_match: discovery settled and the include pattern matched zero files
 * - no_stories: discovery settled, files were found, but none held a story or task heading
 */
function resolveFolderStatus(show_toolbar: boolean, integration_mode: ConcreteIntegrationMode, view_props: ViewProps, has_visible_card: boolean): FolderStatusMode | undefined {
    if (!show_toolbar || integration_mode !== INTEGRATION_MODE_FOLDER) { return undefined; }
    const has_notes = (view_props.note_count ?? 0) > 0;
    if (view_props.discovery_scanning) { return has_visible_card ? undefined : 'scanning'; }
    if (view_props.aggregate_total_discovered === undefined) { return has_visible_card ? undefined : 'scanning'; }
    if (view_props.aggregate_total_discovered === 0) { return 'no_match'; }
    return has_notes ? undefined : 'no_stories';
}

/**
 * Renders one view's chrome (breadcrumb, toolbar, drawers) around its registry-resolved view component.
 *
 * The stamped display_options.settings.cardType is skipped at an `auto` level, because AutoView is
 * about to stamp its own and reads this same field to recover the user's raw choice; stamping over it
 * here would cost the card tab its "Auto (Sticky)" label. display_options.activity_doc_path is the
 * single-file fallback for joining a story to agent activity: folder-mode notes carry an origin and
 * need none, and a single-file note's contract binds on a workspace-relative path, so an absolute one
 * is deliberately not substituted.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export default function GenericView(props: ViewProps): React.ReactElement {
    // view_props carries admitted virtual notes and the guarded handler surface to every hook and view below
    const { view_props, view_context, handlers, handle_folder_click, handle_apply_filters, handle_file_jump, drawers, jump, collisions, toolbar, insert, auto_resolved_type } = useGenericView(props);
    const { display_options, parent_context, deepest, notes_within_parent_context } = view_context;
    // document-level front-matter strip, built once here for single-file mode so leaf views don't each re-derive it
    const document_root = documentRootForStrip(view_props.notes, display_options.integration_mode);
    const document_strip = document_root ? <GenericNoteAttributes {...document_root} /> : undefined;
    const breadcrumb_trail = (
        <GenericViewBreadcrumb
            props={view_props}
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
    // toolbar renders only at the leaf level; 'auto' delegates to AutoView, which renders GenericView again
    const show_toolbar = view_props.type !== 'auto';
    // the registry-keyed component for this type, inheriting a minted type's renderer from its parent
    const ViewComponent = viewComponentFor(view_props.type, display_options.settings?.viewUserTypes ?? []);
    // whether a card is actually visible now: any note at all outside a grouped view, else one outside a hidden lane
    const is_grouped_view = isGroupedViewType(view_props.type, registryWithUserTypes(display_options.settings?.viewUserTypes ?? []));
    const has_visible_card = hasVisibleCard(notes_within_parent_context, is_grouped_view, toolbar.active_axis_key, display_options.settings?.groupDisplay);
    // the toolbar's integration_mode, so the note tracks the same mode the Files drawer it opens gates on
    const folder_status = resolveFolderStatus(show_toolbar, toolbar.integration_mode, view_props, has_visible_card);
    // props for the rendered view component, enriched with the resolved card type and activity doc path
    const enriched_props: ViewProps = {
        ...view_props,
        display_options: {
            ...display_options,
            deepest,
            activity_doc_path: view_props.doc_relative_path,
            settings: show_toolbar
                ? { ...display_options.settings, cardType: toolbar.resolved_card_type }
                : display_options.settings,
        },
        notes: view_props.notes as Array<NoteProps>,
        notes_within_parent_context,
        nested: { ...view_props.nested, parent_context, breadcrumb_trail, auto_resolved_type, document_strip, document_root },
        handlers,
    };
    return (
        <>
            {show_toolbar && (
                <GenericViewToolbar
                    props={view_props}
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
                    onGroupDisplayChange={toolbar.handle_group_display_change}
                    onMakeDefault={toolbar.handle_make_default}
                    onResetToDefault={toolbar.handle_reset_to_default}
                    onRestoreBuiltinDefault={toolbar.handle_restore_builtin_default}
                    onApplyFilters={handle_apply_filters}
                />
            )}
            <div className={view_styles.viewContentRegion}>
                {/* while scanning with no visible card the panel stands in for the board, so no empty lane headings show */}
                {ViewComponent && folder_status !== 'scanning' && <ViewComponent {...enriched_props} />}
                {folder_status && (
                    <EmptyStoriesOverlay
                        mode={folder_status}
                        includeFilter={view_props.includeFilter}
                        onOpenFilesDrawer={drawers.toggle_files}
                    />
                )}
            </div>
            <InsertModal
                opened={insert.insert_modal_open}
                onClose={insert.close_insert_modal}
                onInsert={insert.handle_insert}
            />
        </>
    );
}

import React, { lazy, MouseEvent, useCallback, useEffect, useMemo, useRef } from "react";
import Debug from "debug";
import type { ViewProps, ViewApi } from "../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions, NoteHandlers, ClickPositionInfo } from "../../types/NoteProps";
import {
    calculateTextChangesForCheckbox,
    findDeepestNote,
    findSelectedNotes,
    resolveCaretPosition,
    standardNoteOrder,
} from "../../lib/noteops";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import BreadcrumbTrail from "./BreadcrumbTrail";
import ViewTypeSelector from "./ViewTypeSelector";
import ViewIntegrationSelector, { type IntegrationMode } from "./ViewIntegrationSelector";
import master_view_styles from "../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:GenericView");

const AutoView = lazy(() => import('./AutoView'));
const DocumentView = lazy(() => import('./DocumentView'));
const KanbanView = lazy(() => import('./KanbanView'));

export const SELECTABLE_VIEWTYPES = ['auto', 'document', 'kanban'];

interface ViewDisplayDeepestProps {
    selectable_level: number;
    rendered_level: number;
    note?: NoteProps;
}

export default function GenericView(props: ViewProps) {

    // set up all-view-level (global) default display_options, overridden by props (ViewManager state) and parent view props
    const display_options: NoteDisplayOptions = {
        parent_context_seq: 0,
        ...props.display_options,
        settings: {
            show_line_numbers: false,
            show_context_bars: true,
            scroll_text_into_view: true,
            ...props.parent_view?.parent_view?.parent_view?.display_options?.settings,
            ...props.parent_view?.parent_view?.display_options?.settings,
            ...props.parent_view?.display_options?.settings,
            ...props.display_options?.settings,
        },
    };

    // parse parent note (often partly displayed)
    const parent_context_seq: number = display_options?.parent_context_seq || 0;
    const unparsed_parent_context: NoteProps | undefined = (props.notes || []).at(parent_context_seq);

    const memoized_parent_context = useMemo(() => {
        if (unparsed_parent_context) {
            return renderMarkdownNoteHeadline(unparsed_parent_context);
        }
        return undefined;
    }, [
        unparsed_parent_context?.headline_raw,
        unparsed_parent_context?.body_raw,
    ]);

    // get latest updates: always take the `props` version of `note` attributes
    const parent_context = unparsed_parent_context ? {
        ...unparsed_parent_context,
    } : undefined;

    // derive the set of notes visible in this view and what level notes to display
    const notes_within_parent_context: Array<NoteProps> = (parent_context ?
        parent_context.child_notes :
        (props.notes || [])
    ) as Array<NoteProps>;
    notes_within_parent_context?.sort(standardNoteOrder);
    display_options.level = (notes_within_parent_context && notes_within_parent_context.length > 0 ? notes_within_parent_context[0].level : 0);

    const deepest: ViewDisplayDeepestProps = {
        selectable_level: display_options.level + 0,
        rendered_level: display_options.level + 2,
    };

    // look for the deepest note that the caret lies within
    deepest.note = useMemo(() => {
        if (props.selection !== undefined) {
            return findDeepestNote(props.notes || [], props.selection?.main.head) || parent_context;
        }
        return parent_context;
    }, [
        parent_context,
        props.notes,
        props.selection,
    ]);

    if (deepest.note) {
        display_options.focused_notes = (deepest.note.parent_notes || []).concat([deepest.note]);
        display_options.focused_seqs = display_options.focused_notes.map((note: NoteProps) => note.seq);
    }

    // find the set of notes within this view that are currently selected
    display_options.selected_notes = useMemo(() => {
        if (props.selection?.main.head === undefined || props.selection?.main.anchor === undefined) { return []; }
        if (props.selection?.main.head === props.selection?.main.anchor) { return []; }
        return findSelectedNotes([parent_context as NoteProps, ...(notes_within_parent_context || [])], props.selection);
    }, [
        parent_context,
        notes_within_parent_context,
        props.selection
    ]);
    display_options.selected_seqs = display_options.selected_notes?.map((note: NoteProps) => note.seq) || [];

    // set up view-level default handlers, overridden by props
    const handlers: ViewApi = Object.assign({

        // stubs for required ViewApi methods; overridden by props.handlers
        setViewManagedState: props.handlers?.setViewManagedState ?? (() => {}),
        deleteViewFromManagedState: props.handlers?.deleteViewFromManagedState ?? (() => {}),
        revertAllViewsToDefaultState: props.handlers?.revertAllViewsToDefaultState ?? (() => {}),

        setParentContextSeq: (seq: number) => {
            // local state management for view context navigation
            handlers?.setViewManagedState?.([{
                id: props.id,
                type: props.type,
                display_options: {
                    parent_context_seq: seq,
                }
            }]);
        },

        click: (event: MouseEvent<HTMLElement>, note: NoteProps, click_profile: ClickPositionInfo) => {
            // use dedicated single-click or double-click handlers if set
            if (event.detail === 1 && note.handlers?.singleClick) {
                note.handlers.singleClick(event, note, click_profile);
            } else if (event.detail === 2 && note.handlers?.doubleClick) {
                note.handlers.doubleClick(event, note, click_profile);
            } else if ((event.target as HTMLInputElement)?.type === 'checkbox') {
                const target = event.target as HTMLInputElement | undefined;
                const checkbox_text = target?.nextSibling?.textContent || '';
                const text_context: string[] = [];
                target?.parentElement && text_context.push(target?.parentElement?.textContent as string);
                const changes = calculateTextChangesForCheckbox(note, target?.checked || false, checkbox_text, text_context);
                // fire text edit via postMessage
                if (props.handlers?.postMessage && changes.length > 0) {
                    // optimistic: toggle checkbox visually before round-trip completes
                    if (target) { target.checked = !target.checked; }
                    props.handlers.postMessage({
                        type: 'editText',
                        changes: changes,
                    });
                }
            } else {
                // click note to reveal in editor
                const caret_pos = resolveCaretPosition(click_profile, note);
                if (note.selected) {
                    // click deselects and returns to focused
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                    });
                } else if (props.selection?.main.head === caret_pos) {
                    // click focused note to make selected
                    props.handlers?.postMessage?.({
                        type: 'selectRange',
                        from: click_profile.selection_from ?? click_profile.from,
                        to: click_profile.selection_to ?? click_profile.to,
                    });
                } else {
                    // click note to make focused
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                    });
                }
            }
            if (event.stopPropagation) { event.stopPropagation(); }
        },

        getClearHandler: (focused_notes: Array<NoteProps> | undefined) => {
            return ((event: MouseEvent<HTMLElement>) => {
                if (event.stopPropagation) { event.stopPropagation(); }
                if (!focused_notes?.length) { return; }
                const deepest_note = focused_notes[focused_notes.length - 1];
                if (deepest_note.seq === 0) { return; }
                const deepest_note_end = deepest_note.position.end_body?.offset || deepest_note.position.end.offset;
                props.handlers?.postMessage?.({
                    type: 'revealRange',
                    from: deepest_note_end + 1,
                });
            });
        },

        setCaretPosition: (position: number) => {
            props.handlers?.postMessage?.({
                type: 'revealRange',
                from: position,
            });
        },

        postMessage: props.handlers?.postMessage,

    }, props.handlers);

    // handle breadcrumb directory click — switch to directory integration mode
    const handleDirectoryClick = useCallback((dir_path: string) => {
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                integration_mode: 'directory',
            },
        }]);
        handlers.postMessage?.({
            type: 'setIntegration',
            mode: 'directory',
            path: dir_path,
        });
    }, [handlers, props.id]);

    // create standard breadcrumb component for display in views
    const breadcrumb_trail = <BreadcrumbTrail
        {...(parent_context || { seq: 0, level: 0, children_body: [], children: [], position: { start: { offset: 0, line: 0 }, end: { offset: 0, line: 0 } }, headline_raw: '', body_raw: '' })}
        doc_path={props.doc_path}
        doc_relative_path={props.doc_relative_path}
        workspace_root={props.workspace_root}
        onDirectoryClick={handleDirectoryClick}
        handlers={{
            setParentContextSeq: handlers?.setParentContextSeq
        }}
        parent_notes={parent_context ? parent_context.parent_notes?.concat([parent_context]) : []}
    />;

    // navigation callback — registered on the ref so ExtensionReceiver can invoke it
    const handleNavigation = useCallback((direction: string) => {
        const focused_seqs = display_options.focused_seqs || [];
        const focused_notes_list = display_options.focused_notes || [];

        switch (direction) {
            case 'clearFocus': {
                const clear_handler = handlers.getClearHandler?.(focused_notes_list);
                if (clear_handler) {
                    clear_handler({ stopPropagation: () => {} } as MouseEvent<HTMLElement>);
                }
                break;
            }
            case 'up': {
                if (!notes_within_parent_context?.length) {break;}
                const deepest_focused_seq = focused_seqs.length > 0 ? focused_seqs[focused_seqs.length - 1] : -1;
                const current_index = notes_within_parent_context.findIndex(n => n.seq === deepest_focused_seq);
                const prev_index = current_index > 0 ? current_index - 1 : 0;
                const target_note = notes_within_parent_context[prev_index];
                if (target_note) {
                    handlers.setCaretPosition?.(target_note.position.start.offset);
                }
                break;
            }
            case 'down': {
                if (!notes_within_parent_context?.length) {break;}
                const deepest_focused_seq = focused_seqs.length > 0 ? focused_seqs[focused_seqs.length - 1] : -1;
                const current_index = notes_within_parent_context.findIndex(n => n.seq === deepest_focused_seq);
                const next_index = current_index < notes_within_parent_context.length - 1 ? current_index + 1 : current_index;
                const target_note = notes_within_parent_context[next_index];
                if (target_note) {
                    handlers.setCaretPosition?.(target_note.position.start.offset);
                }
                break;
            }
            case 'drillIn': {
                if (!focused_notes_list.length) {break;}
                const deepest_note = focused_notes_list[focused_notes_list.length - 1];
                if (deepest_note.child_notes?.length) {
                    handlers.setParentContextSeq?.(deepest_note.seq);
                }
                break;
            }
            case 'drillOut': {
                if (parent_context_seq === 0) {break;}
                // navigate to grandparent or root
                const current_parent = parent_context;
                if (current_parent?.parent_notes?.length) {
                    const grandparent = current_parent.parent_notes[current_parent.parent_notes.length - 1];
                    handlers.setParentContextSeq?.(grandparent.seq);
                } else {
                    handlers.setParentContextSeq?.(0);
                }
                break;
            }
        }
    }, [
        display_options.focused_seqs,
        display_options.focused_notes,
        notes_within_parent_context,
        parent_context,
        parent_context_seq,
        handlers,
    ]);

    // register navigation callback on the ref provided by the parent
    useEffect(() => {
        if (props.handlers?.onNavigationCommand) {
            props.handlers.onNavigationCommand.current = handleNavigation;
        }
        return () => {
            if (props.handlers?.onNavigationCommand) {
                props.handlers.onNavigationCommand.current = undefined;
            }
        };
    }, [handleNavigation, props.handlers?.onNavigationCommand]);

    // determine the auto-resolved type label for the view selector
    const auto_resolved_type = props.nested?.auto_resolved_type;

    // integration mode (current_file vs directory)
    const integration_mode: IntegrationMode = (props.display_options?.integration_mode as IntegrationMode) || 'current_file';

    const handleIntegrationChange = useCallback((mode: IntegrationMode) => {
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                integration_mode: mode,
            },
        }]);
        if (mode === 'directory' && props.doc_path) {
            const dir_path = props.doc_path.replace(/\/[^/]+$/, '');
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: 'directory',
                path: dir_path,
            });
        }
    }, [handlers, props.id, props.doc_path]);

    // settings callback ref — child views (e.g. KanbanView) register their handler
    const settingsClickRef = useRef<(() => void) | undefined>(undefined);

    // render toolbar at the leaf level only — when type is 'auto', AutoView will delegate
    // to a concrete type which renders GenericView again with the toolbar
    const show_toolbar = props.type !== 'auto';

    const toolbar = show_toolbar ? (
        <div className={master_view_styles.viewToolbar} data-testid="view-toolbar">
            <ViewIntegrationSelector
                currentMode={integration_mode}
                onChange={handleIntegrationChange}
            />
            <div className={master_view_styles.viewToolbarBreadcrumb}>
                {breadcrumb_trail}
            </div>
            <ViewTypeSelector
                currentType={(props.nested?.replaced_attributes?.type as string) || props.type}
                autoResolvedType={auto_resolved_type}
                handlers={handlers}
                id={props.id}
            />
            <button
                data-testid="view-settings-button"
                onClick={(e) => { e.stopPropagation(); settingsClickRef.current?.(); }}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.1em',
                    padding: '0 0.3em',
                    color: 'var(--vscode-foreground, inherit)',
                    opacity: 0.6,
                    marginLeft: '0.3em',
                }}
                title="Settings"
                aria-label="Settings"
            >
                &#9881;
            </button>
        </div>
    ) : null;

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
        handlers: {
            ...handlers,
            onSettingsClick: settingsClickRef,
        },
    };

    return (
        <>
            {toolbar}
            {props.type === 'auto' && <AutoView {...enriched_props} />}
            {props.type === 'document' && <DocumentView {...enriched_props} />}
            {props.type === 'kanban' && <KanbanView {...enriched_props} />}
        </>
    );
}

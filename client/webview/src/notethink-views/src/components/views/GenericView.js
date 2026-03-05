import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { lazy, useCallback, useEffect, useMemo } from "react";
import Debug from "debug";
import { calculateTextChangesForCheckbox, findDeepestNote, findSelectedNotes, resolveCaretPosition, standardNoteOrder, } from "../../lib/noteops";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import BreadcrumbTrail from "./BreadcrumbTrail";
const debug = Debug("nodejs:notethink-views:GenericView");
const AutoView = lazy(() => import('./AutoView'));
const DocumentView = lazy(() => import('./DocumentView'));
const KanbanView = lazy(() => import('./KanbanView'));
export const SELECTABLE_VIEWTYPES = ['auto', 'document', 'kanban'];
export default function GenericView(props) {
    // set up all-view-level (global) default display_options, overridden by props (ViewManager state) and parent view props
    const display_options = {
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
    const parent_context_seq = display_options?.parent_context_seq || 0;
    const unparsed_parent_context = (props.notes || []).at(parent_context_seq);
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
    const notes_within_parent_context = (parent_context ?
        parent_context.child_notes :
        (props.notes || []));
    notes_within_parent_context?.sort(standardNoteOrder);
    display_options.level = (notes_within_parent_context && notes_within_parent_context.length > 0 ? notes_within_parent_context[0].level : 0);
    const deepest = {
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
        display_options.focused_seqs = display_options.focused_notes.map((note) => note.seq);
    }
    // find the set of notes within this view that are currently selected
    display_options.selected_notes = useMemo(() => {
        if (props.selection?.main.head === undefined || props.selection?.main.anchor === undefined) {
            return [];
        }
        if (props.selection?.main.head === props.selection?.main.anchor) {
            return [];
        }
        return findSelectedNotes([parent_context, ...(notes_within_parent_context || [])], props.selection);
    }, [
        parent_context,
        notes_within_parent_context,
        props.selection
    ]);
    display_options.selected_seqs = display_options.selected_notes?.map((note) => note.seq) || [];
    // set up view-level default handlers, overridden by props
    const handlers = Object.assign({
        // stubs for required ViewApi methods; overridden by props.handlers
        setViewManagedState: props.handlers?.setViewManagedState ?? (() => { }),
        deleteViewFromManagedState: props.handlers?.deleteViewFromManagedState ?? (() => { }),
        revertAllViewsToDefaultState: props.handlers?.revertAllViewsToDefaultState ?? (() => { }),
        setParentContextSeq: (seq) => {
            // local state management for view context navigation
            handlers?.setViewManagedState?.([{
                    id: props.id,
                    type: props.type,
                    display_options: {
                        parent_context_seq: seq,
                    }
                }]);
        },
        click: (event, note, click_profile) => {
            // use dedicated single-click or double-click handlers if set
            if (event.detail === 1 && note.handlers?.singleClick) {
                note.handlers.singleClick(event, note, click_profile);
            }
            else if (event.detail === 2 && note.handlers?.doubleClick) {
                note.handlers.doubleClick(event, note, click_profile);
            }
            else if (event.target?.type === 'checkbox') {
                const target = event.target;
                const checkbox_text = target?.nextSibling?.textContent || '';
                const text_context = [];
                target?.parentElement && text_context.push(target?.parentElement?.textContent);
                const changes = calculateTextChangesForCheckbox(note, target?.checked || false, checkbox_text, text_context);
                // fire text edit via postMessage
                if (props.handlers?.postMessage && changes.length > 0) {
                    props.handlers.postMessage({
                        type: 'editText',
                        changes: changes,
                    });
                }
            }
            else {
                // click note to reveal in editor
                const caret_pos = resolveCaretPosition(click_profile, note);
                if (note.selected) {
                    // click deselects and returns to focused
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                    });
                }
                else if (props.selection?.main.head === caret_pos) {
                    // click focused note to make selected
                    props.handlers?.postMessage?.({
                        type: 'selectRange',
                        from: click_profile.selection_from ?? click_profile.from,
                        to: click_profile.selection_to ?? click_profile.to,
                    });
                }
                else {
                    // click note to make focused
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                    });
                }
            }
            if (event.stopPropagation) {
                event.stopPropagation();
            }
        },
        getClearHandler: (focused_notes) => {
            return ((event) => {
                if (event.stopPropagation) {
                    event.stopPropagation();
                }
                if (!focused_notes?.length) {
                    return;
                }
                const deepest_note = focused_notes[focused_notes.length - 1];
                if (deepest_note.seq === 0) {
                    return;
                }
                const deepest_note_end = deepest_note.position.end_body?.offset || deepest_note.position.end.offset;
                props.handlers?.postMessage?.({
                    type: 'revealRange',
                    from: deepest_note_end + 1,
                });
            });
        },
        setCaretPosition: (position) => {
            props.handlers?.postMessage?.({
                type: 'revealRange',
                from: position,
            });
        },
        postMessage: props.handlers?.postMessage,
    }, props.handlers);
    // create standard breadcrumb component for display in views
    const breadcrumb_trail = parent_context && _jsx(BreadcrumbTrail, { ...parent_context, handlers: {
            setParentContextSeq: handlers?.setParentContextSeq
        }, parent_notes: parent_context.parent_notes?.concat([parent_context]) });
    // navigation callback — registered on the ref so ExtensionReceiver can invoke it
    const handleNavigation = useCallback((direction) => {
        const focused_seqs = display_options.focused_seqs || [];
        const focused_notes_list = display_options.focused_notes || [];
        switch (direction) {
            case 'clearFocus': {
                const clear_handler = handlers.getClearHandler?.(focused_notes_list);
                if (clear_handler) {
                    clear_handler({ stopPropagation: () => { } });
                }
                break;
            }
            case 'up': {
                if (!notes_within_parent_context?.length) {
                    break;
                }
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
                if (!notes_within_parent_context?.length) {
                    break;
                }
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
                if (!focused_notes_list.length) {
                    break;
                }
                const deepest_note = focused_notes_list[focused_notes_list.length - 1];
                if (deepest_note.child_notes?.length) {
                    handlers.setParentContextSeq?.(deepest_note.seq);
                }
                break;
            }
            case 'drillOut': {
                if (parent_context_seq === 0) {
                    break;
                }
                // navigate to grandparent or root
                const current_parent = parent_context;
                if (current_parent?.parent_notes?.length) {
                    const grandparent = current_parent.parent_notes[current_parent.parent_notes.length - 1];
                    handlers.setParentContextSeq?.(grandparent.seq);
                }
                else {
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
    const enriched_props = {
        ...props,
        display_options: {
            ...display_options,
            deepest: deepest,
        },
        notes: props.notes,
        notes_within_parent_context,
        nested: {
            ...props.nested,
            parent_context,
            breadcrumb_trail,
        },
        handlers: handlers,
    };
    return (_jsxs(_Fragment, { children: [props.type === 'auto' && _jsx(AutoView, { ...enriched_props }), props.type === 'document' && _jsx(DocumentView, { ...enriched_props }), props.type === 'kanban' && _jsx(KanbanView, { ...enriched_props })] }));
}

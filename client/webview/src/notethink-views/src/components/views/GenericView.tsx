import Debug from "debug";
import React, { lazy, MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as l10n from "@vscode/l10n";
import type { ViewProps, ViewApi } from "../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions, NoteHandlers, ClickPositionInfo } from "../../types/NoteProps";
import {
    calculateTextChangesForCheckbox,
    findDeepestNote,
    findSelectedNotes,
    resolveCaretPosition,
    noteOrder,
} from "../../lib/noteops";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import BreadcrumbTrail from "./BreadcrumbTrail";
import ViewTypeSelector from "./ViewTypeSelector";
import ViewIntegrationSelector, { type IntegrationMode } from "./ViewIntegrationSelector";
import InsertModal from "../InsertModal";
import SettingsDocumentDrawer from "./SettingsDocumentDrawer";
import SettingsKanbanDrawer from "./SettingsKanbanDrawer";
import ToolbarDrawer from "./ToolbarDrawer";
import FilesDrawer from "./FilesDrawer";
import type { CommonSettingKey } from "./SettingsCommonControls";
import type { GlobalSettingKey } from "../../types/Messages";
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

    // ref for current selection - the click handler reads this to avoid stale closures
    // when MarkdownNote's memo prevents re-render after a selection-only change
    const selection_ref = useRef(props.selection);
    selection_ref.current = props.selection;

    // set up all-view-level (global) default display_options, overridden by props (ViewManager state) and parent view props
    const display_options: NoteDisplayOptions = {
        parent_context_seq: 0,
        ...props.display_options,
        settings: {
            show_line_numbers: false,
            watch_unopened_files_in_viewer: true,
            show_context_bars: true,
            scroll_text_into_view: true,
            scroll_note_into_view: true,
            auto_expand_focused_note: false,
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
    notes_within_parent_context?.sort(noteOrder);
    display_options.level = (notes_within_parent_context && notes_within_parent_context.length > 0 ? notes_within_parent_context[0].level : 0);

    const deepest: ViewDisplayDeepestProps = {
        selectable_level: display_options.level + 0,
        rendered_level: display_options.level + 2,
    };

    // look for the deepest note that the caret lies within
    deepest.note = useMemo(() => {
        if (props.selection !== undefined) {
            let caret_pos = props.selection?.main.head;
            // clamp caret to document bounds - selection may arrive before MDAST re-parse
            const root_end = props.notes?.[0]?.position?.end?.offset;
            if (caret_pos !== undefined && root_end !== undefined && caret_pos > root_end) {
                caret_pos = root_end;
            }
            return findDeepestNote(props.notes || [], caret_pos) || parent_context;
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
    // pass caret offset so clipped notes can scroll their body to the caret position
    display_options.caret_offset = props.selection?.main.head;

    // find the set of notes within this view that are currently selected (use full notes list so subnotes are included)
    display_options.selected_notes = useMemo(() => {
        if (props.selection?.main.head === undefined || props.selection?.main.anchor === undefined) { return []; }
        if (props.selection?.main.head === props.selection?.main.anchor) { return []; }
        return findSelectedNotes(props.notes || [], props.selection);
    }, [
        props.notes,
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
                try {
                    const target = event.target as HTMLInputElement | undefined;
                    const checkbox_text = target?.nextSibling?.textContent || '';
                    const text_context: string[] = [];
                    target?.parentElement && text_context.push(target?.parentElement?.textContent as string);
                    debug('checkbox click: checked=%s text=%s note.seq=%d note.type=%s body_raw.length=%d',
                        target?.checked, checkbox_text, note.seq, note.type, note.body_raw?.length ?? -1);
                    const changes = calculateTextChangesForCheckbox(note, target?.checked || false, checkbox_text, text_context);
                    debug('checkbox changes: %O', changes);
                    // fire text edit via postMessage
                    if (props.handlers?.postMessage && changes.length > 0) {
                        props.handlers.postMessage({
                            type: 'editText',
                            changes: changes,
                            // aggregate mode: route to the origin file; undefined in single-file mode
                            docPath: note.origin?.doc_path,
                        });
                    }
                } catch (err) {
                    console.error('checkbox click handler failed:', err);
                }
            } else {
                // click note to reveal in editor;
                // read selection from ref to avoid stale closure when memo prevents re-render
                const caret_pos = resolveCaretPosition(click_profile, note);
                const current_head = selection_ref.current?.main.head;
                const origin_doc_path = note.origin?.doc_path;
                if (event.detail === 2) {
                    // double-click selects the note immediately
                    props.handlers?.postMessage?.({
                        type: 'selectRange',
                        from: click_profile.selection_from ?? click_profile.from,
                        to: click_profile.selection_to ?? click_profile.to,
                        docPath: origin_doc_path,
                    });
                } else if (note.selected) {
                    // click deselects and returns to focused
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                        docPath: origin_doc_path,
                    });
                } else if (current_head === caret_pos) {
                    // click focused note to make selected
                    props.handlers?.postMessage?.({
                        type: 'selectRange',
                        from: click_profile.selection_from ?? click_profile.from,
                        to: click_profile.selection_to ?? click_profile.to,
                        docPath: origin_doc_path,
                    });
                } else {
                    // click note to make focused
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                        docPath: origin_doc_path,
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
                    docPath: deepest_note.origin?.doc_path,
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

    // handle breadcrumb folder click - switch to (or narrow within) folder integration mode
    const handleFolderClick = useCallback((folder_path: string) => {
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                integration_mode: 'folder',
                integration_path: folder_path,
            },
        }]);
        handlers.postMessage?.({
            type: 'setIntegration',
            mode: 'folder',
            path: folder_path,
        });
    }, [handlers, props.id]);

    // at most one toolbar drawer open at a time (settings | files); shares the scroll-anchor + Escape behaviour
    const [active_drawer, setActiveDrawer] = useState<'none' | 'settings' | 'files'>('none');
    const gear_button_ref = useRef<HTMLButtonElement>(null);
    // the element whose viewport position is held stable across the open/close animation (and refocused on Escape) — the gear for settings, the breadcrumb count for files
    const anchor_el_ref = useRef<HTMLElement | null>(null);
    const anchor_top_ref = useRef<number | null>(null);

    // toggle a drawer; capture the trigger element's viewport position so the scroll-anchor effect can keep it stable through the open/close animation
    const toggleDrawer = useCallback((which: 'settings' | 'files', anchor: HTMLElement | null) => {
        if (anchor) {
            anchor_el_ref.current = anchor;
            anchor_top_ref.current = anchor.getBoundingClientRect().top;
        }
        setActiveDrawer(prev => (prev === which ? 'none' : which));
    }, []);

    const handleSettingsToggle = useCallback(() => {
        toggleDrawer('settings', gear_button_ref.current);
    }, [toggleDrawer]);

    const handleFileCountClick = useCallback((anchor: HTMLElement) => {
        toggleDrawer('files', anchor);
    }, [toggleDrawer]);

    // persist edited globs + per-file story cap to per-view state (survives reload) and post a background setIntegration so the extension re-discovers the whole aggregate with the new filters
    // the cap is webview-only: it is persisted in view state and applied by mergeAggregateRoot but is NOT included in the setIntegration round-trip
    const handleApplyFilters = useCallback((next_include: string, next_exclude: string, next_max_notes_per_file: number) => {
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                aggregate_include: next_include,
                aggregate_exclude: next_exclude,
                aggregate_max_notes_per_file: next_max_notes_per_file,
            },
        }]);
        const integration_path = props.display_options?.integration_path;
        if (integration_path) {
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: 'folder',
                path: integration_path,
                include: next_include,
                exclude: next_exclude,
            });
        }
    }, [handlers, props.id, props.display_options?.integration_path]);

    // create standard breadcrumb component for display in views
    const breadcrumb_trail = <BreadcrumbTrail
        {...(parent_context || { seq: 0, level: 0, children_body: [], children: [], position: { start: { offset: 0, line: 0 }, end: { offset: 0, line: 0 } }, headline_raw: '', body_raw: '' })}
        doc_path={props.doc_path}
        doc_relative_path={props.doc_relative_path}
        workspace_root={props.workspace_root}
        integration_path={props.display_options?.integration_mode === 'folder' ? props.display_options?.integration_path : undefined}
        file_count={props.file_count}
        note_count={props.note_count}
        aggregate_total_discovered={props.aggregate_total_discovered}
        onFolderClick={handleFolderClick}
        onFileCountClick={handleFileCountClick}
        handlers={{
            setParentContextSeq: handlers?.setParentContextSeq
        }}
        parent_notes={parent_context ? parent_context.parent_notes?.concat([parent_context]) : []}
    />;

    // navigation callback - registered on the ref so ExtensionReceiver can invoke it
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
                    // postMessage directly so we can attach the origin doc path in aggregate mode
                    handlers.postMessage?.({
                        type: 'revealRange',
                        from: target_note.position.start.offset,
                        docPath: target_note.origin?.doc_path,
                    });
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
                    handlers.postMessage?.({
                        type: 'revealRange',
                        from: target_note.position.start.offset,
                        docPath: target_note.origin?.doc_path,
                    });
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

    // integration mode (current_file vs folder)
    const integration_mode: IntegrationMode = (props.display_options?.integration_mode as IntegrationMode) || 'current_file';

    const handleIntegrationChange = useCallback((mode: IntegrationMode) => {
        const folder_path = mode === 'folder' && props.doc_path
            ? props.doc_path.replace(/\/[^/]+$/, '')
            : undefined;
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                integration_mode: mode,
                integration_path: folder_path,
            },
        }]);
        if (mode === 'folder' && folder_path) {
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: 'folder',
                path: folder_path,
            });
        } else if (mode === 'current_file') {
            // notify the extension so it disposes the aggregate watcher and re-sends just the active doc
            // without this the stale aggregate docs keep rendering as stacked single-file views
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: 'current_file',
            });
        }
    }, [handlers, props.id, props.doc_path]);

    // natural column order for the Kanban drawer (alphabetical + 'untagged' last)
    const natural_column_order = useMemo<string[]>(() => {
        if (props.type !== 'kanban') { return []; }
        const status_values = new Set<string>();
        for (const note of (notes_within_parent_context || [])) {
            if (note.linetags?.status?.value) {
                status_values.add(note.linetags.status.value);
            }
        }
        return [...Array.from(status_values).sort(), 'untagged'];
    }, [props.type, notes_within_parent_context]);

    const arraysEqual = (a: string[], b: string[]): boolean => {
        if (a.length !== b.length) { return false; }
        return a.every((value, index) => value === b[index]);
    };

    // real-time apply: per-view setting change dispatches setViewManagedState immediately. Global keys are stripped so they don't get baked into per-view state — the extension owns them via vscode workspace config
    const handleSettingChange = useCallback((key: CommonSettingKey, value: boolean) => {
        const { show_line_numbers: _sln, watch_unopened_files_in_viewer: _wu, ...per_view_settings } = display_options.settings || {};
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                settings: {
                    ...per_view_settings,
                    [key]: value,
                },
            },
        }]);
    }, [handlers, props.id, display_options.settings]);

    // real-time apply: global setting goes via postMessage; the extension writes it to vscode workspace/user config and echoes back via globalSettings
    const handleGlobalSettingChange = useCallback((key: GlobalSettingKey, value: boolean) => {
        handlers.postMessage?.({ type: 'updateGlobalSetting', setting: key, value });
    }, [handlers]);

    // real-time apply: Kanban column order change. Normalise: if next_order matches the natural order, persist undefined
    const handleColumnOrderChange = useCallback((next_order: string[]) => {
        const { show_line_numbers: _sln, watch_unopened_files_in_viewer: _wu, ...per_view_settings } = display_options.settings || {};
        const persisted_order = arraysEqual(next_order, natural_column_order) ? undefined : next_order;
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                settings: {
                    ...per_view_settings,
                    column_order: persisted_order,
                },
            },
        }]);
    }, [handlers, props.id, display_options.settings, natural_column_order]);

    // scroll-anchor the trigger element across the open/close animation so the content the user was looking at stays visible
    useLayoutEffect(() => {
        if (anchor_top_ref.current === null) { return; }
        const target_top = anchor_top_ref.current;
        let raf_id: number;
        const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 250; // 150ms anim + margin
        const tick = () => {
            const anchor = anchor_el_ref.current;
            if (anchor) {
                const current_top = anchor.getBoundingClientRect().top;
                const delta = current_top - target_top;
                if (Math.abs(delta) > 0.5) {
                    // legacy 2-arg form is always instant; avoids the 'instant' ScrollBehavior typing issue
                    window.scrollBy(0, delta);
                }
            }
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (now < deadline) {
                raf_id = requestAnimationFrame(tick);
            }
        };
        raf_id = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf_id);
    }, [active_drawer]);

    // Escape closes whichever drawer is open and returns focus to its trigger element
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                const anchor = anchor_el_ref.current;
                if (anchor) {
                    anchor_top_ref.current = anchor.getBoundingClientRect().top;
                }
                setActiveDrawer('none');
                requestAnimationFrame(() => anchor_el_ref.current?.focus());
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [active_drawer]);

    // outside-click closes whichever drawer is open; the trigger and the drawer body are excluded so the trigger's own onClick toggles cleanly and clicks inside the drawer don't dismiss
    // pointerdown (not click) fires before any onClick on the click target, so the drawer is gone by the time the clicked control runs its handler; no focus restore here — focus follows the pointer
    useEffect(() => {
        if (active_drawer === 'none') { return; }
        const drawer_id = `v${props.id}-${active_drawer}-drawer`;
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node | null;
            if (!target) { return; }
            const anchor = anchor_el_ref.current;
            if (anchor && anchor.contains(target)) { return; }
            const drawer_el = document.getElementById(drawer_id);
            if (drawer_el && drawer_el.contains(target)) { return; }
            setActiveDrawer('none');
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [active_drawer, props.id]);

    // insert modal state
    const [insert_modal_open, setInsertModalOpen] = useState(false);

    const handleInsert = useCallback((text: string, insert_point: string) => {
        const doc_text = props.doc_text || '';
        const head = props.selection?.main?.head ?? doc_text.length;
        let from: number;
        switch (insert_point) {
            case 'startOfLine': {
                const before = doc_text.lastIndexOf('\n', head - 1);
                from = before === -1 ? 0 : before + 1;
                break;
            }
            case 'endOfLine': {
                const after = doc_text.indexOf('\n', head);
                from = after === -1 ? doc_text.length : after;
                break;
            }
            case 'endOfNote':
                from = doc_text.length;
                break;
            default: // currentCaret
                from = head;
                break;
        }
        handlers.postMessage?.({ type: 'editText', changes: [{ from, insert: text }] });
    }, [props.doc_text, props.selection, handlers]);

    // render toolbar and settings drawer at the leaf level only - when type is 'auto', AutoView will delegate
    // to a concrete type which renders GenericView again with the toolbar
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
                        data-testid="view-insert-button"
                        onClick={(e) => { e.stopPropagation(); setInsertModalOpen(true); }}
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
                        title={l10n.t('Insert')}
                        aria-label={l10n.t('Insert')}
                    >
                        &#43;
                    </button>
                    <button
                        ref={gear_button_ref}
                        data-testid="view-settings-button"
                        onClick={(e) => { e.stopPropagation(); handleSettingsToggle(); }}
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
                        title={l10n.t('Settings')}
                        aria-label={l10n.t('Settings')}
                        aria-expanded={active_drawer === 'settings'}
                        aria-controls={`v${props.id}-settings-drawer`}
                    >
                        &#9881;
                    </button>
                </div>
            )}
            {show_toolbar && (
                <ToolbarDrawer
                    open={active_drawer === 'settings'}
                    id={`v${props.id}-settings-drawer`}
                    testId="settings-drawer-grid"
                    ariaLabel={l10n.t('Settings')}
                >
                    {props.type === 'document' && (
                        <SettingsDocumentDrawer
                            settings={{
                                show_linetags_in_headlines: display_options.settings?.show_linetags_in_headlines,
                                scroll_note_into_view: display_options.settings?.scroll_note_into_view,
                                auto_expand_focused_note: display_options.settings?.auto_expand_focused_note,
                            }}
                            showLineNumbers={display_options.settings?.show_line_numbers}
                            watchUnopenedFilesInViewer={display_options.settings?.watch_unopened_files_in_viewer}
                            onSettingChange={handleSettingChange}
                            onGlobalSettingChange={handleGlobalSettingChange}
                        />
                    )}
                    {props.type === 'kanban' && (
                        <SettingsKanbanDrawer
                            settings={{
                                show_linetags_in_headlines: display_options.settings?.show_linetags_in_headlines,
                                scroll_note_into_view: display_options.settings?.scroll_note_into_view,
                                auto_expand_focused_note: display_options.settings?.auto_expand_focused_note,
                                column_order: display_options.settings?.column_order,
                            }}
                            naturalColumnOrder={natural_column_order}
                            showLineNumbers={display_options.settings?.show_line_numbers}
                            watchUnopenedFilesInViewer={display_options.settings?.watch_unopened_files_in_viewer}
                            onSettingChange={handleSettingChange}
                            onGlobalSettingChange={handleGlobalSettingChange}
                            onColumnOrderChange={handleColumnOrderChange}
                        />
                    )}
                </ToolbarDrawer>
            )}
            {show_toolbar && integration_mode === 'folder' && (
                <ToolbarDrawer
                    open={active_drawer === 'files'}
                    id={`v${props.id}-files-drawer`}
                    testId="files-drawer-grid"
                    ariaLabel={l10n.t('Files')}
                >
                    <FilesDrawer
                        include={props.aggregate_include ?? ''}
                        exclude={props.aggregate_exclude ?? ''}
                        maxNotesPerFile={props.display_options?.aggregate_max_notes_per_file ?? 10}
                        fileCount={props.file_count ?? 0}
                        noteCount={props.note_count ?? 0}
                        files={props.aggregate_files ?? []}
                        onApplyFilters={handleApplyFilters}
                    />
                </ToolbarDrawer>
            )}
            {props.type === 'auto' && <AutoView {...enriched_props} />}
            {props.type === 'document' && <DocumentView {...enriched_props} />}
            {props.type === 'kanban' && <KanbanView {...enriched_props} />}
            <InsertModal
                opened={insert_modal_open}
                onClose={() => setInsertModalOpen(false)}
                onInsert={handleInsert}
            />
        </>
    );
}

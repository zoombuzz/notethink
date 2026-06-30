import Debug from "debug";
import { useCallback } from "react";
import type { MouseEvent } from "react";
import { usePendingWorkContext } from "../../../hooks/PendingWorkContext";
import { calculateTextChangesForCheckbox, focusedChainIdsFor, resolveCaretPosition } from "../../../lib/noteops";
import { isAlreadyFocusedClick } from "../../../lib/noteui";
import { FOLDER_VIEW_STATE_ID, reconcileAutoIntegrationMode, writeViewInteractionState } from "../../../lib/viewstateops";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from "../../../types/IntegrationMode";
import type { ClickPositionInfo, NoteProps } from "../../../types/NoteProps";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useViewHandlers");

export interface ViewHandlers {
    handlers: ViewApi;
    handle_folder_click: (folder_path: string) => void;
    handle_apply_filters: (next_include: string, next_exclude: string, next_max_notes_per_file: number) => void;
    handle_jump_request: (leaf_path: string) => void;
    handle_file_jump: (file_path: string) => void;
}

/**
 * Builds the view-level ViewApi: default stubs overridden by props.handlers, the
 * note click dispatcher (single/double click, checkbox toggle, focus/select/reveal),
 * the clear-focus and caret handlers, plus the folder-click and apply-filters
 * dispatchers used by the breadcrumb and files drawer. The click handler reads the
 * live selection from selection_ref to avoid stale closures.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useViewHandlers(
    props: ViewProps,
    selection_ref: React.MutableRefObject<ViewProps['selection']>,
): ViewHandlers {
    const { markPending } = usePendingWorkContext();
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

        setViewInteractionState: (focused_ids: string[], selected_ids: string[]) => {
            writeViewInteractionState(props, handlers, focused_ids, selected_ids);
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
                            // single-file falls back to the view doc so the extension does not reject a falsy docPath
                            docPath: note.origin?.doc_path ?? props.doc_path,
                        });
                    }
                } catch (err) {
                    debug('checkbox click handler failed: %O', err);
                }
            } else {
                // click note to reveal in editor; read selection from ref to avoid stale closure when memo prevents re-render
                const caret_pos = resolveCaretPosition(click_profile, note);
                const current_head = selection_ref.current?.main.head;
                const origin_doc_path = note.origin?.doc_path;
                const focused_chain = focusedChainIdsFor(note);
                const note_selected_ids = note.stable_id ? [note.stable_id] : [];
                const is_already_focused = isAlreadyFocusedClick(note, caret_pos, current_head);
                if (event.detail === 2) {
                    // double-click selects the note immediately; per-view state-of-truth, plus the editor reveal so the cursor follows opportunistically
                    writeViewInteractionState(props, handlers, focused_chain, note_selected_ids);
                    props.handlers?.postMessage?.({
                        type: 'selectRange',
                        from: click_profile.selection_from ?? click_profile.from,
                        to: click_profile.selection_to ?? click_profile.to,
                        docPath: origin_doc_path,
                    });
                } else if (note.selected) {
                    // click on an already-selected note returns it to focused (drop selection)
                    writeViewInteractionState(props, handlers, focused_chain, []);
                    props.handlers?.postMessage?.({
                        type: 'revealRange',
                        from: caret_pos,
                        docPath: origin_doc_path,
                    });
                } else if (is_already_focused) {
                    // click on a focused note promotes it to selected
                    writeViewInteractionState(props, handlers, focused_chain, note_selected_ids);
                    props.handlers?.postMessage?.({
                        type: 'selectRange',
                        from: click_profile.selection_from ?? click_profile.from,
                        to: click_profile.selection_to ?? click_profile.to,
                        docPath: origin_doc_path,
                    });
                } else {
                    // first click on a different note focuses it (replaces focused set, drops selection)
                    writeViewInteractionState(props, handlers, focused_chain, []);
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
                // clear view-driven seqs FIRST so the view-driven-wins policy in useViewContext doesn't override the editor-derived state on the next render
                writeViewInteractionState(props, handlers, [], []);
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

        // jump the editor to a note's source: folder mode uses the origin source offset + doc_path; single-file mode falls back to the in-tree position and the view's own doc_path (the extension no-ops a revealRange with no docPath, so single-file collisions must supply it)
        revealNote: (note: NoteProps) => {
            props.handlers?.postMessage?.({
                type: 'revealRange',
                from: note.origin?.source_position?.start.offset ?? note.position?.start?.offset ?? 0,
                docPath: note.origin?.doc_path ?? props.doc_path,
            });
        },

        postMessage: props.handlers?.postMessage,

    }, props.handlers);

    /*
     * handle breadcrumb folder click - switch to (or narrow within) folder integration mode. Dispatch
     * targets FOLDER_VIEW_STATE_ID so the integration_mode tag never lands on a doc-path key in
     * single-file mode. Congruence-seeking: the destination is always folder mode, so persist 'auto'
     * when the opened file also declares folder (the view keeps following the file), and the concrete
     * 'folder' pin only when the navigation diverges from a file that declares current_file - both
     * resolve to folder for rendering.
     */
    const handle_folder_click = useCallback((folder_path: string): void => {
        const next_mode = reconcileAutoIntegrationMode(INTEGRATION_MODE_FOLDER, props.file_declared_integration?.mode);
        handlers.setViewManagedState([{
            id: FOLDER_VIEW_STATE_ID,
            display_options: {
                integration_mode: next_mode,
                integration_path: folder_path,
            },
        }]);
        handlers.postMessage?.({
            type: 'setIntegration',
            mode: INTEGRATION_MODE_FOLDER,
            path: folder_path,
        });
    }, [handlers, props.file_declared_integration]);

    // expose the same folder-descent gesture on the ViewApi so the origin pill (which only sees note-level handlers) can descend into its project subfolder via the same pipeline the breadcrumb uses
    handlers.descendToFolder = handle_folder_click;

    /*
     * handle_apply_filters - apply the user's edited include/exclude globs + per-file
     * story cap. Posts a background setIntegration so the extension re-discovers the
     * folder set, and round-trips each cascading setting to VS Code config via
     * updateSetting (config is the single source of truth for the cascade - the extension
     * discovers with it and echoes the effective globs back, which the drawer mirrors).
     * The include/exclude globs are deliberately NOT written to per-view state: a
     * viewState copy can drift from the config the extension actually discovered with,
     * shadowing it in the drawer and defeating the cascade Reset buttons (which only
     * clear config). maxNotesPerFile stays in view state because it's a webview-side
     * merge cap the drawer reads back from display_options, not a discovery filter.
     * Marks the 'integrationFilters' sentinel so the spinner appears if the re-discovery
     * is slow; the aggregate-payload echo reducer clears it, and the extension emits its
     * own pendingChange for the folder-discovery sub-step.
     */
    const handle_apply_filters = useCallback((next_include: string, next_exclude: string, next_max_notes_per_file: number): void => {
        markPending('integrationFilters');
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                maxNotesPerFile: next_max_notes_per_file,
            },
        }]);
        const integration_path = props.display_options?.integration_path;
        if (integration_path) {
            handlers.postMessage?.({
                type: 'setIntegration',
                mode: INTEGRATION_MODE_FOLDER,
                path: integration_path,
                include: next_include,
                exclude: next_exclude,
            });
        }
        // cascade round-trip: filters drawer is only reachable in folder mode, so we always write
        if (props.display_options?.integration_mode === INTEGRATION_MODE_FOLDER) {
            handlers.postMessage?.({ type: 'updateSetting', setting: 'includeFilter', value: next_include });
            handlers.postMessage?.({ type: 'updateSetting', setting: 'excludeFilter', value: next_exclude });
            handlers.postMessage?.({ type: 'updateSetting', setting: 'maxNotesPerFile', value: next_max_notes_per_file });
        }
    }, [handlers, props.id, props.display_options?.integration_path, props.display_options?.integration_mode, markPending]);

    // request the list of jump targets reachable from the terminal breadcrumb leaf; mode is folder when aggregating a folder, else current-file (sibling .md files)
    const handle_jump_request = useCallback((leaf_path: string): void => {
        const mode = props.display_options?.integration_mode === INTEGRATION_MODE_FOLDER
            ? INTEGRATION_MODE_FOLDER
            : INTEGRATION_MODE_CURRENT_FILE;
        handlers.postMessage?.({ type: 'requestJumpTargets', mode, path: leaf_path });
    }, [handlers, props.display_options?.integration_mode]);

    // open a chosen file jump target in the editor
    const handle_file_jump = useCallback((file_path: string): void => {
        handlers.postMessage?.({ type: 'openFile', path: file_path });
    }, [handlers]);

    return { handlers, handle_folder_click, handle_apply_filters, handle_jump_request, handle_file_jump };
}

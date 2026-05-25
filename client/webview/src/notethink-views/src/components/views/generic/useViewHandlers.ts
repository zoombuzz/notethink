import Debug from "debug";
import { useCallback } from "react";
import type { MouseEvent } from "react";
import { calculateTextChangesForCheckbox, resolveCaretPosition } from "../../../lib/noteops";
import { FOLDER_VIEW_STATE_ID } from "../../../lib/mergeAggregateRoot";
import type { ClickPositionInfo, NoteProps } from "../../../types/NoteProps";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useViewHandlers");

export interface ViewHandlers {
    handlers: ViewApi;
    handle_folder_click: (folder_path: string) => void;
    handle_apply_filters: (next_include: string, next_exclude: string, next_max_notes_per_file: number) => void;
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
                            // folder mode: route to the origin file; undefined in single-file mode
                            docPath: note.origin?.doc_path,
                        });
                    }
                } catch (err) {
                    debug('checkbox click handler failed: %O', err);
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
    // dispatch targets FOLDER_VIEW_STATE_ID so the integration_mode tag never lands on a doc-path key in single-file mode
    const handle_folder_click = useCallback((folder_path: string): void => {
        handlers.setViewManagedState([{
            id: FOLDER_VIEW_STATE_ID,
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
    }, [handlers]);

    // persist edited globs + per-file story cap to per-view state (survives reload) and post a background setIntegration so the extension re-discovers the folder set with the new filters
    // also round-trip each cascading setting to VS Code config via updateFolderViewSetting so it survives across windows when promoted to default
    const handle_apply_filters = useCallback((next_include: string, next_exclude: string, next_max_notes_per_file: number): void => {
        handlers.setViewManagedState([{
            id: props.id,
            display_options: {
                include_filter: next_include,
                exclude_filter: next_exclude,
                max_notes_per_file: next_max_notes_per_file,
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
        // cascade round-trip: filters drawer is only reachable in folder mode, so we always write
        if (props.display_options?.integration_mode === 'folder') {
            handlers.postMessage?.({ type: 'updateFolderViewSetting', setting: 'include_filter', value: next_include });
            handlers.postMessage?.({ type: 'updateFolderViewSetting', setting: 'exclude_filter', value: next_exclude });
            handlers.postMessage?.({ type: 'updateFolderViewSetting', setting: 'max_notes_per_file', value: next_max_notes_per_file });
        }
    }, [handlers, props.id, props.display_options?.integration_path, props.display_options?.integration_mode]);

    return { handlers, handle_folder_click, handle_apply_filters };
}

import Debug from "debug";
import { useCallback, useEffect } from "react";
import type { MouseEvent, MutableRefObject } from "react";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { ViewApi } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useViewNavigation");

export interface ViewNavigationInput {
    display_options: NoteDisplayOptions;
    notes_within_parent_context: Array<NoteProps>;
    parent_context: NoteProps | undefined;
    parent_context_seq: number;
    handlers: ViewApi;
    navigation_command_ref: MutableRefObject<((direction: string) => void) | undefined> | undefined;
}

/**
 * Registers the keyboard-navigation handler on the parent-provided ref so
 * ExtensionReceiver can invoke it. Handles clearFocus / up / down / drillIn /
 * drillOut by posting reveal messages or adjusting the parent context seq.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useViewNavigation(input: ViewNavigationInput): void {
    const {
        display_options,
        notes_within_parent_context,
        parent_context,
        parent_context_seq,
        handlers,
        navigation_command_ref,
    } = input;

    const handleNavigation = useCallback((direction: string): void => {
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
                    // postMessage directly so we can attach the origin doc path in folder mode
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
        if (navigation_command_ref) {
            navigation_command_ref.current = handleNavigation;
        }
        return () => {
            if (navigation_command_ref) {
                navigation_command_ref.current = undefined;
            }
        };
    }, [handleNavigation, navigation_command_ref]);
}

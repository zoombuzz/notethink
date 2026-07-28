import Debug from "debug";
import { useCallback, useEffect } from "react";
import type { MouseEvent, MutableRefObject } from "react";
import { focusedChainIdsFor, navigateToNeighbour } from "../../../lib/noteops";
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
            case 'up':
            case 'down': {
                const step: -1 | 1 = direction === 'up' ? -1 : 1;
                const target_note = navigateToNeighbour(notes_within_parent_context, focused_seqs, step);
                if (target_note) {
                    // write view-driven stable_ids so view focus moves under view-driven-wins policy; move the virtual caret to the target's start so keyboard focus works with no editor; postMessage drives the editor in parallel and attaches origin doc path for folder mode
                    const target_chain = focusedChainIdsFor(target_note);
                    handlers.setViewInteractionState?.(target_chain, [], target_note.position.start.offset);
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
                if (!deepest_note.child_notes?.length) {break;}
                if (!deepest_note.stable_id) {
                    debug('drillIn: note seq=%d has no stable_id to scope to', deepest_note.seq);
                    break;
                }
                handlers.setParentContextId?.(deepest_note.stable_id);
                break;
            }
            case 'drillOut': {
                if (parent_context_seq === 0) {break;}
                // navigate to grandparent, or back to the root when there is no grandparent
                const current_parent = parent_context;
                const grandparent = current_parent?.parent_notes?.length
                    ? current_parent.parent_notes[current_parent.parent_notes.length - 1]
                    : undefined;
                if (grandparent && !grandparent.stable_id) {
                    debug('drillOut: grandparent seq=%d has no stable_id, re-rooting to the document root instead', grandparent.seq);
                }
                handlers.setParentContextId?.(grandparent?.stable_id);
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

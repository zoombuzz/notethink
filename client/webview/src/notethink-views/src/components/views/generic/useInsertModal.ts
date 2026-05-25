import Debug from "debug";
import { useCallback, useState } from "react";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useInsertModal");

export interface InsertModalState {
    insert_modal_open: boolean;
    open_insert_modal: () => void;
    close_insert_modal: () => void;
    handle_insert: (text: string, insert_point: string) => void;
}

/**
 * Owns the insert-modal open state and resolves the insertion offset from the
 * chosen insert point (start/end of line, end of note, current caret) before
 * dispatching the editText message.
 */
export function useInsertModal(props: ViewProps, handlers: ViewApi): InsertModalState {
    const [insert_modal_open, setInsertModalOpen] = useState(false);

    const open_insert_modal = useCallback((): void => {
        setInsertModalOpen(true);
    }, []);

    const close_insert_modal = useCallback((): void => {
        setInsertModalOpen(false);
    }, []);

    const handle_insert = useCallback((text: string, insert_point: string): void => {
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

    return { insert_modal_open, open_insert_modal, close_insert_modal, handle_insert };
}

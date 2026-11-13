import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent, ReactElement, SyntheticEvent } from "react";
import * as l10n from "@vscode/l10n";
import styles from "./ViewRenderer.module.scss";

interface ConfirmModalProps {
    opened: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * The webview's generic confirm dialog, on a native `<dialog>` opened with `showModal()`: a title, a
 * message, and OK and Cancel. OK calls `onConfirm` once; Cancel, Escape and a click on the backdrop
 * call `onCancel`, and nothing else happens in either case. The caller owns `opened` and closes the
 * dialog by clearing it from either callback. Closing a modal dialog returns focus to the element that
 * opened it, so a caller needs no focus handling of its own. It is a webview dialog, not VS Code's
 * modal message, so the Playwright harness, which has no extension host, can drive it.
 */
export default function ConfirmModal(props: ConfirmModalProps): ReactElement {
    const { opened, title, message, onConfirm, onCancel } = props;
    const dialog_ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = dialog_ref.current;
        if (!dialog) { return; }
        if (opened && !dialog.open) {
            dialog.showModal();
        } else if (!opened && dialog.open) {
            dialog.close();
        }
    }, [opened]);
    // escape arrives as the dialog's own cancel event; the caller's state, not the browser, closes it
    const handleDialogCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        onCancel();
    }, [onCancel]);
    // a click that lands on the dialog element itself and outside its box is a click on the backdrop
    const handleBackdropClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
        if (event.target !== event.currentTarget) { return; }
        const box = event.currentTarget.getBoundingClientRect();
        const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        if (!inside) { onCancel(); }
    }, [onCancel]);
    return (
        <dialog ref={dialog_ref} className={styles.modal} aria-label={title} onCancel={handleDialogCancel} onClick={handleBackdropClick} data-testid="confirm-modal">
            <h3>{title}</h3>
            <p>{message}</p>
            <div className={styles.buttongroup}>
                <button type="button" onClick={onConfirm} data-testid="confirm-modal-ok">{l10n.t('OK')}</button>
                <button type="button" onClick={onCancel} style={{ marginLeft: '0.5em' }} data-testid="confirm-modal-cancel">{l10n.t('Cancel')}</button>
            </div>
        </dialog>
    );
}

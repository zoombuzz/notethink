import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../ViewRenderer.module.scss";

declare const NOTETHINK_VERSION: string | undefined;

export interface DocumentSettings {
    show_linetags_in_headlines?: boolean;
    scroll_note_into_view?: boolean;
    auto_expand_focused_note?: boolean;
}

interface SettingsDocumentModalProps {
    opened: boolean;
    onClose: () => void;
    settings: DocumentSettings;
    onSave: (settings: DocumentSettings) => void;
}

export default function SettingsDocumentModal(props: SettingsDocumentModalProps) {
    const dialog_ref = useRef<HTMLDialogElement>(null);

    // local state initialised from props each time modal opens
    const [show_linetags, setShowLinetags] = useState<boolean>(false);
    const [scroll_into_view, setScrollIntoView] = useState<boolean>(false);
    const [auto_expand, setAutoExpand] = useState<boolean>(false);

    // sync local state when modal opens
    useEffect(() => {
        if (props.opened) {
            setShowLinetags(props.settings.show_linetags_in_headlines ?? false);
            setScrollIntoView(props.settings.scroll_note_into_view ?? false);
            setAutoExpand(props.settings.auto_expand_focused_note ?? false);
        }
    }, [props.opened, props.settings]);

    // open/close the native dialog element
    useEffect(() => {
        const dialog = dialog_ref.current;
        if (!dialog) { return; }
        if (props.opened && !dialog.open) {
            dialog.showModal();
        } else if (!props.opened && dialog.open) {
            dialog.close();
        }
    }, [props.opened]);

    const handleSave = useCallback(() => {
        props.onSave({
            show_linetags_in_headlines: show_linetags,
            scroll_note_into_view: scroll_into_view,
            auto_expand_focused_note: auto_expand,
        });
    }, [show_linetags, scroll_into_view, auto_expand, props.onSave]);

    const handleCancel = useCallback(() => {
        props.onClose();
    }, [props.onClose]);

    // handle native dialog cancel (Escape key)
    const handleDialogCancel = useCallback((event: React.SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        props.onClose();
    }, [props.onClose]);

    return (
        <dialog ref={dialog_ref} className={styles.modal} onCancel={handleDialogCancel}>
            <h3>Document Settings</h3>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={show_linetags}
                        onChange={(e) => setShowLinetags(e.target.checked)}
                    />
                    {' '}Show linetags in headlines
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={scroll_into_view}
                        onChange={(e) => setScrollIntoView(e.target.checked)}
                    />
                    {' '}Scroll note into view
                </label>
            </p>

            <p>
                <label>
                    <input
                        type="checkbox"
                        checked={auto_expand}
                        onChange={(e) => setAutoExpand(e.target.checked)}
                    />
                    {' '}Auto-expand focused note
                </label>
            </p>

            <div className={styles.buttongroup}>
                <button type="button" onClick={handleSave}>Save</button>
                <button type="button" onClick={handleCancel} style={{ marginLeft: '0.5em' }}>Cancel</button>
            </div>

            <p style={{ marginTop: '1.5em', opacity: 0.5, fontSize: '0.85em' }} data-testid="version-label">
                NoteThink v{typeof NOTETHINK_VERSION !== 'undefined' ? NOTETHINK_VERSION : 'dev'}
                {' '}(ext: {(window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ as string || '?'})
            </p>
        </dialog>
    );
}

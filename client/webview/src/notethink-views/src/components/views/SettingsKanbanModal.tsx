import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../ViewRenderer.module.scss";

interface SettingsKanbanModalProps {
    opened: boolean;
    onClose: () => void;
    columnOrder: string[];
    settings: {
        show_linetags_in_headlines?: boolean;
        scroll_note_into_view?: boolean;
        column_order?: string[];
    };
    onSave: (settings: {
        show_linetags_in_headlines?: boolean;
        scroll_note_into_view?: boolean;
        column_order?: string[];
    }) => void;
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) { return false; }
    return a.every((value, index) => value === b[index]);
}

export default function SettingsKanbanModal(props: SettingsKanbanModalProps) {
    const dialog_ref = useRef<HTMLDialogElement>(null);

    // local state initialised from props each time modal opens
    const [ordered_columns, setOrderedColumns] = useState<string[]>([]);
    const [show_linetags, setShowLinetags] = useState<boolean>(false);
    const [scroll_into_view, setScrollIntoView] = useState<boolean>(false);

    // sync local state when modal opens
    useEffect(() => {
        if (props.opened) {
            const initial_order = props.settings.column_order ?? props.columnOrder;
            setOrderedColumns([...initial_order]);
            setShowLinetags(props.settings.show_linetags_in_headlines ?? false);
            setScrollIntoView(props.settings.scroll_note_into_view ?? false);
        }
    }, [props.opened, props.settings, props.columnOrder]);

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

    const handleMoveUp = useCallback((index: number) => {
        if (index <= 0) { return; }
        setOrderedColumns((prev) => {
            const next = [...prev];
            [next[index - 1], next[index]] = [next[index], next[index - 1]];
            return next;
        });
    }, []);

    const handleMoveDown = useCallback((index: number) => {
        setOrderedColumns((prev) => {
            if (index >= prev.length - 1) { return prev; }
            const next = [...prev];
            [next[index], next[index + 1]] = [next[index + 1], next[index]];
            return next;
        });
    }, []);

    const handleResetOrder = useCallback(() => {
        setOrderedColumns([...props.columnOrder]);
    }, [props.columnOrder]);

    const handleSave = useCallback(() => {
        // if order matches the natural column order, persist undefined
        const custom_order = arraysEqual(ordered_columns, props.columnOrder)
            ? undefined
            : ordered_columns;

        props.onSave({
            show_linetags_in_headlines: show_linetags,
            scroll_note_into_view: scroll_into_view,
            column_order: custom_order,
        });
    }, [ordered_columns, props.columnOrder, show_linetags, scroll_into_view, props.onSave]);

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
            <h3>Kanban Settings</h3>

            <p><strong>Column order</strong></p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {ordered_columns.map((column_name, index) => (
                    <li key={column_name} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.3em' }}>
                        <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveUp(index)}
                            aria-label={`Move ${column_name} up`}
                        >&#9650;</button>
                        <button
                            type="button"
                            disabled={index === ordered_columns.length - 1}
                            onClick={() => handleMoveDown(index)}
                            aria-label={`Move ${column_name} down`}
                            style={{ marginRight: '0.5em' }}
                        >&#9660;</button>
                        <span>{column_name}</span>
                    </li>
                ))}
            </ul>
            <button type="button" onClick={handleResetOrder}>Reset order</button>

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

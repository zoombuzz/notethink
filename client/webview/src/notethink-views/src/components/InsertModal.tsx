import Debug from "debug";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import inserts from "../inserts/en";
import type { Insert } from "../inserts/types";
import styles from "./ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:InsertModal");

type InsertPoint = 'currentCaret' | 'startOfLine' | 'endOfLine' | 'endOfNote';

interface InsertModalProps {
    opened: boolean;
    onClose: () => void;
    onInsert: (text: string, insert_point: InsertPoint) => void;
}

const INSERT_LIST = Object.values(inserts);
const GROUPS = Array.from(new Set(INSERT_LIST.map(i => i.group || 'Elements')));

const POSITION_LABELS: Record<InsertPoint, string> = {
    currentCaret: 'At cursor',
    startOfLine: 'Start of line',
    endOfLine: 'End of line',
    endOfNote: 'End of document',
};

export default function InsertModal(props: InsertModalProps) {
    const dialog_ref = useRef<HTMLDialogElement>(null);
    const search_ref = useRef<HTMLInputElement>(null);

    const [search, setSearch] = useState('');
    const [selected_key, setSelectedKey] = useState<string | null>(null);
    const [scope, setScope] = useState<'simple' | 'withExample'>('simple');
    const [position, setPosition] = useState<InsertPoint>('currentCaret');

    // reset state when modal opens
    useEffect(() => {
        if (props.opened) {
            setSearch('');
            setSelectedKey(null);
            setScope('simple');
            setPosition('currentCaret');
            // focus search after dialog opens
            requestAnimationFrame(() => search_ref.current?.focus());
        }
    }, [props.opened]);

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

    const filtered = useMemo(() => {
        if (!search) { return INSERT_LIST; }
        const q = search.toLowerCase();
        return INSERT_LIST.filter(i => i.title_lowercase!.includes(q) || (i.group || '').toLowerCase().includes(q));
    }, [search]);

    const selected_insert = useMemo((): Insert | null => {
        if (!selected_key) { return null; }
        return inserts[selected_key] || null;
    }, [selected_key]);

    const effective_position = useMemo((): InsertPoint => {
        if (!selected_insert) { return position; }
        if (scope === 'withExample' && selected_insert.example_insert_point) {
            return selected_insert.example_insert_point as InsertPoint;
        }
        if (selected_insert.insert_point) {
            return selected_insert.insert_point as InsertPoint;
        }
        return position;
    }, [selected_insert, scope, position]);

    const handleSelect = useCallback((key: string) => {
        setSelectedKey(key);
        const insert = inserts[key];
        if (insert) {
            // set position to template default
            if (insert.insert_point) {
                setPosition(insert.insert_point as InsertPoint);
            }
            // auto-select scope
            setScope('simple');
        }
    }, []);

    const handleConfirm = useCallback(() => {
        if (!selected_insert) { return; }
        const text = scope === 'withExample' && selected_insert.example_content
            ? selected_insert.example_content
            : selected_insert.content;
        props.onInsert(text, effective_position);
        props.onClose();
    }, [selected_insert, scope, effective_position, props.onInsert, props.onClose]);

    const handleCancel = useCallback(() => {
        props.onClose();
    }, [props.onClose]);

    // handle native dialog cancel (Escape key)
    const handleDialogCancel = useCallback((event: React.SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        props.onClose();
    }, [props.onClose]);

    // keyboard navigation in the list
    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Enter' && selected_insert) {
            event.preventDefault();
            handleConfirm();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const current_index = filtered.findIndex(i => i.value === selected_key);
            let next_index: number;
            if (event.key === 'ArrowDown') {
                next_index = current_index < filtered.length - 1 ? current_index + 1 : 0;
            } else {
                next_index = current_index > 0 ? current_index - 1 : filtered.length - 1;
            }
            const next = filtered[next_index];
            if (next?.value) {
                setSelectedKey(next.value);
            }
        }
    }, [filtered, selected_key, selected_insert, handleConfirm]);

    // group the filtered items
    const grouped = useMemo(() => {
        const map = new Map<string, Insert[]>();
        for (const group of GROUPS) {
            const items = filtered.filter(i => (i.group || 'Elements') === group);
            if (items.length > 0) {
                map.set(group, items);
            }
        }
        return map;
    }, [filtered]);

    return (
        <dialog ref={dialog_ref} className={`${styles.modal} ${styles.insertModal}`} onCancel={handleDialogCancel}>
            <h3>Insert</h3>

            <input
                ref={search_ref}
                type="text"
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                className={styles.insertSearch}
                data-testid="insert-search"
            />

            <div className={styles.insertList} data-testid="insert-list">
                {Array.from(grouped.entries()).map(([group, items]) => (
                    <div key={group}>
                        <div className={styles.insertGroup}>{group}</div>
                        {items.map(item => (
                            <div
                                key={item.value}
                                className={`${styles.insertItem} ${selected_key === item.value ? styles.insertItemSelected : ''}`}
                                onClick={() => handleSelect(item.value!)}
                                onDoubleClick={() => { handleSelect(item.value!); handleConfirm(); }}
                                data-testid={`insert-item-${item.value}`}
                            >
                                {item.title}
                            </div>
                        ))}
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className={styles.insertEmpty}>No templates match your search</div>
                )}
            </div>

            {selected_insert && (
                <div className={styles.insertOptions}>
                    {selected_insert.example_content && (
                        <p>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={scope === 'withExample'}
                                    onChange={(e) => setScope(e.target.checked ? 'withExample' : 'simple')}
                                />
                                {' '}Include example content
                            </label>
                        </p>
                    )}
                    <p>
                        <label>
                            Position:{' '}
                            <select
                                value={effective_position}
                                onChange={(e) => setPosition(e.target.value as InsertPoint)}
                            >
                                {(Object.keys(POSITION_LABELS) as InsertPoint[]).map(key => (
                                    <option key={key} value={key}>{POSITION_LABELS[key]}</option>
                                ))}
                            </select>
                        </label>
                    </p>
                </div>
            )}

            <div className={styles.buttongroup}>
                <button type="button" onClick={handleConfirm} disabled={!selected_insert}>Insert</button>
                <button type="button" onClick={handleCancel} style={{ marginLeft: '0.5em' }}>Cancel</button>
            </div>
        </dialog>
    );
}

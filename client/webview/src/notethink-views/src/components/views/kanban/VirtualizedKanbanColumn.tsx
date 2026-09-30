import Debug from 'debug';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import {
    Droppable,
    type DraggableProvided,
    type DraggableStateSnapshot,
} from '@hello-pangea/dnd';
import { kanbanDraggableId } from "../../../lib/noteops";
import type { ViewProps } from "../../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions, NoteHandlers } from "../../../types/NoteProps";
import KanbanColumn from "./KanbanColumn";
import { renderBoardCard } from "./renderKanbanCard";
import { useCardHeightCache } from "./useCardHeightCache";
import { useLaneScrollOffset } from "./useLaneScrollOffset";
import { registerVirtualLane, unregisterVirtualLane } from "../../../lib/virtualScrollRegistry";
import type { KanbanColumnDescriptor } from "./useKanbanColumns";
import { LANE_OVERSCAN_COUNT, MIN_LANE_LIST_HEIGHT, totalContentHeight, rowOffsets, visibleRowRange, scrollOffsetForIndex } from "./virtualCardSizingOps";
import view_specific_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:VirtualizedKanbanColumn");

export interface VirtualizedKanbanColumnProps {
    view_id: string;
    column: KanbanColumnDescriptor;
    display_options: NoteDisplayOptions;
    view: ViewProps;
    handlers: NoteHandlers;
    dragDisabled?: boolean;
    card_height: number | undefined;
    card_widths: Record<string, number>;
    list_height: number;
}

/** What every row reads via `itemData`; the row component stays module-scope so re-renders don't remount it. */
interface RowData {
    notes: Array<NoteProps>;
    display_options: NoteDisplayOptions;
    view: ViewProps;
    handlers: NoteHandlers;
    dragDisabled: boolean | undefined;
    card_height: number | undefined;
    card_widths: Record<string, number>;
    reportMeasuredHeight: (stable_id: string, height: number, on_changed: () => void) => void;
    onRowResize: (index: number) => void;
}

interface RowRenderProps {
    index: number;
    style: CSSProperties;
    data: RowData;
}

/**
 * One virtualized row, absolutely positioned by `style` (top/height only). Renders an empty spacer
 * for dnd's placeholder slot (no note), otherwise the card, measuring its own height via
 * ResizeObserver and reporting it back through `reportMeasuredHeight`.
 *
 * Kept at module scope, not inlined: an inline arrow function would be a new identity every
 * render, remounting every visible row and defeating both the measurement and GenericNote's memo.
 */
function KanbanVirtualRow({ index, style, data }: RowRenderProps): ReactElement {
    const note = data.notes[index];
    const card_ref = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const el = card_ref.current;
        if (!el || !note || typeof ResizeObserver === 'undefined') { return; }
        const stable_id = kanbanDraggableId(note);
        const observer = new ResizeObserver((entries) => {
            const height = entries[0]?.contentRect.height;
            if (height === undefined) { return; }
            data.reportMeasuredHeight(stable_id, height, () => data.onRowResize(index));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [note, data, index]);
    // this row past the real notes IS dnd's placeholder slot; carries its own marker so tests can find it
    if (!note) { return <div style={style} className={view_specific_styles.virtualRow} data-testid="kanban-virtual-placeholder" />; }
    return (
        <div style={style} className={view_specific_styles.virtualRow}>
            <div ref={card_ref}>
                {renderBoardCard({
                    note,
                    index,
                    display_options: data.display_options,
                    view: data.view,
                    handlers: data.handlers,
                    dragDisabled: data.dragDisabled,
                    card_height: data.card_height,
                    card_widths: data.card_widths,
                })}
            </div>
        </div>
    );
}
const MemoizedKanbanVirtualRow = React.memo(KanbanVirtualRow);

/**
 * One kanban lane, windowed vertically: every card's index is real, but only the mounted window
 * (viewport + `LANE_OVERSCAN_COUNT` rows) is rendered. Uses dnd's virtual-list pattern
 * (`Droppable mode="virtual"` + `renderClone`) since a dragged card's row can scroll out of the
 * window mid-drag.
 *
 * The lane has no scroll container of its own: its content renders at full height so the PAGE
 * scrolls, and `Droppable`'s ref/props land on that same container so dnd's auto-scroll drives it
 * directly. `KanbanColumn` still renders the heading; only the card-list area is replaced here.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export default function VirtualizedKanbanColumn(props: VirtualizedKanbanColumnProps): ReactElement {
    const { view_id, column, display_options, view, handlers, dragDisabled, card_height, card_widths, list_height } = props;
    const notes = column.child_notes ?? [];
    // stable_id (falling back to seq) - the same key the scroll-to-focus registry uses to find a card
    const stable_ids = useMemo(() => notes.map(n => kanbanDraggableId(n)), [notes]);
    const { getRowSize, reportMeasuredHeight } = useCardHeightCache(card_height);
    // height lives in a ref, so this tick forces re-render on a real height landing; reorder needs no separate signal
    const [measurement_tick, setMeasurementTick] = useState(0);
    const onRowResize = useCallback((_index: number) => {
        setMeasurementTick(tick => tick + 1);
    }, []);
    const item_size = useCallback((index: number) => getRowSize(stable_ids, index), [getRowSize, stable_ids]);
    const item_key = useCallback((index: number) => stable_ids[index] ?? `placeholder-${index}`, [stable_ids]);
    const item_data: RowData = useMemo(() => ({
        notes, display_options, view, handlers, dragDisabled, card_height, card_widths, reportMeasuredHeight, onRowResize,
    }), [notes, display_options, view, handlers, dragDisabled, card_height, card_widths, reportMeasuredHeight, onRowResize]);
    // measurement_tick forces recompute on a real height landing; its value itself is unused
    const content_height = useMemo(() => {
        const row_sizes = Array.from({ length: stable_ids.length }, (_, index) => item_size(index));
        return totalContentHeight(row_sizes);
    }, [stable_ids, item_size, measurement_tick]);
    // full content height, floored so an empty lane still offers a droppable area
    const list_root_height = Math.max(content_height, MIN_LANE_LIST_HEIGHT);
    const list_root_ref = useRef<HTMLDivElement | null>(null);
    const { scroll_offset, setScrollOffset } = useLaneScrollOffset(list_root_ref, content_height, list_height);
    // read inside registerVirtualLane's scrollToIndex without re-registering the lane on every scroll tick
    const scroll_offset_ref = useRef(scroll_offset);
    const list_height_ref = useRef(list_height);
    useLayoutEffect(() => {
        scroll_offset_ref.current = scroll_offset;
        list_height_ref.current = list_height;
    });
    // the .notes wrapper below .column - the portal target getContainerForClone needs for the clone's card look
    const notes_ref = useRef<HTMLDivElement | null>(null);
    // scroll-to-focus asks the registry to scroll a card into the mounted window before framing it
    useEffect(() => {
        registerVirtualLane(view_id, column.value, {
            stable_ids,
            scrollToIndex: (index: number) => {
                const row_sizes = Array.from({ length: stable_ids.length }, (_, i) => item_size(i));
                setScrollOffset(scrollOffsetForIndex(row_sizes, index, scroll_offset_ref.current, list_height_ref.current));
            },
        });
        return () => unregisterVirtualLane(view_id, column.value);
    }, [view_id, column.value, stable_ids, item_size, setScrollOffset]);
    debug('rendering virtualized lane %s: %d cards, content height %dpx, scroll offset %dpx', column.value, notes.length, list_root_height, scroll_offset);
    return (
        <Droppable
            droppableId={`${column.seq}`}
            mode="virtual"
            // dnd defaults the clone to document.body, outside column styles; keep it under .notes instead
            getContainerForClone={() => notes_ref.current ?? document.body}
            renderClone={(provided: DraggableProvided, snapshot: DraggableStateSnapshot, rubric) => {
                const dragged_note = notes[rubric.source.index];
                if (!dragged_note) {
                    // dnd can ask for a clone before the source index is settled; render an empty clone rather than crash
                    return <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} />;
                }
                return renderBoardCard({
                    note: dragged_note,
                    index: rubric.source.index,
                    display_options,
                    view,
                    handlers,
                    dragDisabled,
                    card_height,
                    card_widths,
                    clone: { provided, snapshot },
                });
            }}
        >
            {(provided_drop, snapshot_drop) => {
                const item_count = snapshot_drop.isUsingPlaceholder ? notes.length + 1 : notes.length;
                const row_sizes = Array.from({ length: item_count }, (_, index) => item_size(index));
                const row_offsets_px = rowOffsets(row_sizes);
                const visible = visibleRowRange(row_sizes, scroll_offset, list_height, LANE_OVERSCAN_COUNT);
                const visible_indices = Array.from({ length: Math.max(0, visible.end - visible.start + 1) }, (_, i) => visible.start + i);
                // dnd's droppableProps are applied imperatively; this container isn't a component to spread props onto
                const setListRootRef = (node: HTMLDivElement | null): void => {
                    list_root_ref.current = node;
                    provided_drop.innerRef(node);
                    if (!node) { return; }
                    for (const [key, value] of Object.entries(provided_drop.droppableProps)) {
                        node.setAttribute(key, String(value));
                    }
                };
                return (
                    <KanbanColumn
                        seq={column.seq ?? 0}
                        value={column.value}
                        type={column.type}
                        count={notes.length}
                        display_options={column.display_options}
                        notesRef={notes_ref}
                    >
                        <div
                            ref={setListRootRef}
                            className={view_specific_styles.virtualNotes}
                            style={{ height: list_root_height }}
                        >
                            {visible_indices.map((index) => (
                                <MemoizedKanbanVirtualRow
                                    key={item_key(index)}
                                    index={index}
                                    style={{ top: row_offsets_px[index], height: row_sizes[index] }}
                                    data={item_data}
                                />
                            ))}
                        </div>
                    </KanbanColumn>
                );
            }}
        </Droppable>
    );
}

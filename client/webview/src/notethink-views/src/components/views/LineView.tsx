import Debug from 'debug';
import React, { type ReactElement, Profiler, useMemo } from "react";
import { deriveNaturalColumnOrder, groupDisplayForAxis, withinNoteHeadlineOrBodyUpTo } from "../../lib/noteops";
import { axisField, isAxisWritable, type Axis } from "../../lib/axisops";
import { axisForGroupByKey, resolveGroupByAxisKey } from "../../lib/groupbyops";
import { orderGroupValues, resolveGroupOrderMode } from "../../lib/grouporderops";
import { useAgentActivity } from "../../lib/activityhooks";
import { useScrollToCaret, useCaretIndicator } from "../../lib/viewhooks";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../types/NoteProps";
import GenericNote from "../notes/GenericNote";
import { cardRegistryWithViewSettings, noteOrderTimestampFn, resolveCardType } from "../notes/cardregistryops";
import { filterHiddenColumns, useKanbanColumns } from "./kanban/useKanbanColumns";
import { useProjectedNotes } from "./kanban/useProjectedNotes";
import { useLineViewDrag } from "./useLineViewDrag";
import KanbanBoard from "./kanban/KanbanBoard";
import view_specific_styles from "../ViewRenderer.module.scss";

declare const NOTETHINK_DEV: boolean | undefined;
const debug = Debug("nodejs:notethink-views:LineView");

/**
 * LineView, the single-axis card-group view. It groups the notes into groups on one categorical axis
 * (the grouping engine + group layout + orientation), then renders them via KanbanBoard with the drag
 * wiring (owned by useLineViewDrag). Kanban is LineView preset to the status axis; a grouped view
 * supplies its own group-by axis.
 * - axis: the categorical axis to group by. A preset (kanban) supplies it directly (status); otherwise
 *   LineView resolves the group-by key from the selection or the nt_group_by vote and builds the axis from
 *   it. A drop writes this axis's field; drag is disabled when the axis is read-only (the first level folder).
 */
export interface LineViewProps extends ViewProps {
    axis?: Axis;
}

const onProfilerRender = (typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV)
    ? (id: string, phase: string, actualDuration: number) => {
        debug('Profiler %s %s %dms', id, phase, actualDuration.toFixed(1));
    }
    : undefined;

const renderTopLevelNoteWithoutChildren = (note: NoteProps, view: ViewProps, display_options: NoteDisplayOptions): ReactElement => {
    const filtered_children_body = note.children_body.filter((child) => !('seq' in child && child.seq !== undefined));
    return <GenericNote
        {...note}
        display_options={{
            ...buildChildNoteDisplayOptions(display_options, note, view),
            additional_classes: [view_specific_styles.parentContext].concat(note.display_options?.additional_classes || []),
        }}
        child_notes={[]}
        children_body={filtered_children_body}
        focused={(filtered_children_body.length > 0) && withinNoteHeadlineOrBodyUpTo(view.selection?.main.head, note, filtered_children_body[filtered_children_body.length - 1].position.end.offset)}
        selection={view.selection}
        handlers={{
            click: view.handlers?.click,
            setCaretPosition: view.handlers?.setCaretPosition,
            postMessage: view.handlers?.postMessage,
            descendToFolder: view.handlers?.descendToFolder,
            setNoteExpanded: view.handlers?.setNoteExpanded,
        }}
    />;
};

/**
 * The axis (when not preset) resolves via the persisted select, else a focused-note / majority
 * nt_group_by vote, else the first-level-folder default. The dropped layout renders optimistically
 * client-side until the document round-trip lands, so there is no drop -> snap-back -> re-land flash;
 * this is safe because KanbanBoard collapses the drop tween via transitionDuration rather than the
 * old transition:'none' hack that broke dnd's transitionend and left cards stuck. A group whose
 * `groupDisplay` entry carries `shown: false` is dropped before the group-with-stories rule runs, so a
 * hidden group never counts as a populated group and never falls back into view; of what remains, only
 * groups holding stories render, falling back to every remaining group when none do, so a stale group
 * order or an empty board still draws its groups. Hiding every group draws none.
 */
export default function LineView(props: LineViewProps): ReactElement {
    // resolves the group-by key and builds a writable-or-read-only axis when none is preset
    const axis: Axis = useMemo(() => {
        if (props.axis !== undefined) { return props.axis; }
        const key = resolveGroupByAxisKey(props.notes, props.display_options?.focused_notes, props.display_options?.settings?.groupBy);
        return axisForGroupByKey(key, props.notes);
    }, [props.axis, props.notes, props.display_options?.focused_notes, props.display_options?.settings?.groupBy]);
    // a read-only axis (e.g. the first level folder) takes no drops - moving a card would move a file on disk
    const drag_disabled = !isAxisWritable(axis);
    const group_field = axisField(axis);
    // orientation is a LineView setting: columns (kanban default) lay groups side by side, rows stack them
    const orientation: 'columns' | 'rows' = props.display_options?.settings?.orientation ?? 'columns';
    const display_options: NoteDisplayOptions = {
        ...props.display_options,
    };
    // holds the dropped layout client-side until the document round-trip lands
    const { notes_to_render, applyOptimisticMove, is_projecting } = useProjectedNotes(props.notes_within_parent_context);
    // only this axis's own stored entries apply; an entry saved on another axis is never read here
    const group_display = useMemo(
        () => groupDisplayForAxis(display_options.settings?.groupDisplay, group_field),
        [display_options.settings?.groupDisplay, group_field],
    );
    const group_order_mode = resolveGroupOrderMode(display_options.settings?.groupOrder);
    // the agent activity snapshot, read live so a card type reading it (the agent card) ages its groups as agents work
    const activity_snapshot = useAgentActivity();
    // the card type on screen, resolved exactly as GenericNote resolves it, so the order follows the card the reader sees
    const resolved_card_type = resolveCardType(display_options.settings?.cardType, display_options.settings?.viewType, undefined, cardRegistryWithViewSettings(display_options.settings));
    // the note -> timestamp function for that card type; grouporderops stays pure and never sees the snapshot or card type
    const timestamp_of = useMemo(
        () => noteOrderTimestampFn(resolved_card_type, { snapshot: activity_snapshot, fallback_doc_path: props.doc_relative_path }),
        [resolved_card_type, activity_snapshot, props.doc_relative_path],
    );
    // only groups present in the live notes, so a stored entry for a value no note carries draws no group
    const order = useMemo(() => {
        const natural = deriveNaturalColumnOrder(notes_to_render, axis);
        return orderGroupValues(natural, notes_to_render, axis, group_order_mode, group_display, timestamp_of);
    }, [notes_to_render, axis, group_display, group_order_mode, timestamp_of]);
    const hidden_values = useMemo(
        () => new Set(group_display.filter(entry => entry.shown === false).map(entry => entry.value)),
        [group_display],
    );
    const all_columns = useKanbanColumns(notes_to_render, order, axis);
    // hidden groups drop out before the populated-group rule runs, so a hidden group never falls back into view
    const columns = useMemo(() => filterHiddenColumns(all_columns, hidden_values), [all_columns, hidden_values]);
    // only groups with stories render; falls back to every (non-hidden) group when none do
    const populated_columns = columns.filter(col => (col.child_notes?.length ?? 0) > 0);
    const visible_columns = populated_columns.length > 0 ? populated_columns : columns;
    // drag lifecycle: the FLIP gate + passive-transition layer and the drag responders that post the group-key rewrite
    const drag = useLineViewDrag({
        is_projecting,
        columns,
        visible_columns,
        apply_optimistic_move: applyOptimisticMove,
        axis,
        group_field,
        drag_disabled,
        animate_enabled: display_options.settings?.animateTransitions ?? true,
        view: props,
    });
    // scroll focused note (and body item) into view when caret moves
    useScrollToCaret(display_options, props.id, props.selection);
    // virtual caret indicator: pulse-highlight the body item containing the editor caret
    useCaretIndicator(display_options, props.id, props.selection, view_specific_styles.caretTarget);
    const container_styles: Array<string> = [view_specific_styles.viewKanban, view_specific_styles.content];
    // clears focus on a background click, but ignores the post-drop click that would jump the caret to the next story
    const clear_handler = display_options.focused_notes?.length
        ? props.handlers?.getClearHandler?.(display_options.focused_notes)
        : undefined;
    const containerClickHandler = clear_handler
        ? (event: React.MouseEvent<HTMLElement>) => { if (!drag.drag_active.current) { clear_handler(event); } }
        : undefined;
    const content = (
        <div className={container_styles.join(' ')} id={`v${props.id}-inner`}
             ref={drag.content_ref}
             onClick={containerClickHandler}
             data-level={display_options.level} data-parent-content-seq={display_options.parent_context_seq}>
            {props.nested?.document_strip}
            {props.nested?.parent_context && renderTopLevelNoteWithoutChildren(props.nested?.parent_context, props, display_options)}
            <KanbanBoard
                visible_columns={visible_columns}
                display_options={display_options}
                view={props}
                orientation={orientation}
                dragDisabled={drag_disabled}
                onDragStart={drag.handle_drag_start}
                onDragEnd={drag.handle_drag_end}
            />
        </div>
    );
    if (onProfilerRender) {
        return <Profiler id="LineView" onRender={onProfilerRender}>{content}</Profiler>;
    }
    return content;
}

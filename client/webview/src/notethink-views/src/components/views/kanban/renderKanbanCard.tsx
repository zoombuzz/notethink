import React, { type ReactElement } from "react";
import {
    Draggable,
    type DraggableProvided,
    type DraggableProvidedDraggableProps,
    type DraggableStateSnapshot,
} from '@hello-pangea/dnd';
import { buildChildNoteDisplayOptions } from "../../../lib/noteui";
import { kanbanDraggableId } from "../../../lib/noteops";
import type { ViewProps } from "../../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions, NoteHandlers } from "../../../types/NoteProps";
import GenericNote from "../../notes/GenericNote";

/**
 * Collapses dnd's drop tween to ~instant: the optimistic projection already placed the card, so a
 * slide-from-home tween would visibly fight it. A near-zero duration (not `transition: 'none'`)
 * keeps `transitionend` firing, which dnd needs to detect drop completion.
 */
function draggableStyleWithoutDropAnimation(
    style: DraggableProvidedDraggableProps['style'],
    snapshot: DraggableStateSnapshot,
): DraggableProvidedDraggableProps['style'] {
    if (!snapshot.isDropAnimating || !style) { return style; }
    // dnd types this as the literal 'none'; the cast lets us set a real duration so transitionend still fires
    return { ...style, transition: 'transform 0.001s' } as DraggableProvidedDraggableProps['style'];
}

/**
 * Adds the card's solved width as a custom property (not `width`), since the stylesheet sets flex
 * basis from that property, and basis always beats width.
 */
function cardStyle(
    style: DraggableProvidedDraggableProps['style'],
    snapshot: DraggableStateSnapshot,
    card_width: number | undefined,
): DraggableProvidedDraggableProps['style'] {
    const dragged = draggableStyleWithoutDropAnimation(style, snapshot);
    if (card_width === undefined) { return dragged; }
    // dnd's style union names only its own properties, so the custom one goes in untyped
    const merged: Record<string, unknown> = { ...dragged, '--nt-card-width': `${card_width.toFixed(1)}px` };
    return merged as DraggableProvidedDraggableProps['style'];
}

/**
 * Props for one rendered board card.
 * - card_height / card_widths: the board's solved layout
 * - clone: the `provided`/`snapshot` pair @hello-pangea/dnd hands `renderClone`, used instead of a
 *   fresh `<Draggable>` when the dragged card may not be mounted
 */
export interface BoardCardArgs {
    note: NoteProps;
    index: number;
    display_options: NoteDisplayOptions;
    view: ViewProps;
    handlers?: NoteHandlers;
    dragDisabled?: boolean;
    card_height: number | undefined;
    card_widths: Record<string, number>;
    clone?: { provided: DraggableProvided; snapshot: DraggableStateSnapshot };
}

/**
 * Renders one card as a plain function, not a component, so dnd and the FLIP layer see exactly
 * the tree the board would build inline. `handlers` defaults to `view.handlers`; pass a hoisted,
 * stable object instead to keep GenericNote's memo from seeing a fresh one every render.
 */
export function renderBoardCard(args: BoardCardArgs): ReactElement {
    const { note, index, display_options, view, handlers, dragDisabled, card_height, card_widths, clone } = args;
    const draggable_id = kanbanDraggableId(note);
    const note_handlers = handlers ?? {
        click: view.handlers?.click,
        setCaretPosition: view.handlers?.setCaretPosition,
        postMessage: view.handlers?.postMessage,
        descendToFolder: view.handlers?.descendToFolder,
        setNoteExpanded: view.handlers?.setNoteExpanded,
    };
    const renderCard = (provided_drag: DraggableProvided, snapshot_drag: DraggableStateSnapshot): ReactElement => (
        <GenericNote
            {...note}
            display_options={{
                ...buildChildNoteDisplayOptions(display_options, note, view),
                additional_classes: snapshot_drag.isDragging ? ['dragging'] : undefined,
                card_target_height: card_height,
                provided: {
                    draggableProps: {
                        ...provided_drag.draggableProps,
                        style: cardStyle(provided_drag.draggableProps.style, snapshot_drag, card_widths[draggable_id]),
                        'data-column-card-id': draggable_id,
                        ...(note.stable_id !== undefined ? { 'data-flip-id': note.stable_id } : {}),
                    },
                    dragHandleProps: provided_drag.dragHandleProps ? { ...provided_drag.dragHandleProps } : undefined,
                    innerRef: provided_drag.innerRef,
                },
            }}
            handlers={note_handlers}
        />
    );
    // renderClone already supplies provided/snapshot; skip nesting another <Draggable>
    if (clone) { return renderCard(clone.provided, clone.snapshot); }
    return (
        <Draggable key={draggable_id} draggableId={draggable_id} index={index} isDragDisabled={dragDisabled}>
            {(provided_drag, snapshot_drag) => renderCard(provided_drag, snapshot_drag)}
        </Draggable>
    );
}

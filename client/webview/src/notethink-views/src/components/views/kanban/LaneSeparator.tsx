import React, { useRef, useState, type ReactElement, type RefObject } from "react";
import * as l10n from "@vscode/l10n";
import { MIN_LINE_BREADTH, breadthFromPointer, nudgeBreadth } from "./columnwidthops";
import { BOARD_GAP } from "./useColumnWidth";
import { setBreadthDraft } from "./useBreadthDraft";
import view_specific_styles from "../../ViewRenderer.module.scss";

/**
 * props for the gap between two lanes, which is the drag handle for every lane's breadth.
 * - viewId: the view whose in-flight breadth a drag publishes
 * - boardRef: the board the pointer is measured against, which is also what scrolls
 * - orientation: which way the lanes run; the gap resizes along the same axis
 * - lanesBefore: how many lanes sit before this gap, so the boundary can be kept under the pointer
 * - breadth: the breadth the lanes are at now, which a key nudge starts from
 * - onCommit: writes the breadth once, on release or on a key press
 */
interface LaneSeparatorProps {
    viewId: string;
    boardRef: RefObject<HTMLDivElement | null>;
    orientation: 'columns' | 'rows';
    lanesBefore: number;
    breadth: number;
    onCommit: (breadth: number) => void;
}

/**
 * The gap between two lanes as an element, since a CSS `gap` takes no pointer events. Dragging it sets one
 * breadth for every lane together: the number follows the pointer live through the shared draft, and the
 * setting is written once on release. It is a separator in the ARIA sense, focusable and nudged by the arrow
 * keys along its axis, and the drawer's text box is the other non-drag path to the same value.
 */
export default function LaneSeparator(props: LaneSeparatorProps): ReactElement {
    const { viewId, boardRef, orientation, lanesBefore, breadth, onCommit } = props;
    const columns = orientation === 'columns';
    const [dragging, setDragging] = useState(false);
    const last_breadth = useRef<number | undefined>(undefined);
    // the board feeds the draft back in as `breadth` mid-drag, so what a release compares against is the breadth the drag began at
    const start_breadth = useRef<number>(breadth);
    const breadthAt = (event: React.PointerEvent<HTMLDivElement>): number | undefined => {
        const board = boardRef.current;
        if (board === null) { return undefined; }
        const rect = board.getBoundingClientRect();
        const offset = columns ? event.clientX - rect.left + board.scrollLeft : event.clientY - rect.top + board.scrollTop;
        return breadthFromPointer(offset, lanesBefore, BOARD_GAP);
    };
    const finish = (event: React.PointerEvent<HTMLDivElement>, write: boolean): void => {
        if (!dragging) { return; }
        setDragging(false);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) { event.currentTarget.releasePointerCapture(event.pointerId); }
        const final = last_breadth.current;
        last_breadth.current = undefined;
        if (write && final !== undefined && final !== start_breadth.current) { onCommit(final); } else { setBreadthDraft(viewId, undefined); }
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        const grow = columns ? 'ArrowRight' : 'ArrowDown';
        const shrink = columns ? 'ArrowLeft' : 'ArrowUp';
        if (event.key !== grow && event.key !== shrink) { return; }
        event.preventDefault();
        const next = nudgeBreadth(breadth, event.key === grow ? 1 : -1, event.shiftKey);
        if (next !== breadth) { onCommit(next); }
    };
    return (
        <div
            className={`${view_specific_styles.laneSeparator}${dragging ? ` ${view_specific_styles.dragging}` : ''}`}
            role="separator"
            aria-orientation={columns ? 'vertical' : 'horizontal'}
            aria-valuenow={breadth}
            aria-valuemin={MIN_LINE_BREADTH}
            aria-label={columns ? l10n.t('Resize column width') : l10n.t('Resize row height')}
            tabIndex={0}
            data-testid="lane-separator"
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                start_breadth.current = breadth;
                setDragging(true);
            }}
            onPointerMove={(event) => {
                if (!dragging) { return; }
                const next = breadthAt(event);
                if (next === undefined) { return; }
                last_breadth.current = next;
                setBreadthDraft(viewId, next);
            }}
            onPointerUp={(event) => finish(event, true)}
            onPointerCancel={(event) => finish(event, false)}
        />
    );
}

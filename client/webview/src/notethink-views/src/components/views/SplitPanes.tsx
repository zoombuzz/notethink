import React, { useCallback, useRef, useState } from "react";
import * as l10n from "@vscode/l10n";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { SPLIT_RATIO_KEY_STEP, SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, clampSplitRatio } from "../../lib/paneops";
import styles from "./SplitPanes.module.scss";

/**
 * - primary, secondary: the two panes' content; no secondary means no split, and the host adds nothing around the primary
 * - ratio: the committed share of the width the primary takes
 * - onRatioChange: called once when a resize settles (pointer release or a key press), never on every drag frame, so the persisted state is written once per gesture
 */
interface SplitPanesProps {
    primary: ReactNode;
    secondary?: ReactNode;
    ratio: number;
    onRatioChange: (ratio: number) => void;
}

// the share of the host's width a pointer at `client_x` marks, from the host's own bounds
function ratioAtPointer(host: HTMLElement, client_x: number): number {
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) { return clampSplitRatio(undefined); }
    return clampSplitRatio((client_x - rect.left) / rect.width);
}

/**
 * Two panes side by side with a drag handle between them. The primary pane keeps the same position in
 * the tree whether or not the split is open, so opening or closing the second pane never remounts the
 * first. The handle is a focusable separator: arrow keys step the ratio and Home/End jump to its bounds.
 */
export default function SplitPanes(props: SplitPanesProps): ReactElement {
    const { primary, secondary, ratio, onRatioChange } = props;
    const host_ref = useRef<HTMLDivElement>(null);
    // the ratio shown mid-drag; undefined outside a gesture so the committed ratio is what renders
    const [drag_ratio, setDragRatio] = useState<number | undefined>(undefined);
    const split_open = secondary !== undefined && secondary !== null && secondary !== false;
    const shown_ratio = clampSplitRatio(drag_ratio ?? ratio);
    const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (host_ref.current) { setDragRatio(ratioAtPointer(host_ref.current, event.clientX)); }
    }, []);
    const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
        if (drag_ratio === undefined || !host_ref.current) { return; }
        setDragRatio(ratioAtPointer(host_ref.current, event.clientX));
    }, [drag_ratio]);
    const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>): void => {
        if (drag_ratio === undefined || !host_ref.current) { return; }
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const settled = ratioAtPointer(host_ref.current, event.clientX);
        setDragRatio(undefined);
        onRatioChange(settled);
    }, [drag_ratio, onRatioChange]);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
        const steps: Record<string, number | undefined> = {
            ArrowLeft: clampSplitRatio(shown_ratio - SPLIT_RATIO_KEY_STEP),
            ArrowRight: clampSplitRatio(shown_ratio + SPLIT_RATIO_KEY_STEP),
            Home: SPLIT_RATIO_MIN,
            End: SPLIT_RATIO_MAX,
        };
        const next = steps[event.key];
        if (next === undefined) { return; }
        event.preventDefault();
        onRatioChange(next);
    }, [shown_ratio, onRatioChange]);
    return (
        <div ref={host_ref} className={`${styles.splitHost} ${split_open ? styles.splitHostOpen : ''}`} data-testid="split-host" data-split-open={split_open ? 'true' : 'false'}>
            <div
                className={`${styles.pane} ${split_open ? styles.paneOpen : ''}`}
                style={split_open ? { flexBasis: `calc(${shown_ratio * 100}% - 3px)` } : undefined}
                data-testid="split-pane-primary"
            >
                {primary}
            </div>
            {split_open && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={l10n.t('Resize panes')}
                    aria-valuemin={Math.round(SPLIT_RATIO_MIN * 100)}
                    aria-valuemax={Math.round(SPLIT_RATIO_MAX * 100)}
                    aria-valuenow={Math.round(shown_ratio * 100)}
                    tabIndex={0}
                    className={styles.handle}
                    data-testid="split-handle"
                    data-dragging={drag_ratio !== undefined ? 'true' : 'false'}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onKeyDown={onKeyDown}
                />
            )}
            {split_open && (
                <div className={`${styles.pane} ${styles.paneOpen} ${styles.paneSecond}`} data-testid="split-pane-secondary">
                    {secondary}
                </div>
            )}
        </div>
    );
}

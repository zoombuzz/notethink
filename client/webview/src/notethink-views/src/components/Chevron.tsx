import React from "react";
import styles from "./Chevron.module.scss";

/**
 * The one chevron every disclosure in the webview draws, an inline SVG (the webview ships no codicon font)
 * in the text colour like VS Code's own. It is drawn pointing right and turned by CSS, so a weight, opacity
 * or transition change here lands on the agent card, the drawer tree and the toolbar tabs together.
 * - direction: where the chevron points; a tree twisty is right while closed and down while open, and a
 *   toolbar tab is down while closed and up while open
 * - testId: written through as data-testid so a test can find the mark
 */
export type ChevronDirection = "right" | "down" | "up";

export interface ChevronProps {
    direction: ChevronDirection;
    testId?: string;
}

const DIRECTION_CLASS: Record<ChevronDirection, string> = {
    right: styles.chevronRight,
    down: styles.chevronDown,
    up: styles.chevronUp,
};

function Chevron(props: ChevronProps): React.ReactElement {
    return (
        <svg
            className={`${styles.chevron} ${DIRECTION_CLASS[props.direction]}`}
            data-testid={props.testId}
            data-direction={props.direction}
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden={true}
            focusable="false"
        >
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default React.memo(Chevron);

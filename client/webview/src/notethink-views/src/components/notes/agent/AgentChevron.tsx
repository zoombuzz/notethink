import React from "react";
import styles from "../AgentNote.module.scss";

/**
 * The twisty a tree item draws, an inline SVG chevron (the webview ships no codicon font) that points
 * right while closed and turns down while open, drawn in the text colour like VS Code's own.
 * - open: whether the item it belongs to is expanded
 */
export interface AgentChevronProps {
    open: boolean;
}

function AgentChevron(props: AgentChevronProps): React.ReactElement {
    return (
        <svg className={props.open ? `${styles.agentChevron} ${styles.agentChevronOpen}` : styles.agentChevron} viewBox="0 0 16 16" width="16" height="16" aria-hidden={true} focusable="false">
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default React.memo(AgentChevron);

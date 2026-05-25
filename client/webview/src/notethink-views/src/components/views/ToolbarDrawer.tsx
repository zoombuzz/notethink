import Debug from "debug";
import React from "react";
import styles from "../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:ToolbarDrawer");

interface ToolbarDrawerProps {
    open: boolean;
    id: string;
    ariaLabel: string;
    testId?: string;
    children: React.ReactNode;
}

/**
 * Top-anchored, full-width push-down drawer shell shared by the Settings and Files
 * drawers. Purely presentational: the open/close state, the scroll-anchor RAF loop and
 * the Escape handling live in the owning view (GenericView) so a single set of effects
 * can serve whichever drawer is active. The 0fr→1fr grid trick lives in
 * ViewRenderer.module.scss (.settingsDrawerGrid / .settingsDrawer), reused verbatim.
 */
function ToolbarDrawer(props: ToolbarDrawerProps): React.ReactElement {
    return (
        <div
            id={props.id}
            className={styles.settingsDrawerGrid}
            data-open={props.open}
            data-testid={props.testId}
            role="region"
            aria-label={props.ariaLabel}
            aria-hidden={!props.open}
        >
            <div className={styles.settingsDrawer}>
                {props.children}
            </div>
        </div>
    );
}

export default React.memo(ToolbarDrawer);

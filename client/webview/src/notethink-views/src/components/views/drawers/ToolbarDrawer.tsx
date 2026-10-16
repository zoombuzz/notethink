import React from "react";
import * as l10n from "@vscode/l10n";
import styles from "../../ViewRenderer.module.scss";

interface ToolbarDrawerProps {
    open: boolean;
    id: string;
    ariaLabel: string;
    testId?: string;
    onClose?: () => void;
    children: React.ReactNode;
}

/**
 * Top-anchored, full-width push-down drawer shell shared by the settings, files,
 * collisions, and jump drawers. Purely presentational: the open/close state, the
 * scroll-anchor RAF loop and the Escape handling live in the owning view (GenericView) so a
 * single set of effects can serve whichever drawer is active. The 0fr→1fr grid trick lives
 * in ViewRenderer.module.scss (.drawerGrid / .drawer / .drawerContent), reused verbatim; the
 * bare .drawerContent wrapper around children is what the trick resizes, since the drawer's
 * own content carries padding and border that a min-height override on it alone cannot shrink
 * away. aria-hidden keeps a closed drawer out of the accessibility tree, but a closed drawer
 * stays reachable by a direct .focus() call or a screen reader's virtual cursor regardless,
 * since it is only visually clipped rather than removed - inert additionally blocks that,
 * without touching the slide animation since it carries no visual effect of its own. When
 * onClose is supplied an X button is rendered in the drawer's top-right corner, beside the title.
 */
function ToolbarDrawer(props: ToolbarDrawerProps): React.ReactElement {
    return (
        <div
            id={props.id}
            className={styles.drawerGrid}
            data-open={props.open}
            data-testid={props.testId}
            role="region"
            aria-label={props.ariaLabel}
            aria-hidden={!props.open}
            inert={!props.open}
        >
            <div className={styles.drawer}>
                {props.onClose && (
                    <button
                        type="button"
                        className={styles.drawerClose}
                        data-testid="drawer-close"
                        aria-label={l10n.t('Close')}
                        title={l10n.t('Close')}
                        onClick={(e) => { e.stopPropagation(); props.onClose?.(); }}
                    >
                        &#215;
                    </button>
                )}
                <div className={styles.drawerContent}>
                    {props.children}
                </div>
            </div>
        </div>
    );
}

export default React.memo(ToolbarDrawer);

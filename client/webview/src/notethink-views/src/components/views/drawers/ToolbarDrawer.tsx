import Debug from "debug";
import React from "react";
import * as l10n from "@vscode/l10n";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:ToolbarDrawer");

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
 * in ViewRenderer.module.scss (.drawerGrid / .drawer), reused verbatim. When onClose is
 * supplied an X button is rendered in the drawer's top-right corner, beside the title.
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
                {props.children}
            </div>
        </div>
    );
}

export default React.memo(ToolbarDrawer);

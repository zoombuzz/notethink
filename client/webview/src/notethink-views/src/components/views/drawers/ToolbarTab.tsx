import Debug from "debug";
import React from "react";
import type { ReactNode } from "react";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:ToolbarTab");

/**
 * label: the tab's own current state, spelled out - a breadcrumb leaf, a file count, a view type. it
 *   gets its own `<testId>-label` element, so a test can read the state exactly without the chevron.
 * icon: optional node rendered after the label, for a tab whose state needs a glyph as well as words.
 * ariaLabel: overrides the accessible name when the visible label alone reads as cryptic out of context.
 * dataPath: the filesystem path a breadcrumb tab stands for, kept as data-path so path queries still find it.
 * hasPopup: marks the tab as opening a list of navigation targets rather than a settings panel.
 */
interface ToolbarTabProps {
    label: string;
    controls: string;
    open: boolean;
    testId: string;
    icon?: ReactNode;
    title?: string;
    ariaLabel?: string;
    dataPath?: string;
    hasPopup?: boolean;
    buttonRef?: React.RefObject<HTMLButtonElement | null>;
    onToggle: (anchor: HTMLElement) => void;
}

/**
 * The trigger half of a ToolbarDrawer: a named tab carrying an open/closed chevron. Each tab is
 * titled with its own current state and sits where that state already lives - in the breadcrumb for
 * the leaf, the count and the warnings alert, on the right for the view type. The chevron is the
 * same `›` glyph the jump tree uses, rotated down when the drawer is closed and up when it is open,
 * so the two indicators read alike and the repo needs no icon font. An open tab takes the drawer
 * body's background and drops its baseline, so it merges into the panel pushed down beneath it.
 * onToggle receives the tab element itself, which the drawer hook scroll-anchors to and refocuses on
 * Escape.
 */
function ToolbarTab(props: ToolbarTabProps): React.ReactElement {
    const chevron_class = props.open ? styles.toolbarTabChevronOpen : styles.toolbarTabChevronClosed;
    debug("tab=%s open=%s", props.testId, props.open);
    return (
        <button
            ref={props.buttonRef}
            type="button"
            className={props.open ? `${styles.toolbarTab} ${styles.toolbarTabActive}` : styles.toolbarTab}
            data-testid={props.testId}
            data-open={props.open}
            data-path={props.dataPath}
            aria-expanded={props.open}
            aria-controls={props.controls}
            aria-haspopup={props.hasPopup ? 'menu' : undefined}
            aria-label={props.ariaLabel}
            title={props.title ?? props.label}
            onClick={(e) => { e.stopPropagation(); props.onToggle(e.currentTarget); }}
        >
            <span className={styles.toolbarTabLabel} data-testid={`${props.testId}-label`}>{props.label}</span>
            {props.icon}
            <span
                className={`${styles.toolbarTabChevron} ${chevron_class}`}
                data-testid={`${props.testId}-chevron`}
                data-direction={props.open ? 'up' : 'down'}
                aria-hidden="true"
            >
                {'›'}
            </span>
        </button>
    );
}

export default React.memo(ToolbarTab);

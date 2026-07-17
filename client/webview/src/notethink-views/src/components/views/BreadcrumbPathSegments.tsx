import Debug from "debug";
import type { MouseEvent, ReactElement } from "react";
import { Fragment } from "react";
import * as l10n from "@vscode/l10n";
import type { PathSegment } from "../../lib/pathops";
import type { ActiveDrawer } from "./generic/useToolbarDrawers";
import ToolbarTab from "./drawers/ToolbarTab";
import styles from "./BreadcrumbTrail.module.scss";

const debug = Debug("nodejs:notethink-views:BreadcrumbPathSegments");

interface BreadcrumbPathSegmentsProps {
    segments: PathSegment[];
    viewId: string | undefined;
    activeDrawer: ActiveDrawer | undefined;
    onFolderClick?: (folder_path: string) => void;
    onLeafClick?: (leaf_path: string, anchor: HTMLElement) => void;
}

/**
 * The filesystem half of the breadcrumb: one clickable segment per folder above the leaf, then the
 * terminal leaf itself rendered as the Jump to tab. The leaf is a tab rather than a plain segment
 * because it is the one segment that opens a drawer instead of re-narrowing the aggregation, and it
 * is rendered here - not gathered into a tab group elsewhere - so the trail reads
 * `oma > docstech > [todo.md v]` and the leaf appears exactly once.
 */
export default function BreadcrumbPathSegments(props: BreadcrumbPathSegmentsProps): ReactElement {
    debug("segments=%d active=%s", props.segments.length, props.activeDrawer);
    return (
        <>
            {props.segments.map((segment, index) => {
                const is_leaf = index === props.segments.length - 1;
                return <Fragment key={`path-${index}`}>
                    {index > 0 && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
                    {is_leaf ? (
                        <ToolbarTab
                            label={segment.label}
                            testId="breadcrumb-leaf"
                            controls={`v${props.viewId ?? ''}-jump-drawer`}
                            open={props.activeDrawer === 'jump'}
                            ariaLabel={l10n.t('Jump to…')}
                            title={l10n.t('Jump to another folder or file')}
                            dataPath={segment.path}
                            hasPopup
                            onToggle={(anchor) => props.onLeafClick?.(segment.path, anchor)}
                        />
                    ) : (
                        <button className={styles.breadcrumbItem + ' ' + styles.pathSegment}
                              aria-label={segment.label}
                              data-path={segment.path}
                              onClick={(event: MouseEvent<HTMLElement>) => {
                                  event.stopPropagation();
                                  props.onFolderClick?.(segment.path);
                              }}
                        >
                            {segment.label}
                        </button>
                    )}
                </Fragment>;
            })}
        </>
    );
}

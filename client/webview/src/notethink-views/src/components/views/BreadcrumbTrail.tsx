import Debug from "debug";
import type { ReactElement } from "react";
import { useMemo } from "react";
import * as l10n from "@vscode/l10n";
import { breadcrumbSegmentsForView } from "../../lib/pathops";
import { usePendingWorkContext } from "../../hooks/PendingWorkContext";
import type { NoteProps } from "../../types/NoteProps";
import type { DiscoveryProgress } from "../../types/Messages";
import type { ActiveDrawer } from "./generic/useToolbarDrawers";
import BreadcrumbNoteSegments from "./BreadcrumbNoteSegments";
import BreadcrumbPathSegments from "./BreadcrumbPathSegments";
import ToolbarTab from "./drawers/ToolbarTab";
import Spinner from "../Spinner";
import styles from "./BreadcrumbTrail.module.scss";

const debug = Debug("nodejs:notethink-views:BreadcrumbTrail");

/**
 * integration_path: when set, breadcrumb path segments reflect this folder (folder mode)
 * instead of the current file's path; clicking a segment narrows the aggregation to that subfolder.
 * file_count / note_count / aggregate_total_discovered: folder mode only, rendered as "(X in Y files)"
 * after the path (or "(X in Y of M files)" when the discovery cap truncated the set), never in single-file mode.
 * X = note_count (top-level stories), Y = file_count (source files loaded), M = aggregate_total_discovered (files found before the cap).
 * discovery_scanning: folder mode only, true while a discovery run is still enumerating files; the count reads as scanning only while it would otherwise still read "(0 in 0 files)" - once any note or file has streamed in, the real counts take over.
 * discovery_progress: folder mode only, the latest discoveryProgress tick for the run discovery_scanning brackets. Fills in the count ("X in Y of M files") with a live total before the aggregate payload supplies one, or - while nothing has streamed in yet - replaces "(scanning…)" with a walking-phase variant naming how many files the walk has found so far; the folders-searched count rides in the tab's tooltip instead of the label. Undefined before the first tick, so every form falls back to today's label.
 * view_id / active_drawer: the tabs in the trail need both, to name the drawer each controls (`v<view_id>-<kind>-drawer`) and to point its chevron; optional so the trail still renders standalone, outside a view.
 * has_collisions: when true, the trail ends in the Warnings tab; clicking it opens the Collisions drawer.
 * onFileCountClick: clicking the count opens the Files drawer, receiving the count element so the drawer can scroll-anchor to it.
 * onCollisionsClick: clicking the Warnings tab opens the Collisions drawer, receiving the tab element so the drawer can scroll-anchor to it.
 * onLeafClick: clicking the terminal (rightmost) path segment opens the Jump drawer (sibling files / child subfolders) instead of re-narrowing the aggregation; receives the leaf path and the clicked element so the drawer can scroll-anchor to it.
 */
export interface BreadcrumbTrailProps extends NoteProps {
    doc_path?: string;
    doc_relative_path?: string;
    workspace_root?: string;
    integration_path?: string;
    view_id?: string;
    active_drawer?: ActiveDrawer;
    file_count?: number;
    note_count?: number;
    aggregate_total_discovered?: number;
    discovery_scanning?: boolean;
    discovery_progress?: DiscoveryProgress;
    has_collisions?: boolean;
    onFolderClick?: (folder_path: string) => void;
    onFileCountClick?: (anchor: HTMLElement) => void;
    onCollisionsClick?: (anchor: HTMLElement) => void;
    onLeafClick?: (leaf_path: string, anchor: HTMLElement) => void;
}

/**
 * The view's breadcrumb: the path to what is on screen, followed by the note chain within it. Three
 * of the toolbar's drawers open from tabs rendered inline here rather than from a tab group of their
 * own, because each is titled with a piece of state the trail already carries - the terminal leaf,
 * the file count, and the collisions alert - and a tab elsewhere would render that state twice.
 */
export default function BreadcrumbTrail(props: BreadcrumbTrailProps): ReactElement {
    const parent_notes = props.parent_notes || [];
    // the same segmenter the Jump drawer's leaf resolution uses, so the trail and the drawer's leaf can't drift
    const path_segments = useMemo(
        () => breadcrumbSegmentsForView(props.integration_path, props.doc_path, props.workspace_root, props.doc_relative_path),
        [props.doc_path, props.workspace_root, props.doc_relative_path, props.integration_path],
    );
    // true only where the count would otherwise read "(0 in 0 files)"; a streamed-in note or file switches to the real counts
    const showing_scanning_label = !!props.discovery_scanning && (props.file_count ?? 0) === 0 && (props.note_count ?? 0) === 0;
    // folder mode only: the scanning or counted label, folded with a live discoveryProgress tick when one has landed
    const file_count_label = useMemo(() => {
        if (!props.integration_path || typeof props.file_count !== 'number') { return undefined; }
        const progress = props.discovery_progress;
        if (showing_scanning_label) {
            return progress?.phase === 'walking'
                ? l10n.t('({0} files found…)', String(progress.files_found ?? 0))
                : l10n.t('(scanning…)');
        }
        const loaded = props.file_count;
        const notes = props.note_count ?? 0;
        const aggregate_total = props.aggregate_total_discovered;
        const progress_total = progress?.phase === 'loading' ? progress.files_total : undefined;
        const total = (typeof aggregate_total === 'number' && aggregate_total > loaded) ? aggregate_total
            : (typeof progress_total === 'number' && progress_total > loaded) ? progress_total
                : undefined;
        return total !== undefined
            ? l10n.t('({0} in {1} of {2} files)', String(notes), String(loaded), String(total))
            : l10n.t('({0} in {1} files)', String(notes), String(loaded));
    }, [props.integration_path, showing_scanning_label, props.file_count, props.note_count, props.aggregate_total_discovered, props.discovery_progress]);
    // the folders-searched count lives in the tab's tooltip rather than the label, which is already busy with the file count
    const file_count_title = useMemo(() => {
        const dirs_walked = props.discovery_progress?.dirs_walked;
        return typeof dirs_walked === 'number'
            ? l10n.t('Searched {0} folders - File settings', String(dirs_walked))
            : l10n.t('File settings');
    }, [props.discovery_progress]);
    const has_path = path_segments.length > 0;
    const has_notes = parent_notes.length > 0;
    // the spinner lives here, beside the "(X in Y files)" count, next to what's usually slow: file discovery
    const { pending } = usePendingWorkContext();
    debug("segments=%d notes=%d collisions=%s", path_segments.length, parent_notes.length, props.has_collisions);
    return (
        <nav className={styles.breadcrumbTrail} role="navigation" aria-label={l10n.t('Breadcrumb')}>
            <BreadcrumbPathSegments
                segments={path_segments}
                viewId={props.view_id}
                activeDrawer={props.active_drawer}
                onFolderClick={props.onFolderClick}
                onLeafClick={props.onLeafClick}
            />
            {file_count_label && (
                <ToolbarTab
                    label={file_count_label}
                    testId="breadcrumb-file-count"
                    controls={`v${props.view_id ?? ''}-files-drawer`}
                    open={props.active_drawer === 'files'}
                    ariaLabel={showing_scanning_label
                        ? l10n.t('Scanning for files - open the Files panel')
                        : l10n.t('{0} notes in {1} files - open the Files panel', String(props.note_count ?? 0), String(props.file_count ?? 0))}
                    title={file_count_title}
                    onToggle={(anchor) => props.onFileCountClick?.(anchor)}
                />
            )}
            {pending && <Spinner positionClass="InlineLoader" ariaLabel={l10n.t('Working')} />}
            {props.has_collisions && (
                <ToolbarTab
                    label={l10n.t('Warnings')}
                    testId="breadcrumb-collision-alert"
                    controls={`v${props.view_id ?? ''}-collisions-drawer`}
                    open={props.active_drawer === 'collisions'}
                    icon={<span className={styles.collisionAlert} aria-hidden="true">&#9888;</span>}
                    title={l10n.t('Duplicate note IDs detected - open the Collisions panel')}
                    onToggle={(anchor) => props.onCollisionsClick?.(anchor)}
                />
            )}
            {has_path && has_notes && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
            <BreadcrumbNoteSegments notes={parent_notes} onNoteClick={props.handlers?.setParentContextId} />
        </nav>
    );
}

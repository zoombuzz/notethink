import React, { type ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import styles from "../ViewRenderer.module.scss";

interface EmptyStoriesOverlayProps {
    onOpenFilesDrawer: (anchor: HTMLElement) => void;
}

/**
 * Board-level empty state for aggregate (folder) mode: a modal-style note over the board when
 * discovery has settled with zero stories in the merged tree. It sits over the content area rather
 * than replacing it, so the default status columns stay visible underneath and the toolbar and its
 * drawers stay reachable. The one action opens the Files drawer, whose own instructions (shown
 * there at noteCount 0) say what to change.
 */
export default function EmptyStoriesOverlay(props: EmptyStoriesOverlayProps): ReactElement {
    return (
        <div className={styles.emptyStoriesOverlay} data-testid="empty-stories-overlay">
            <div className={styles.emptyStoriesCard} role="status">
                <p className={styles.emptyStoriesTitle}>{l10n.t('No stories found')}</p>
                <p>{l10n.t('NoteThink could not find any markdown files containing story or task definitions.')}</p>
                <button
                    type="button"
                    data-testid="empty-stories-open-files"
                    onClick={(e) => props.onOpenFilesDrawer(e.currentTarget)}
                >
                    {l10n.t('Open File settings')}
                </button>
            </div>
        </div>
    );
}

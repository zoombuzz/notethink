import React, { type ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import LoadingNote from "../LoadingNote";
import styles from "../ViewRenderer.module.scss";

export type FolderStatusMode = 'scanning' | 'no_match' | 'no_stories';

interface EmptyStoriesOverlayProps {
    mode: FolderStatusMode;
    includeFilter?: string;
    onOpenFilesDrawer: (anchor: HTMLElement) => void;
}

function titleFor(mode: 'no_match' | 'no_stories'): string {
    if (mode === 'no_match') { return l10n.t('No files matched'); }
    return l10n.t('No stories found');
}

function messageFor(mode: 'no_match' | 'no_stories', include_filter: string | undefined): string {
    if (mode === 'no_match') { return l10n.t('No markdown files matched the include pattern "{0}".', include_filter ?? ''); }
    return l10n.t('NoteThink could not find any markdown files containing story or task definitions.');
}

/**
 * Board-level status note for aggregate (folder) mode: sits over the board rather than replacing
 * it, so the default status columns stay visible underneath and the toolbar and its drawers stay
 * reachable. Three modes:
 * - scanning: discovery is still enumerating files, before the first aggregate payload lands (or
 *   before any discovery signal has arrived at all, right after the panel opens). This is the one
 *   case with nothing to act on yet, so it draws the shared LoadingNote rather than this overlay's
 *   own card - no title, no button, no progress, same quiet note every other loading moment shows.
 * - no_match: discovery settled and the include pattern matched zero files, named so the user knows what to change
 * - no_stories: discovery settled, files were found, but none held a story or task heading
 * The Files-drawer button opens on the same gesture for no_match and no_stories, since both are fixed
 * by editing a filter there.
 */
export default function EmptyStoriesOverlay(props: EmptyStoriesOverlayProps): ReactElement {
    if (props.mode === 'scanning') { return <LoadingNote fill="board" />; }
    return (
        <div className={styles.emptyStoriesOverlay} data-testid="empty-stories-overlay">
            <div className={styles.emptyStoriesCard} role="status" aria-live="polite" aria-busy="false">
                <p className={styles.emptyStoriesTitle}>{titleFor(props.mode)}</p>
                <p>{messageFor(props.mode, props.includeFilter)}</p>
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

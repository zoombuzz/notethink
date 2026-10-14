import React, { type ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import styles from "./LoadingNote.module.scss";

export type LoadingNoteFill = 'board' | 'viewport';

interface LoadingNoteProps {
    fill?: LoadingNoteFill;
}

/**
 * Small, quiet note shown centred in place of content that has not loaded yet: no spinner, no
 * counts, just short text, so an otherwise blank or empty-looking panel does not read as broken.
 * One component for every "nothing to show yet" moment, so they all look the same:
 * - fill="board" (default): absolute over the nearest positioned ancestor, the view's content
 *   region, while a folder-mode board is waiting on its first visible card (EmptyStoriesOverlay)
 * - fill="viewport": fixed over the whole window, before any view has mounted at all - there is no
 *   toolbar or board yet to be "the board area" (NoteRenderer, before the first doc has arrived)
 * The extension's static webview HTML mirrors this markup and copy by hand (notethinkEditor.ts),
 * since that is what paints before the webview bundle has loaded and run.
 */
export default function LoadingNote({ fill = 'board' }: LoadingNoteProps): ReactElement {
    const container_class = fill === 'viewport' ? styles.loadingNoteViewport : styles.loadingNoteBoard;
    return (
        <div className={container_class} data-testid="loading-note">
            <p className={styles.loadingNoteText} role="status" aria-live="polite" aria-busy="true">
                {l10n.t('NoteThink is loading…')}
            </p>
        </div>
    );
}

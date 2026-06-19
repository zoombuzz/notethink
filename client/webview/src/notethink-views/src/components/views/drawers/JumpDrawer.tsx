import Debug from "debug";
import React from "react";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { useJumpTargetsContext } from "../../../hooks/JumpTargetsContext";
import { INTEGRATION_MODE_FOLDER } from "../../../types/IntegrationMode";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:JumpDrawer");

interface JumpDrawerProps {
    requestedPath: string | undefined;
    onFolderJump: (folder_path: string) => void;
    onFileJump: (file_path: string) => void;
    onReturn?: () => void;
}

/**
 * Jump drawer: a compact folder tree rooted at the breadcrumb folder the user clicked. Lists
 * the navigation targets reachable from that leaf - child subfolders in folder mode (descend the
 * aggregation) or sibling .md files in current-file mode (open in the editor). The root row is
 * clickable and calls onReturn to dismiss the drawer back to the view it was opened from. Renders
 * a loading row until the extension's jumpTargets reply for THIS leaf arrives (matched by
 * jump_targets.path === requestedPath), an empty-state row when the reply carries no entries,
 * otherwise one clickable row per entry dispatched by kind.
 */
function JumpDrawer(props: JumpDrawerProps): ReactElement {
    const { jump_targets } = useJumpTargetsContext();
    // the reply for this leaf hasn't arrived yet (no response, or a stale response for a different leaf)
    const is_loading = !jump_targets || jump_targets.path !== props.requestedPath;
    const is_folder_mode = jump_targets?.mode === INTEGRATION_MODE_FOLDER;
    // root header label = the breadcrumb folder the user clicked, so the tree reads as a subtree of it
    const root_label = props.requestedPath ? (props.requestedPath.split('/').filter(Boolean).pop() ?? props.requestedPath) : '';
    debug("requestedPath=%s loading=%s entries=%d", props.requestedPath, is_loading, jump_targets?.entries.length ?? -1);

    return (
        <div className={styles.drawerBody} data-testid="jump-drawer">
            <div className={styles.drawerGroups}>
                <section className={styles.drawerGroup}>
                    <ul className={styles.jumpTree} role="tree" data-testid="jump-drawer-list">
                        <li role="treeitem" aria-expanded="true">
                            <button
                                type="button"
                                className={`${styles.drawerLink} ${styles.jumpTreeRoot}`}
                                data-testid="jump-drawer-root"
                                aria-label={l10n.t('Return to the current view')}
                                title={l10n.t('Return to the current view')}
                                onClick={() => props.onReturn?.()}
                            >
                                <span className={`${styles.jumpTreeGlyph} ${styles.jumpTreeGlyphOpen}`}>{'›'}</span>
                                <span className={styles.jumpTreeLabel}>{root_label}</span>
                            </button>
                            <ul className={styles.jumpTreeChildren}>
                                {is_loading && (
                                    <li className={styles.drawerEmpty} data-testid="jump-drawer-loading">
                                        {l10n.t('Loading…')}
                                    </li>
                                )}
                                {!is_loading && jump_targets.entries.length === 0 && (
                                    <li className={styles.drawerEmpty} data-testid="jump-drawer-empty">
                                        {is_folder_mode ? l10n.t('No subfolders') : l10n.t('No other files here')}
                                    </li>
                                )}
                                {!is_loading && jump_targets.entries.map(entry => (
                                    <li key={entry.path} role="treeitem">
                                        <button
                                            type="button"
                                            className={`${styles.drawerLink} ${styles.jumpTreeEntry}`}
                                            data-testid="jump-drawer-entry"
                                            data-kind={entry.kind}
                                            title={entry.path}
                                            onClick={() => {
                                                if (entry.kind === 'folder') { props.onFolderJump(entry.path); } else { props.onFileJump(entry.path); }
                                                // every jump-drawer click navigates into a target (descend folder / open file), so dismiss the drawer - unlike the settings/files drawers which stay open while you adjust them
                                                props.onReturn?.();
                                            }}
                                        >
                                            <span className={styles.jumpTreeGlyph}>{entry.kind === 'folder' ? '›' : ''}</span>
                                            <span className={styles.jumpTreeLabel}>{entry.label}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </li>
                    </ul>
                </section>
            </div>

            <aside className={styles.drawerMeta}>
                <h3>{l10n.t('Jump to')}</h3>
            </aside>
        </div>
    );
}

export default React.memo(JumpDrawer);

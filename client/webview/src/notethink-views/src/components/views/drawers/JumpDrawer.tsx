import Debug from "debug";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import * as l10n from "@vscode/l10n";
import { useJumpTargetsContext } from "../../../hooks/JumpTargetsContext";
import { INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode, type IntegrationMode } from "../../../types/IntegrationMode";
import ViewIntegrationSelector from "../ViewIntegrationSelector";
import DrawerTree, { type DrawerTreeNode } from "./DrawerTree";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:JumpDrawer");

interface JumpDrawerProps {
    requestedPath: string | undefined;
    integrationSelection: IntegrationMode;
    integrationMode: ConcreteIntegrationMode;
    onIntegrationChange: (mode: IntegrationMode) => void;
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
 *
 * Also hosts the view-integration selector: choosing whether the board aggregates a folder or
 * follows the current file is the same "where am I looking" decision the tree navigates, so both
 * live behind this one tab rather than the selector holding a permanent slot on the toolbar.
 */
function JumpDrawer(props: JumpDrawerProps): ReactElement {
    const { jump_targets } = useJumpTargetsContext();
    // the reply for this leaf hasn't arrived yet (no response, or a stale response for a different leaf)
    const is_loading = !jump_targets || jump_targets.path !== props.requestedPath;
    const is_folder_mode = jump_targets?.mode === INTEGRATION_MODE_FOLDER;
    // root header label = the breadcrumb folder the user clicked, so the tree reads as a subtree of it
    const root_label = props.requestedPath ? (props.requestedPath.split('/').filter(Boolean).pop() ?? props.requestedPath) : '';
    const entries = is_loading ? [] : jump_targets.entries;
    debug("requestedPath=%s loading=%s entries=%d", props.requestedPath, is_loading, jump_targets?.entries.length ?? -1);

    let placeholder: ReactNode = undefined;
    if (is_loading) {
        placeholder = <li className={styles.drawerEmpty} data-testid="jump-drawer-loading">{l10n.t('Loading…')}</li>;
    } else if (entries.length === 0) {
        placeholder = (
            <li className={styles.drawerEmpty} data-testid="jump-drawer-empty">
                {is_folder_mode ? l10n.t('No subfolders') : l10n.t('No other files here')}
            </li>
        );
    }

    const root_node: DrawerTreeNode = {
        id: 'jump-root',
        label: root_label,
        glyph: '›',
        expanded: true,
        testId: 'jump-drawer-root',
        title: l10n.t('Return to the current view'),
        ariaLabel: l10n.t('Return to the current view'),
        placeholder,
        onSelect: () => props.onReturn?.(),
        children: entries.map(entry => ({
            id: entry.path,
            label: entry.label,
            glyph: entry.kind === 'folder' ? '›' : '',
            kind: entry.kind,
            testId: 'jump-drawer-entry',
            title: entry.path,
            onSelect: () => {
                if (entry.kind === 'folder') { props.onFolderJump(entry.path); } else { props.onFileJump(entry.path); }
                // every jump-drawer click navigates into a target (descend folder / open file), so dismiss the drawer - unlike the settings/files drawers which stay open while you adjust them
                props.onReturn?.();
            },
        })),
    };

    return (
        <div className={styles.drawerBody} data-testid="jump-drawer">
            <div className={styles.drawerGroups}>
                <section className={styles.drawerGroup}>
                    <DrawerTree nodes={[root_node]} testId="jump-drawer-list" />
                </section>

                <section className={styles.drawerGroup} data-testid="jump-drawer-integration">
                    <p>{l10n.t('View integration')}</p>
                    <p>
                        <ViewIntegrationSelector
                            currentSelection={props.integrationSelection}
                            resolvedMode={props.integrationMode}
                            onChange={props.onIntegrationChange}
                        />
                    </p>
                </section>
            </div>

            <aside className={styles.drawerMeta}>
                <h3>{l10n.t('Jump to')}</h3>
            </aside>
        </div>
    );
}

export default React.memo(JumpDrawer);

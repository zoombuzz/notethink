import Debug from "debug";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:DrawerTree");

/**
 * One row of a drawer tree, and the subtree hanging off it.
 * - id: stable identity for the row; the React key and the fallback data-testid
 * - label: the row's visible content, already localised by the caller
 * - glyph: the character in the leading twisty slot; the default blank keeps labels aligned on rows with no chevron
 * - expanded: rotates the glyph to point down and publishes aria-expanded; omit on a row that is not a container
 * - kind: written through as data-kind so a caller can discriminate rows without a per-row testid
 * - testId / title / ariaLabel: passed to the row button verbatim
 * - current: the row the caller is showing; tints it and publishes aria-selected
 * - disabled: dims the row and blocks its click, for a rung the hierarchy knows about but cannot select yet
 * - trailing: a slot rendered beside the label and OUTSIDE the button, so an interactive control may live there
 * - children: nested rows, rendered one level deeper under the indent guide
 * - placeholder: content shown in the children list when there are no children (a loading or empty-state row)
 * - onSelect: fired on click; whether that also dismisses the drawer is the caller's decision, never this component's
 */
export interface DrawerTreeNode {
    id: string;
    label: ReactNode;
    glyph?: string;
    expanded?: boolean;
    kind?: string;
    testId?: string;
    title?: string;
    ariaLabel?: string;
    current?: boolean;
    disabled?: boolean;
    trailing?: ReactNode;
    children?: DrawerTreeNode[];
    placeholder?: ReactNode;
    onSelect?: () => void;
}

export interface DrawerTreeProps {
    nodes: DrawerTreeNode[];
    testId?: string;
    ariaLabel?: string;
}

interface DrawerTreeItemProps {
    node: DrawerTreeNode;
    depth: number;
}

/**
 * One row plus its subtree. Depth 0 takes the heavier root treatment - a tree's top row reads as a
 * header, matching the VS Code Explorer - and every deeper row takes the plain entry treatment, so
 * arbitrary depth needs no per-row class from the caller. The children list renders whenever the node
 * has children OR a placeholder to show in their place, which is what holds the indent guide open while
 * a reply is still in flight.
 *
 * The current mark goes on the row rather than on the link, so the highlight covers the trailing slot as
 * well as the label; the row also publishes its depth, which is what lets the stylesheet run the band
 * back across the indent guides to the tree's left edge, the way the Explorer highlights a file.
 */
function DrawerTreeItem(props: DrawerTreeItemProps): ReactElement {
    const node = props.node;
    const link_classes = [styles.drawerLink, props.depth === 0 ? styles.drawerTreeRoot : styles.drawerTreeEntry];
    if (node.disabled) { link_classes.push(styles.drawerTreeDimmed); }
    const row_classes = node.current ? `${styles.drawerTreeRow} ${styles.drawerTreeRowCurrent}` : styles.drawerTreeRow;
    const glyph_classes = node.expanded ? `${styles.drawerTreeGlyph} ${styles.drawerTreeGlyphOpen}` : styles.drawerTreeGlyph;
    const has_children = (node.children?.length ?? 0) > 0;
    return (
        <li role="treeitem" aria-expanded={node.expanded} aria-selected={node.current}>
            <div className={row_classes} style={{ '--drawer-tree-depth': props.depth } as React.CSSProperties}>
                <button
                    type="button"
                    className={link_classes.join(' ')}
                    data-testid={node.testId ?? node.id}
                    data-kind={node.kind}
                    title={node.title}
                    aria-label={node.ariaLabel}
                    disabled={node.disabled}
                    onClick={node.onSelect}
                >
                    <span className={glyph_classes}>{node.glyph ?? ''}</span>
                    <span className={styles.drawerTreeLabel}>{node.label}</span>
                </button>
                {node.trailing !== undefined && (
                    <span className={styles.drawerTreeTrailing}>{node.trailing}</span>
                )}
            </div>
            {(has_children || node.placeholder !== undefined) && (
                <ul className={styles.drawerTreeChildren}>
                    {has_children
                        ? node.children?.map(child => <DrawerTreeItem key={child.id} node={child} depth={props.depth + 1} />)
                        : node.placeholder}
                </ul>
            )}
        </li>
    );
}

/**
 * The shared drawer tree: a recursive glyph + indent + label renderer over a plain node list, used by
 * the jump drawer's folder tree and by the view settings tree. It owns presentation only - selection
 * marks, dismissal, and what a click means all arrive per node from the caller, which is what lets the
 * jump tree dismiss on every click while the settings tree stays open.
 */
function DrawerTree(props: DrawerTreeProps): ReactElement {
    debug("rendering %d root node(s)", props.nodes.length);
    return (
        <ul className={styles.drawerTree} role="tree" data-testid={props.testId} aria-label={props.ariaLabel}>
            {props.nodes.map(node => <DrawerTreeItem key={node.id} node={node} depth={0} />)}
        </ul>
    );
}

export default React.memo(DrawerTree);

import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import DrawerTree, { type DrawerTreeNode } from './DrawerTree';
import { VIEW_REGISTRY, childViewNodes, nodeSettingCount } from '../../../lib/viewregistryops';

/**
 * Build the view-settings tree the way the settings pane will: every registry node becomes a row, a
 * radio rides in the trailing slot only for the nodes the board can actually render, and the owned-setting
 * count rides beside it. The jump tree is covered by JumpDrawer.test.tsx, so this file exercises the
 * shape the jump tree never had - arbitrary depth, a trailing slot, and a click that must not dismiss.
 */
function buildRegistryNodes(parent_id: string | undefined, on_select: (node_id: string) => void, current_id?: string): DrawerTreeNode[] {
    return childViewNodes(parent_id).map(node => {
        const children = buildRegistryNodes(node.id, on_select, current_id);
        return {
            id: node.id,
            label: node.label,
            glyph: children.length > 0 ? '›' : '',
            expanded: children.length > 0 ? true : undefined,
            kind: node.kind,
            testId: `view-tree-${node.id}`,
            current: node.id === current_id,
            children,
            trailing: (
                <>
                    {node.selectable && <input type="radio" name="view-type" data-testid={`view-tree-radio-${node.id}`} readOnly checked={false} />}
                    <span data-testid={`view-tree-count-${node.id}`}>{nodeSettingCount(node.id)}</span>
                </>
            ),
            onSelect: () => on_select(node.id),
        };
    });
}

describe('DrawerTree', () => {
    it('renders the registry hierarchy as nested treeitems, one per node', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn())} testId="view-tree" />);
        const tree = screen.getByTestId('view-tree');
        expect(tree).toHaveAttribute('role', 'tree');
        expect(within(tree).getAllByRole('treeitem')).toHaveLength(VIEW_REGISTRY.nodes.length);
        const root_item = within(tree).getByTestId('view-tree-root').closest('li');
        expect(root_item).not.toBeNull();
        expect(within(root_item as HTMLElement).getByTestId('view-tree-document')).toBeInTheDocument();
        expect(within(root_item as HTMLElement).getByTestId('view-tree-grouped')).toBeInTheDocument();
    });

    it('renders depth beyond two levels, which the hand-rolled jump markup could not', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn())} testId="view-tree" />);
        const grouped_item = screen.getByTestId('view-tree-grouped').closest('li') as HTMLElement;
        const line_item = within(grouped_item).getByTestId('view-tree-line').closest('li') as HTMLElement;
        expect(within(line_item).getByTestId('view-tree-kanban')).toBeInTheDocument();
        // kanban sits four rungs down, so its row is enclosed by the tree list plus three nested children lists
        let enclosing_lists = 0;
        for (let element = screen.getByTestId('view-tree-kanban').parentElement; element; element = element.parentElement) {
            if (element.tagName === 'UL') { enclosing_lists++; }
        }
        expect(enclosing_lists).toBe(4);
    });

    it('gives a radio only to the nodes that can render, so an abstract node reads as settings-only', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn())} testId="view-tree" />);
        expect(screen.queryByTestId('view-tree-radio-root')).not.toBeInTheDocument();
        expect(screen.queryByTestId('view-tree-radio-grouped')).not.toBeInTheDocument();
        expect(screen.getByTestId('view-tree-radio-document')).toBeInTheDocument();
        expect(screen.getByTestId('view-tree-radio-line')).toBeInTheDocument();
        expect(screen.getByTestId('view-tree-radio-kanban')).toBeInTheDocument();
    });

    it('renders the trailing slot beside the label and outside the row button', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn())} testId="view-tree" />);
        expect(screen.getByTestId('view-tree-count-kanban')).toHaveTextContent(String(nodeSettingCount('kanban')));
        const radio = screen.getByTestId('view-tree-radio-line');
        expect(radio.closest('button')).toBeNull();
    });

    it('fires the clicked node handler and nothing else, so a caller decides whether to dismiss', () => {
        const on_select = jest.fn();
        const on_dismiss = jest.fn();
        render(<DrawerTree nodes={buildRegistryNodes(undefined, on_select)} testId="view-tree" />);
        fireEvent.click(screen.getByTestId('view-tree-grouped'));
        expect(on_select).toHaveBeenCalledTimes(1);
        expect(on_select).toHaveBeenCalledWith('grouped');
        expect(on_dismiss).not.toHaveBeenCalled();
    });

    it('marks the current node as the selected treeitem', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn(), 'line')} testId="view-tree" />);
        expect(screen.getByTestId('view-tree-line').closest('li')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('view-tree-kanban').closest('li')).toHaveAttribute('aria-selected', 'false');
    });

    it('highlights the whole current row, trailing slot included, and publishes its depth for the bleed', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn(), 'kanban')} testId="view-tree" />);
        const row = screen.getByTestId('view-tree-kanban').parentElement!;
        expect(row).toHaveClass('drawerTreeRowCurrent');
        expect(within(row).getByTestId('view-tree-count-kanban')).toBeInTheDocument();
        // kanban sits three levels down, and the bleed reads the depth off the row to reach the tree's left edge
        expect(row).toHaveStyle({ '--drawer-tree-depth': '3' });
        expect(screen.getByTestId('view-tree-kanban')).not.toHaveClass('drawerTreeRowCurrent');
    });

    it('disables a dimmed row so a future rung cannot be chosen', () => {
        const on_select = jest.fn();
        const nodes: DrawerTreeNode[] = [{ id: 'grid', label: 'Grid', testId: 'future-rung', disabled: true, onSelect: on_select }];
        render(<DrawerTree nodes={nodes} testId="view-tree" />);
        const row = screen.getByTestId('future-rung');
        expect(row).toBeDisabled();
        fireEvent.click(row);
        expect(on_select).not.toHaveBeenCalled();
    });

    it('shows a placeholder in the children list when a node has no children to show yet', () => {
        const nodes: DrawerTreeNode[] = [{
            id: 'root',
            label: 'Root',
            testId: 'placeholder-root',
            placeholder: <li data-testid="placeholder-row">Loading</li>,
        }];
        render(<DrawerTree nodes={nodes} testId="view-tree" />);
        expect(screen.getByTestId('placeholder-row')).toBeInTheDocument();
        expect(screen.getAllByRole('treeitem')).toHaveLength(1);
    });

    it('publishes the node kind and expansion state on the row', () => {
        render(<DrawerTree nodes={buildRegistryNodes(undefined, jest.fn())} testId="view-tree" />);
        expect(screen.getByTestId('view-tree-grouped')).toHaveAttribute('data-kind', 'abstract');
        expect(screen.getByTestId('view-tree-document')).toHaveAttribute('data-kind', 'concrete');
        expect(screen.getByTestId('view-tree-root').closest('li')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('view-tree-kanban').closest('li')).not.toHaveAttribute('aria-expanded');
    });
});

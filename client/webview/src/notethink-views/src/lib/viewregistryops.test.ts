import {
    SETTING_HOMES,
    STRUCTURAL_SETTING_KEYS,
    VIEW_REGISTRY,
    ancestorsOf,
    chainOf,
    childViewNodes,
    getViewNode,
    isDescendantOf,
    isGroupedViewType,
    nodeSettingCount,
    offersNewViewType,
    owningNodeFor,
    registryWithUserTypes,
    removeUserViewType,
    renameUserViewType,
    resolveSetting,
    resolveSettingIn,
    selectableViewIds,
    settingKeysForNode,
    type ViewRegistry,
} from './viewregistryops';
import type { UserViewType } from '../types/Messages';

describe('view tree structure', () => {
    it('root -> {document, grouped}; grouped -> line; line -> kanban', () => {
        expect(getViewNode('document')?.parent).toBe('root');
        expect(getViewNode('grouped')?.parent).toBe('root');
        expect(getViewNode('line')?.parent).toBe('grouped');
        expect(getViewNode('kanban')?.parent).toBe('line');
        expect(getViewNode('root')?.parent).toBeUndefined();
    });

    it('marks abstract nodes non-selectable and concrete nodes selectable', () => {
        expect(getViewNode('root')?.kind).toBe('abstract');
        expect(getViewNode('grouped')?.kind).toBe('abstract');
        expect(getViewNode('root')?.selectable).toBe(false);
        expect(getViewNode('grouped')?.selectable).toBe(false);
        expect(getViewNode('kanban')?.selectable).toBe(true);
    });

    it('marks every node configurable, including the abstract ones that cannot be selected', () => {
        for (const node of VIEW_REGISTRY.nodes) {
            expect(node.configurable).toBe(true);
        }
        expect(getViewNode('root')?.selectable).toBe(false);
        expect(getViewNode('grouped')?.selectable).toBe(false);
    });

    it('selectableViewIds returns the concrete selectable views in tree order', () => {
        expect(selectableViewIds()).toEqual(['document', 'line', 'kanban']);
    });

    it('childViewNodes walks the tree one level at a time, and undefined yields the roots', () => {
        expect(childViewNodes(undefined).map(n => n.id)).toEqual(['root']);
        expect(childViewNodes('root').map(n => n.id)).toEqual(['document', 'grouped']);
        expect(childViewNodes('grouped').map(n => n.id)).toEqual(['line']);
        expect(childViewNodes('line').map(n => n.id)).toEqual(['kanban']);
        expect(childViewNodes('kanban')).toEqual([]);
    });
});

describe('chainOf / ancestorsOf', () => {
    it('walks kanban up to root deepest-first', () => {
        expect(chainOf('kanban')).toEqual(['kanban', 'line', 'grouped', 'root']);
        expect(ancestorsOf('kanban')).toEqual(['line', 'grouped', 'root']);
    });

    it('returns an empty chain for an unknown node', () => {
        expect(chainOf('nope')).toEqual([]);
    });
});

describe('isDescendantOf / isGroupedViewType', () => {
    it('kanban and line sit under grouped; document does not', () => {
        expect(isDescendantOf('kanban', 'grouped')).toBe(true);
        expect(isDescendantOf('line', 'grouped')).toBe(true);
        expect(isDescendantOf('document', 'grouped')).toBe(false);
    });

    it('isGroupedViewType is true for the lane views and false for document', () => {
        expect(isGroupedViewType('kanban')).toBe(true);
        expect(isGroupedViewType('line')).toBe(true);
        expect(isGroupedViewType('document')).toBe(false);
    });
});

describe('settings resolution - deepest override wins', () => {
    it('kanban resolves axes to its own fixed override, not the grouped home default', () => {
        const at_kanban = resolveSetting('kanban', 'axes');
        expect(at_kanban.value).toEqual(['status']);
        expect(at_kanban.fixed_at).toBe('kanban');
        expect(at_kanban.home).toBe('grouped');
    });

    it('line resolves axes to the grouped home default (no override on its chain)', () => {
        const at_line = resolveSetting('line', 'axes');
        expect(at_line.applies).toBe(true);
        expect(at_line.value).toBeUndefined();
        expect(at_line.fixed).toBe(false);
    });

    it('a root-homed setting resolves at a deep leaf by walking the whole chain', () => {
        expect(resolveSetting('kanban', 'viewType').value).toBe('auto');
        expect(resolveSetting('document', 'viewType').value).toBe('auto');
    });

    it('a setting does not apply to a node whose chain excludes its home', () => {
        const at_document = resolveSetting('document', 'axes');
        expect(at_document.applies).toBe(false);
    });

    it('picks the nearest override when a chain carries overrides at two depths', () => {
        const registry: ViewRegistry = {
            nodes: [
                { id: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Root' },
                { id: 'mid', parent: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Mid' },
                { id: 'leaf', parent: 'mid', kind: 'concrete', selectable: true, configurable: true, label: 'Leaf' },
            ],
            settings: [{ key: 'k', home: 'root', default: 'root-default' }],
            overrides: [
                { node: 'mid', key: 'k', mode: 'fixed', value: 'mid-value' },
                { node: 'leaf', key: 'k', mode: 'fixed', value: 'leaf-value' },
            ],
        };
        expect(resolveSettingIn(registry, 'leaf', 'k').value).toBe('leaf-value');
        expect(resolveSettingIn(registry, 'mid', 'k').value).toBe('mid-value');
        expect(resolveSettingIn(registry, 'root', 'k').value).toBe('root-default');
    });
});

describe('fixed setting reports its value and unlocking ancestor', () => {
    it('kanban group-by (axes) is fixed to status and unlocked by selecting Line', () => {
        const resolution = resolveSetting('kanban', 'axes');
        expect(resolution.fixed).toBe(true);
        expect(resolution.value).toEqual(['status']);
        expect(resolution.unlock_view).toBe('line');
    });

    it('line does not fix axes, so it has no unlocking view', () => {
        const resolution = resolveSetting('line', 'axes');
        expect(resolution.fixed).toBe(false);
        expect(resolution.unlock_view).toBeUndefined();
    });

    it('kanban holds its group order as an OPEN override, not fixed', () => {
        const resolution = resolveSetting('kanban', 'groupOrder');
        expect(resolution.fixed).toBe(false);
        expect(resolution.open_at).toBe('kanban');
    });

    it('unlocks at a configurable ancestor even when no ancestor above the fixing node is selectable', () => {
        const registry: ViewRegistry = {
            nodes: [
                { id: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Root' },
                { id: 'mid', parent: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Mid' },
                { id: 'leaf', parent: 'mid', kind: 'concrete', selectable: true, configurable: true, label: 'Leaf' },
            ],
            settings: [{ key: 'k', home: 'root', default: 'root-default' }],
            overrides: [{ node: 'leaf', key: 'k', mode: 'fixed', value: 'leaf-value' }],
        };
        expect(resolveSettingIn(registry, 'leaf', 'k').unlock_view).toBe('mid');
    });

    it('skips an ancestor that is configurable but fixes the key itself', () => {
        const registry: ViewRegistry = {
            nodes: [
                { id: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Root' },
                { id: 'mid', parent: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Mid' },
                { id: 'leaf', parent: 'mid', kind: 'concrete', selectable: true, configurable: true, label: 'Leaf' },
            ],
            settings: [{ key: 'k', home: 'root', default: 'root-default' }],
            overrides: [
                { node: 'mid', key: 'k', mode: 'fixed', value: 'mid-value' },
                { node: 'leaf', key: 'k', mode: 'fixed', value: 'leaf-value' },
            ],
        };
        expect(resolveSettingIn(registry, 'leaf', 'k').unlock_view).toBe('root');
    });

    it('reports no unlocking view when nothing above the fixing node is configurable', () => {
        const registry: ViewRegistry = {
            nodes: [
                { id: 'root', kind: 'abstract', selectable: false, configurable: false, label: 'Root' },
                { id: 'leaf', parent: 'root', kind: 'concrete', selectable: true, configurable: true, label: 'Leaf' },
            ],
            settings: [{ key: 'k', home: 'root', default: 'root-default' }],
            overrides: [{ node: 'leaf', key: 'k', mode: 'fixed', value: 'leaf-value' }],
        };
        expect(resolveSettingIn(registry, 'leaf', 'k').unlock_view).toBeUndefined();
    });
});

describe('existing view settings resolve as today (regression)', () => {
    it('every registry setting declares a home node that exists in the tree', () => {
        for (const setting of VIEW_REGISTRY.settings) {
            expect(getViewNode(setting.home)).toBeDefined();
        }
    });

    it('document and kanban both inherit the generic viewType from root', () => {
        expect(resolveSetting('document', 'viewType').home).toBe('root');
        expect(resolveSetting('kanban', 'viewType').home).toBe('root');
    });

    it('kanban inherits orientation columns from line (unchanged default)', () => {
        expect(resolveSetting('kanban', 'orientation').value).toBe('columns');
    });

    it('groupBy homes at grouped and kanban forks it as an OPEN override at its own config path', () => {
        expect(resolveSetting('line', 'groupBy').home).toBe('grouped');
        expect(resolveSetting('line', 'groupBy').value).toBe('auto');
        const at_kanban = resolveSetting('kanban', 'groupBy');
        expect(at_kanban.fixed).toBe(false);
        expect(at_kanban.open_at).toBe('kanban');
        const override = VIEW_REGISTRY.overrides.find(o => o.node === 'kanban' && o.key === 'groupBy');
        expect(override?.config_path).toBe('view.specific.kanban.groupBy');
    });

    it('every registry config_path is a config path the settings mirror declares', () => {
        const declared = Object.values(SETTING_HOMES).map(home => home.path);
        const paths = [...VIEW_REGISTRY.settings, ...VIEW_REGISTRY.overrides]
            .map(entry => entry.config_path)
            .filter((path): path is string => path !== undefined);
        expect(paths.length).toBeGreaterThan(0);
        for (const path of paths) {
            expect(declared).toContain(path);
        }
    });
});

describe('per-node setting counts', () => {
    it('counts the settings each node owns, and reports zero for a node that owns none', () => {
        expect(nodeSettingCount('root')).toBe(2);
        expect(nodeSettingCount('grouped')).toBe(1);
        expect(nodeSettingCount('line')).toBe(1);
        expect(nodeSettingCount('kanban')).toBe(4);
        expect(nodeSettingCount('document')).toBe(0);
        // the card tree is counted by the same table, since a home names whichever tree it belongs to
        expect(nodeSettingCount('allcards')).toBe(4);
    });

    it('every declared setting is owned by exactly one node, and the counts partition the mirror', () => {
        const owners = [...new Set(Object.values(SETTING_HOMES).map(home => home.node))];
        const total = owners.reduce((sum, owner) => sum + nodeSettingCount(owner), 0);
        expect(total).toBe(Object.keys(SETTING_HOMES).length);
    });

    it('names the keys a node owns in declaration order', () => {
        expect(settingKeysForNode('kanban')).toEqual(['kanbanGroupBy', 'columnOrder', 'kanbanCardRatio', 'kanbanAnimateTransitions']);
        expect(settingKeysForNode('line')).toEqual(['orientation']);
        expect(settingKeysForNode('global')).toEqual(['watchUnopenedFilesInViewer', 'openNewEditorIfNoneOpen']);
    });

    it('narrows to the keys a settings payload actually carries when one is supplied', () => {
        expect(settingKeysForNode('kanban', { columnOrder: [] })).toEqual(['columnOrder']);
        expect(nodeSettingCount('kanban', { columnOrder: [] })).toBe(1);
        expect(nodeSettingCount('root', {})).toBe(0);
    });
});


describe('owningNodeFor - the node a settings row pill names', () => {
    it('names Grouped for Group by at kanban and Kanban for Group order', () => {
        // the pair the offer rule turns on: Group by departs from the axes kanban pins, Group order is a lane preference kanban owns
        expect(owningNodeFor('kanban', 'kanbanGroupBy')).toBe('grouped');
        expect(owningNodeFor('kanban', 'columnOrder')).toBe('kanban');
    });

    it('keys Group by on axes, not on the config key it writes', () => {
        // both groupBy and kanbanGroupBy carry a kanban OPEN override, so keying the row on either would name Kanban and kill the offer
        expect(STRUCTURAL_SETTING_KEYS.groupBy).toBe('axes');
        expect(STRUCTURAL_SETTING_KEYS.kanbanGroupBy).toBe('axes');
        expect(STRUCTURAL_SETTING_KEYS.columnOrder).toBe('groupOrder');
    });

    it('resolves a registry-modelled row through the chain from any node on it', () => {
        expect(owningNodeFor('kanban', 'groupBy')).toBe('grouped');
        expect(owningNodeFor('line', 'groupBy')).toBe('grouped');
        expect(owningNodeFor('kanban', 'orientation')).toBe('line');
        expect(owningNodeFor('line', 'orientation')).toBe('line');
    });

    it('falls back to the flat home for a key with no registry presence', () => {
        expect(owningNodeFor('document', 'scrollNoteIntoView')).toBe('root');
        expect(owningNodeFor('kanban', 'kanbanAnimateTransitions')).toBe('kanban');
    });

    it('names the card home for a card-drawn setting, which is why the view pane never lists one', () => {
        // the three moved onto the card tree; the flat home answers whatever tree it names, and no view chain includes allcards
        expect(owningNodeFor('kanban', 'showLineNumbers')).toBe('allcards');
        expect(owningNodeFor('document', 'showLinetagsInHeadlines')).toBe('allcards');
        expect(owningNodeFor('kanban', 'autoExpandFocusedNote')).toBe('allcards');
    });

    it('yields no pill for the three sentinel homes', () => {
        expect(owningNodeFor('kanban', 'watchUnopenedFilesInViewer')).toBeUndefined();
        expect(owningNodeFor('kanban', 'openNewEditorIfNoneOpen')).toBeUndefined();
        expect(owningNodeFor('kanban', 'includeFilter')).toBeUndefined();
        expect(owningNodeFor('kanban', 'maxNotesPerFile')).toBeUndefined();
        expect(owningNodeFor('kanban', 'viewUserTypes')).toBeUndefined();
    });
});

describe('offersNewViewType - the offer follows the pill', () => {
    it('offers on an ancestor-owned change and stays silent on a node-owned one', () => {
        expect(offersNewViewType('kanban', 'kanbanGroupBy')).toBe(true);
        expect(offersNewViewType('kanban', 'columnOrder')).toBe(false);
        expect(offersNewViewType('kanban', 'kanbanAnimateTransitions')).toBe(false);
    });

    it('offers for orientation from kanban, which line owns, but not from line itself', () => {
        expect(offersNewViewType('kanban', 'orientation')).toBe(true);
        expect(offersNewViewType('line', 'orientation')).toBe(false);
    });

    /*
     * Root is the ancestor that does not offer. Its settings reach every view, so changing one says
     * nothing about what kind of board this is - "Kanban with linetags" is a preference, not a type.
     */
    it('never offers for a setting All views owns, even though root is an ancestor', () => {
        expect(offersNewViewType('document', 'scrollNoteIntoView')).toBe(false);
        expect(offersNewViewType('kanban', 'scrollNoteIntoView')).toBe(false);
    });

    it('never offers for a card-drawn setting, whose owner is on the other tree entirely', () => {
        expect(offersNewViewType('kanban', 'showLineNumbers')).toBe(false);
        expect(offersNewViewType('kanban', 'showLinetagsInHeadlines')).toBe(false);
    });

    it('never offers for a setting belonging to no view type', () => {
        expect(offersNewViewType('kanban', 'watchUnopenedFilesInViewer')).toBe(false);
        expect(offersNewViewType('kanban', 'openNewEditorIfNoneOpen')).toBe(false);
        expect(offersNewViewType('document', 'maxNotesPerFile')).toBe(false);
    });
});

describe('registryWithUserTypes - saved types become real nodes', () => {
    const kanban_by_assignee: UserViewType = {
        id: 'kanban-by-assignee',
        label: 'Kanban by Assignee',
        parent: 'kanban',
        overrides: { kanbanGroupBy: 'assignee' },
    };

    it('parents the saved type on its node and makes it selectable and configurable', () => {
        const merged = registryWithUserTypes([kanban_by_assignee]);
        const node = getViewNode('kanban-by-assignee', merged);
        expect(node?.parent).toBe('kanban');
        expect(node?.kind).toBe('concrete');
        expect(node?.selectable).toBe(true);
        expect(node?.configurable).toBe(true);
        expect(node?.label).toBe('Kanban by Assignee');
        expect(childViewNodes('kanban', merged).map(n => n.id)).toEqual(['kanban-by-assignee']);
        expect(selectableViewIds(merged)).toEqual(['document', 'line', 'kanban', 'kanban-by-assignee']);
        expect(chainOf('kanban-by-assignee', merged)).toEqual(['kanban-by-assignee', 'kanban', 'line', 'grouped', 'root']);
    });

    it('turns each declared override into an OPEN override resolveSetting answers for', () => {
        const merged = registryWithUserTypes([kanban_by_assignee]);
        const resolution = resolveSettingIn(merged, 'kanban-by-assignee', 'axes');
        expect(resolution.open_at).toBe('kanban-by-assignee');
        expect(resolution.fixed).toBe(false);
        expect(owningNodeFor('kanban-by-assignee', 'kanbanGroupBy', merged)).toBe('kanban-by-assignee');
        expect(offersNewViewType('kanban-by-assignee', 'kanbanGroupBy', merged)).toBe(false);
    });

    it('leaves the built-in registry unmutated', () => {
        const node_count = VIEW_REGISTRY.nodes.length;
        const override_count = VIEW_REGISTRY.overrides.length;
        const merged = registryWithUserTypes([kanban_by_assignee]);
        expect(merged.nodes).not.toBe(VIEW_REGISTRY.nodes);
        expect(VIEW_REGISTRY.nodes).toHaveLength(node_count);
        expect(VIEW_REGISTRY.overrides).toHaveLength(override_count);
        expect(getViewNode('kanban-by-assignee')).toBeUndefined();
        expect(selectableViewIds()).toEqual(['document', 'line', 'kanban']);
    });

    it('returns an equivalent registry for an empty list', () => {
        const merged = registryWithUserTypes([]);
        expect(merged.nodes).toEqual(VIEW_REGISTRY.nodes);
        expect(merged.overrides).toEqual(VIEW_REGISTRY.overrides);
        expect(merged.settings).toEqual(VIEW_REGISTRY.settings);
    });

    it('skips a malformed entry rather than throwing, and keeps the good one beside it', () => {
        const missing_label = JSON.parse('[{"id":"no-label","parent":"kanban","overrides":{}}]') as UserViewType[];
        const merged = registryWithUserTypes([
            { id: 'orphan', label: 'Orphan', parent: 'nope', overrides: {} },
            { id: 'kanban', label: 'Duplicate', parent: 'root', overrides: {} },
            { id: 'blank', label: '', parent: 'kanban', overrides: {} },
            ...missing_label,
            kanban_by_assignee,
        ]);
        expect(getViewNode('orphan', merged)).toBeUndefined();
        expect(getViewNode('blank', merged)).toBeUndefined();
        expect(getViewNode('no-label', merged)).toBeUndefined();
        expect(getViewNode('kanban', merged)?.label).toBe('Kanban');
        expect(getViewNode('kanban-by-assignee', merged)).toBeDefined();
        expect(merged.nodes).toHaveLength(VIEW_REGISTRY.nodes.length + 1);
    });

    it('folds entries in order, so a saved type may parent on one declared before it', () => {
        const merged = registryWithUserTypes([
            kanban_by_assignee,
            { id: 'assignee-rows', label: 'Assignee Rows', parent: 'kanban-by-assignee', overrides: { orientation: 'rows' } },
        ]);
        expect(chainOf('assignee-rows', merged)).toEqual(['assignee-rows', 'kanban-by-assignee', 'kanban', 'line', 'grouped', 'root']);
        expect(owningNodeFor('assignee-rows', 'orientation', merged)).toBe('assignee-rows');
        expect(owningNodeFor('assignee-rows', 'kanbanGroupBy', merged)).toBe('kanban-by-assignee');
        expect(offersNewViewType('assignee-rows', 'kanbanGroupBy', merged)).toBe(true);
    });
});

describe('editing the saved view types', () => {

    const alpha = { id: 'user-alpha', label: 'Alpha', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee' } };
    const beta = { id: 'user-beta', label: 'Beta', parent: 'user-alpha', overrides: { orientation: 'rows' } };

    it('renames the label and leaves the id alone, since the id is what settings are stored under', () => {
        const renamed = renameUserViewType([alpha, beta], 'user-alpha', 'Alpha Prime');
        expect(renamed[0]).toEqual({ ...alpha, label: 'Alpha Prime' });
        expect(renamed[1]).toBe(beta);
    });

    it('refuses a blank rename rather than leaving a type with no name in the tree', () => {
        expect(renameUserViewType([alpha], 'user-alpha', '   ')).toEqual([alpha]);
    });

    it('trims the new label, so a stray space cannot produce two types that read alike', () => {
        expect(renameUserViewType([alpha], 'user-alpha', '  Alpha Prime  ')[0].label).toBe('Alpha Prime');
    });

    it('ignores an id no saved type carries', () => {
        expect(renameUserViewType([alpha], 'user-nothing', 'X')).toEqual([alpha]);
    });

    /*
     * A minted type is a real parent, so removing one has to take its descendants with it. Leaving them
     * behind would point them at a node the registry no longer builds, and registryWithUserTypes drops an
     * unparented type on the floor - so the list on disk would keep growing entries nothing can render.
     */
    it('removes a type along with every type saved on top of it', () => {
        expect(removeUserViewType([alpha, beta], 'user-alpha')).toEqual([]);
    });

    it('removes only the named type when nothing was saved on top of it', () => {
        expect(removeUserViewType([alpha, beta], 'user-beta')).toEqual([alpha]);
    });

    it('leaves the list alone for an id no saved type carries', () => {
        expect(removeUserViewType([alpha, beta], 'user-nothing')).toEqual([alpha, beta]);
    });

    it('leaves a registry with nothing left to merge once the last type goes', () => {
        const merged = registryWithUserTypes(removeUserViewType([alpha], 'user-alpha'));
        expect(merged.nodes).toHaveLength(VIEW_REGISTRY.nodes.length);
    });
});

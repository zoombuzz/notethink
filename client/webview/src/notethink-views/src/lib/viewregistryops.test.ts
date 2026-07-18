import {
    VIEW_REGISTRY,
    ancestorsOf,
    chainOf,
    getViewNode,
    isDescendantOf,
    isGroupedViewType,
    isSettingFixed,
    resolveSetting,
    resolveSettingIn,
    selectableViewIds,
    unlockingViewFor,
    type ViewRegistry,
} from './viewregistryops';

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

    it('selectableViewIds returns the concrete selectable views in tree order', () => {
        expect(selectableViewIds()).toEqual(['document', 'line', 'kanban']);
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
                { id: 'root', kind: 'abstract', selectable: false, label: 'Root' },
                { id: 'mid', parent: 'root', kind: 'abstract', selectable: true, label: 'Mid' },
                { id: 'leaf', parent: 'mid', kind: 'concrete', selectable: true, label: 'Leaf' },
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
        expect(isSettingFixed('kanban', 'axes')).toBe(true);
        expect(unlockingViewFor('kanban', 'axes')).toBe('line');
    });

    it('line does not fix axes, so it has no unlocking view', () => {
        expect(isSettingFixed('line', 'axes')).toBe(false);
        expect(unlockingViewFor('line', 'axes')).toBeUndefined();
    });

    it('kanban holds its group order as an OPEN override, not fixed', () => {
        const resolution = resolveSetting('kanban', 'groupOrder');
        expect(resolution.fixed).toBe(false);
        expect(resolution.open_at).toBe('kanban');
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
});

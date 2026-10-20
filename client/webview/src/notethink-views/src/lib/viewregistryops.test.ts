import fs from 'fs';
import path from 'path';
import { CARD_REGISTRY, cardChainOf, isPerCardKey } from '../components/notes/cardregistryops';
import {
    ROOT_NODE,
    SETTING_HOMES,
    VIEW_REGISTRY,
    ancestorsOf,
    builtinViewOverridesFromViews,
    chainOf,
    childViewNodes,
    divergedKeyFor,
    doomedUserTypeIds,
    getViewNode,
    inheritedViewSetting,
    isDescendantOf,
    isGroupedViewType,
    isPerViewKey,
    nodeSettingCount,
    ownBagFor,
    owningNodeFor,
    registryWithUserTypes,
    renameUserViewType,
    resolveViewSetting,
    resolvedSettingsFromCascade,
    selectableViewIds,
    settingKeysForNode,
    settingWriteFor,
    updateUserViewTypeOverrides,
    userTypeHoldsKey,
    userViewTypesFromViews,
    viewSettingValuesEqual,
    type ViewOverridesMap,
} from './viewregistryops';
import type { SettingsCascadePayload, UserViewType } from '../types/Messages';

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

    it('isGroupedViewType is true for the group views and false for document', () => {
        expect(isGroupedViewType('kanban')).toBe(true);
        expect(isGroupedViewType('line')).toBe(true);
        expect(isGroupedViewType('document')).toBe(false);
    });
});

describe('isPerViewKey', () => {
    it('accepts every key whose home is a real view-tree node', () => {
        for (const key of ['groupBy', 'orientation', 'lineBreadth', 'groupDisplay', 'groupOrder', 'cardRatio', 'animateTransitions', 'defaultCardType', 'scrollNoteIntoView'] as const) {
            expect(isPerViewKey(key)).toBe(true);
        }
    });

    it('rejects viewType - the selection itself, not a value a view holds', () => {
        expect(isPerViewKey('viewType')).toBe(false);
    });

    it('rejects the two NODE_GLOBAL rows, which stay global with no per-view divergence', () => {
        expect(isPerViewKey('watchUnopenedFilesInViewer')).toBe(false);
        expect(isPerViewKey('openNewEditorIfNoneOpen')).toBe(false);
    });

    it('rejects a key homed on the card or files tree', () => {
        expect(isPerViewKey('showLineNumbers')).toBe(false);
        expect(isPerViewKey('clockMode')).toBe(false);
        expect(isPerViewKey('includeFilter')).toBe(false);
    });
});

describe('resolveViewSetting - nearest-first across built-in and saved views', () => {
    it('resolves to the flat home value when nothing on the chain holds its own', () => {
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'orientation', 'columns').value).toBe('columns');
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'orientation', 'columns').owner).toBe('line');
        expect(resolveViewSetting(VIEW_REGISTRY, 'line', 'groupBy', 'auto').owner).toBe('grouped');
    });

    it('the setting\'s own home view never consults the map - it IS the home', () => {
        expect(resolveViewSetting(VIEW_REGISTRY, 'line', 'orientation', 'rows', [], { line: { orientation: 'columns' } }).value).toBe('rows');
        expect(resolveViewSetting(VIEW_REGISTRY, 'line', 'orientation', 'rows', [], { line: { orientation: 'columns' } }).owner).toBe('line');
    });

    it('a built-in view below the home resolves its own entry in the views bag', () => {
        const view_overrides: ViewOverridesMap = { kanban: { orientation: 'rows', groupBy: 'assignee' } };
        const resolution = resolveViewSetting(VIEW_REGISTRY, 'kanban', 'orientation', 'columns', [], view_overrides);
        expect(resolution.value).toBe('rows');
        expect(resolution.owner).toBe('kanban');
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'groupBy', 'auto', [], view_overrides).value).toBe('assignee');
    });

    it('kanban resolves groupBy to its own built-in default of status with nothing stored at all', () => {
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'groupBy', 'auto').value).toBe('status');
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'groupBy', 'auto').owner).toBe('kanban');
    });

    it('a stored value at kanban overrides its own built-in default', () => {
        const view_overrides: ViewOverridesMap = { kanban: { groupBy: 'assignee' } };
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'groupBy', 'auto', [], view_overrides).value).toBe('assignee');
    });

    it('a saved type\'s own overrides win over the views bag entry of its built-in parent', () => {
        const saved: UserViewType = { id: 'user-kanban-by-owner', label: 'Kanban by Owner', parent: 'kanban', overrides: { groupBy: 'owner' } };
        const registry = registryWithUserTypes([saved]);
        const resolution = resolveViewSetting(registry, 'user-kanban-by-owner', 'groupBy', 'auto', [saved], { kanban: { groupBy: 'assignee' } });
        expect(resolution.value).toBe('owner');
        expect(resolution.owner).toBe('user-kanban-by-owner');
    });

    it('a saved type under kanban with no override of its own inherits kanban\'s stored value, else kanban\'s own built-in status default', () => {
        const saved: UserViewType = { id: 'user-plain', label: 'Plain', parent: 'kanban', overrides: {} };
        const registry = registryWithUserTypes([saved]);
        expect(resolveViewSetting(registry, 'user-plain', 'groupBy', 'auto', [saved], { kanban: { groupBy: 'assignee' } }).owner).toBe('kanban');
        const no_stored = resolveViewSetting(registry, 'user-plain', 'groupBy', 'auto', [saved], {});
        expect(no_stored.owner).toBe('kanban');
        expect(no_stored.value).toBe('status');
    });

    it('never walks past the key\'s home, even when an ancestor further up the chain happens to hold an entry', () => {
        // a line entry here would never be written in practice (line IS orientation's home), but must not be read regardless
        const view_overrides: ViewOverridesMap = { line: { orientation: 'rows' } };
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'orientation', 'columns', [], view_overrides).owner).toBe('line');
        expect(resolveViewSetting(VIEW_REGISTRY, 'kanban', 'orientation', 'columns', [], view_overrides).value).toBe('columns');
    });
});

describe('inheritedViewSetting - what a node would fall back to if it held nothing of its own', () => {
    it('resolves from the parent, skipping the node\'s own bag entirely', () => {
        const view_overrides: ViewOverridesMap = { kanban: { orientation: 'rows' } };
        const inherited = inheritedViewSetting(VIEW_REGISTRY, 'kanban', 'orientation', 'columns', [], view_overrides);
        expect(inherited.value).toBe('columns');
        expect(inherited.owner).toBe('line');
    });

    it('answers with the flat home value for a root-level node with no parent', () => {
        expect(inheritedViewSetting(VIEW_REGISTRY, 'root', 'scrollNoteIntoView', true).value).toBe(true);
    });

    it('answers with kanban\'s own built-in default rather than its parent\'s value, since the default is not inherited', () => {
        const inherited = inheritedViewSetting(VIEW_REGISTRY, 'kanban', 'groupBy', 'auto');
        expect(inherited.value).toBe('status');
        expect(inherited.owner).toBe('kanban');
    });

    it('a saved type under kanban still inherits from its parent chain, since only kanban itself has the built-in default', () => {
        const saved: UserViewType = { id: 'user-plain', label: 'Plain', parent: 'kanban', overrides: {} };
        const registry = registryWithUserTypes([saved]);
        const inherited = inheritedViewSetting(registry, 'user-plain', 'groupBy', 'auto', [saved], {});
        expect(inherited.value).toBe('status');
        expect(inherited.owner).toBe('kanban');
    });
});

describe('viewSettingValuesEqual - structural equality for clearing', () => {
    it('is true for identical scalars and false for different ones', () => {
        expect(viewSettingValuesEqual('rows', 'rows')).toBe(true);
        expect(viewSettingValuesEqual('rows', 'columns')).toBe(false);
    });

    it('compares arrays and plain objects element/key-wise rather than by reference', () => {
        expect(viewSettingValuesEqual([{ value: 'done', shown: true }], [{ value: 'done', shown: true }])).toBe(true);
        expect(viewSettingValuesEqual([{ value: 'done', shown: true }], [{ value: 'done', shown: false }])).toBe(false);
        expect(viewSettingValuesEqual([1, 2], [1, 2, 3])).toBe(false);
    });
});

describe('ownBagFor', () => {
    it('reads a saved type\'s own overrides', () => {
        const saved: UserViewType = { id: 'user-a', label: 'A', parent: 'kanban', overrides: { orientation: 'rows' } };
        expect(ownBagFor('user-a', [saved], {})).toEqual({ orientation: 'rows' });
    });

    it('reads a built-in node\'s entry in the views bag, merged beneath any built-in default it carries', () => {
        expect(ownBagFor('kanban', [], { kanban: { groupBy: 'assignee' } })).toEqual({ groupBy: 'assignee' });
        expect(ownBagFor('kanban', [], {})).toEqual({ groupBy: 'status' });
        expect(ownBagFor('line', [], { kanban: { groupBy: 'assignee' } })).toEqual({});
    });
});

describe('per-node setting counts', () => {
    it('counts the settings each node owns, and reports zero for a node that owns none', () => {
        expect(nodeSettingCount('root')).toBe(2);
        // groupBy, groupDisplay and groupOrder all home at grouped, shared by every grouped descendant
        expect(nodeSettingCount('grouped')).toBe(3);
        expect(nodeSettingCount('line')).toBe(2);
        expect(nodeSettingCount('kanban')).toBe(3);
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
        expect(settingKeysForNode('grouped')).toEqual(['groupBy', 'groupDisplay', 'groupOrder']);
        expect(settingKeysForNode('kanban')).toEqual(['cardRatio', 'animateTransitions', 'defaultCardType']);
        expect(settingKeysForNode('line')).toEqual(['orientation', 'lineBreadth']);
        expect(settingKeysForNode('global')).toEqual(['watchUnopenedFilesInViewer', 'openNewEditorIfNoneOpen']);
    });

    it('narrows to the keys a settings payload actually carries when one is supplied', () => {
        expect(settingKeysForNode('grouped', { groupDisplay: [] })).toEqual(['groupDisplay']);
        expect(nodeSettingCount('grouped', { groupDisplay: [] })).toBe(1);
        expect(nodeSettingCount('root', {})).toBe(0);
    });
});

describe('owningNodeFor - the view a settings row pill names', () => {
    it('names kanban itself for groupBy and groupDisplay, since kanban always holds at least its own built-in default', () => {
        expect(owningNodeFor('kanban', 'groupBy')).toBe('kanban');
        expect(owningNodeFor('kanban', 'groupDisplay')).toBe('grouped');
        expect(owningNodeFor('line', 'groupDisplay')).toBe('grouped');
        expect(owningNodeFor('kanban', 'orientation')).toBe('line');
        expect(owningNodeFor('line', 'orientation')).toBe('line');
    });

    it('names the built-in view holding its own entry in the views bag', () => {
        const view_overrides: ViewOverridesMap = { kanban: { groupBy: 'assignee' } };
        expect(owningNodeFor('kanban', 'groupBy', VIEW_REGISTRY, [], view_overrides)).toBe('kanban');
    });

    it('falls back to the flat home for a key with no per-view presence', () => {
        expect(owningNodeFor('document', 'scrollNoteIntoView')).toBe('root');
        expect(owningNodeFor('kanban', 'animateTransitions')).toBe('kanban');
    });

    it('names the card home for a card-drawn setting, which is why the view pane never lists one', () => {
        expect(owningNodeFor('kanban', 'showLineNumbers')).toBe('allcards');
        expect(owningNodeFor('document', 'showLinetagsInHeadlines')).toBe('allcards');
        expect(owningNodeFor('kanban', 'autoExpandFocusedNote')).toBe('allcards');
    });

    it('yields no pill for the sentinel homes', () => {
        expect(owningNodeFor('kanban', 'watchUnopenedFilesInViewer')).toBeUndefined();
        expect(owningNodeFor('kanban', 'openNewEditorIfNoneOpen')).toBeUndefined();
        expect(owningNodeFor('kanban', 'includeFilter')).toBeUndefined();
        expect(owningNodeFor('kanban', 'maxNotesPerFile')).toBeUndefined();
    });
});

describe('registryWithUserTypes - saved types become real nodes', () => {
    const kanban_by_assignee: UserViewType = {
        id: 'kanban-by-assignee',
        label: 'Kanban by Assignee',
        parent: 'kanban',
        overrides: { groupBy: 'assignee' },
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

    it('resolves its declared override as its own value', () => {
        const merged = registryWithUserTypes([kanban_by_assignee]);
        expect(owningNodeFor('kanban-by-assignee', 'groupBy', merged, [kanban_by_assignee])).toBe('kanban-by-assignee');
    });

    it('leaves the built-in registry unmutated', () => {
        const node_count = VIEW_REGISTRY.nodes.length;
        const merged = registryWithUserTypes([kanban_by_assignee]);
        expect(merged.nodes).not.toBe(VIEW_REGISTRY.nodes);
        expect(VIEW_REGISTRY.nodes).toHaveLength(node_count);
        expect(getViewNode('kanban-by-assignee')).toBeUndefined();
        expect(selectableViewIds()).toEqual(['document', 'line', 'kanban']);
    });

    it('returns an equivalent registry for an empty list', () => {
        const merged = registryWithUserTypes([]);
        expect(merged.nodes).toEqual(VIEW_REGISTRY.nodes);
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
        const user_types = [
            kanban_by_assignee,
            { id: 'assignee-rows', label: 'Assignee Rows', parent: 'kanban-by-assignee', overrides: { orientation: 'rows' } },
        ];
        expect(owningNodeFor('assignee-rows', 'orientation', merged, user_types)).toBe('assignee-rows');
        expect(owningNodeFor('assignee-rows', 'groupBy', merged, user_types)).toBe('kanban-by-assignee');
    });
});

describe('a custom type owns every key its overrides hold', () => {

    const tall_cards: UserViewType = { id: 'user-tall-cards', label: 'Tall Cards', parent: 'kanban', overrides: { cardRatio: 2 } };

    it('names the custom type for a key it holds that has no per-view presence', () => {
        const merged = registryWithUserTypes([tall_cards]);
        expect(owningNodeFor('user-tall-cards', 'cardRatio', merged, [tall_cards])).toBe('user-tall-cards');
    });

    it('still names the flat home for a key the custom type does not hold', () => {
        const merged = registryWithUserTypes([tall_cards]);
        expect(owningNodeFor('user-tall-cards', 'animateTransitions', merged, [tall_cards])).toBe('kanban');
    });

    it('names the nearest holder from a type saved on top of one', () => {
        const user_types = [
            tall_cards,
            { id: 'user-tall-rows', label: 'Tall Rows', parent: 'user-tall-cards', overrides: { orientation: 'rows' } },
        ];
        const merged = registryWithUserTypes(user_types);
        expect(owningNodeFor('user-tall-rows', 'cardRatio', merged, user_types)).toBe('user-tall-cards');
    });

    it('leaves a built-in rung answering exactly as before, since no saved type is on its chain', () => {
        const merged = registryWithUserTypes([tall_cards]);
        expect(owningNodeFor('kanban', 'cardRatio', merged, [tall_cards])).toBe('kanban');
        expect(owningNodeFor('kanban', 'groupBy', merged, [tall_cards])).toBe('kanban');
        expect(owningNodeFor('kanban', 'groupDisplay', merged, [tall_cards])).toBe('grouped');
    });
});

describe('editing the saved view types', () => {

    const alpha = { id: 'user-alpha', label: 'Alpha', parent: 'kanban', overrides: { groupBy: 'assignee' } };
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

    it('doomedUserTypeIds names a type along with every type saved on top of it', () => {
        expect(doomedUserTypeIds([alpha, beta], 'user-alpha').sort()).toEqual(['user-alpha', 'user-beta']);
    });

    it('doomedUserTypeIds names only the type itself when nothing was saved on top of it', () => {
        expect(doomedUserTypeIds([alpha, beta], 'user-beta')).toEqual(['user-beta']);
    });

    it('doomedUserTypeIds names only the id given for an id no saved type carries', () => {
        expect(doomedUserTypeIds([alpha, beta], 'user-nothing')).toEqual(['user-nothing']);
    });
});

describe('updating a saved view type', () => {

    const alpha: UserViewType = { id: 'user-alpha', label: 'Alpha', parent: 'kanban', overrides: { groupBy: 'assignee' } };
    const beta: UserViewType = { id: 'user-beta', label: 'Beta', parent: 'kanban', overrides: { orientation: 'rows' } };

    it('merges the new values into the named type and leaves its siblings alone', () => {
        const updated = updateUserViewTypeOverrides([alpha, beta], 'user-alpha', { cardRatio: 2 });
        expect(updated[0].overrides).toEqual({ groupBy: 'assignee', cardRatio: 2 });
        expect(updated[1]).toBe(beta);
    });

    it('replaces the value of a key the type already holds', () => {
        expect(updateUserViewTypeOverrides([alpha], 'user-alpha', { groupBy: 'status' })[0].overrides).toEqual({ groupBy: 'status' });
    });

    it('leaves the id, label and parent alone, since the id is what settings are stored under', () => {
        const updated = updateUserViewTypeOverrides([alpha], 'user-alpha', { orientation: 'rows' })[0];
        expect(updated.id).toBe('user-alpha');
        expect(updated.label).toBe('Alpha');
        expect(updated.parent).toBe('kanban');
    });

    it('ignores an id no saved type carries', () => {
        expect(updateUserViewTypeOverrides([alpha], 'user-nothing', { orientation: 'rows' })).toEqual([alpha]);
    });

    it('treats a type whose overrides are not an object as declaring nothing rather than throwing', () => {
        const malformed = JSON.parse('[{"id":"user-bad","label":"Bad","parent":"kanban","overrides":null}]') as UserViewType[];
        expect(updateUserViewTypeOverrides(malformed, 'user-bad', { orientation: 'rows' })[0].overrides).toEqual({ orientation: 'rows' });
        expect(userTypeHoldsKey(malformed[0], 'orientation')).toBe(false);
    });

    it('reports which keys a type holds, which is what routes a row change into it', () => {
        expect(userTypeHoldsKey(alpha, 'groupBy')).toBe(true);
        expect(userTypeHoldsKey(alpha, 'cardRatio')).toBe(false);
        expect(userTypeHoldsKey(undefined, 'groupBy')).toBe(false);
    });
});

describe('settingWriteFor - the one engine for every per-view write', () => {
    it('writes a built-in view\'s own home setting flat, at its own key', () => {
        expect(settingWriteFor(VIEW_REGISTRY, [], {}, 'line', 'orientation', 'rows', 'columns'))
            .toEqual({ setting: 'views', value: { sets: [{ node_id: 'line', key: 'orientation', value: 'rows' }] } });
    });

    it('writes a built-in descendant\'s own value as a views bag delta', () => {
        const write = settingWriteFor(VIEW_REGISTRY, [], {}, 'kanban', 'orientation', 'rows', 'columns');
        expect(write).toEqual({ setting: 'views', value: { sets: [{ node_id: 'kanban', key: 'orientation', value: 'rows' }] } });
    });

    it('clears a built-in descendant\'s own entry when the new value equals what it would inherit', () => {
        const view_overrides: ViewOverridesMap = { kanban: { orientation: 'rows' } };
        const write = settingWriteFor(VIEW_REGISTRY, [], view_overrides, 'kanban', 'orientation', 'columns', 'columns');
        expect(write).toEqual({ setting: 'views', value: { sets: [{ node_id: 'kanban', key: 'orientation', value: undefined }] } });
    });

    it('clears kanban\'s own groupBy entry when set back to status, its own built-in default', () => {
        const view_overrides: ViewOverridesMap = { kanban: { groupBy: 'assignee' } };
        const write = settingWriteFor(VIEW_REGISTRY, [], view_overrides, 'kanban', 'groupBy', 'status', 'auto');
        expect(write).toEqual({ setting: 'views', value: { sets: [{ node_id: 'kanban', key: 'groupBy', value: undefined }] } });
    });

    it('writes a saved type\'s own per-view value as a views bag delta, never the ancestor it was saved from', () => {
        const saved: UserViewType = { id: 'user-a', label: 'A', parent: 'kanban', overrides: {} };
        const write = settingWriteFor(registryWithUserTypes([saved]), [saved], {}, 'user-a', 'groupBy', 'assignee', 'auto');
        expect(write).toEqual({ setting: 'views', value: { sets: [{ node_id: 'user-a', key: 'groupBy', value: 'assignee' }] } });
    });

    it('clears a saved type\'s own per-view value when it equals what it would inherit', () => {
        const saved: UserViewType = { id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } };
        const write = settingWriteFor(registryWithUserTypes([saved]), [saved], {}, 'user-a', 'groupBy', 'status', 'auto');
        expect(write).toEqual({ setting: 'views', value: { sets: [{ node_id: 'user-a', key: 'groupBy', value: undefined }] } });
    });

    it('writes a per-view kanban-homed key into a saved type below kanban even when it does not yet hold it', () => {
        const held: UserViewType = { id: 'user-a', label: 'A', parent: 'kanban', overrides: {} };
        expect(settingWriteFor(registryWithUserTypes([held]), [held], {}, 'user-a', 'cardRatio', 2, 1.4))
            .toEqual({ setting: 'views', value: { sets: [{ node_id: 'user-a', key: 'cardRatio', value: 2 }] } });
    });

    it('writes a non-per-view key at the flat home, unchanged pre-existing behaviour, whatever node is selected', () => {
        const held: UserViewType = { id: 'user-a', label: 'A', parent: 'kanban', overrides: {} };
        expect(settingWriteFor(registryWithUserTypes([held]), [held], {}, 'user-a', 'watchUnopenedFilesInViewer', false, true))
            .toEqual({ setting: 'watchUnopenedFilesInViewer', value: false });
    });
});

describe('divergedKeyFor - which diverged entry a row\'s M reflects', () => {
    it('answers with a bag cell even when the owner is the setting\'s own home, since there is no bare-key form', () => {
        expect(divergedKeyFor('line', 'orientation', 'views')).toBe('views:line:orientation');
        expect(divergedKeyFor('grouped', 'groupBy', 'views')).toBe('views:grouped:groupBy');
    });

    it('answers with a views bag cell when the owner is a built-in node below the home', () => {
        expect(divergedKeyFor('kanban', 'orientation', 'views')).toBe('views:kanban:orientation');
    });

    it('answers with a views bag cell when the owner is a saved type too, since both now live in the same bag', () => {
        expect(divergedKeyFor('user-a', 'orientation', 'views')).toBe('views:user-a:orientation');
    });

    it('answers with a cards bag cell when passed the card tree\'s own bag name', () => {
        expect(divergedKeyFor('card', 'showLineNumbers', 'cards')).toBe('cards:card:showLineNumbers');
    });
});

describe('userViewTypesFromViews - saved types extracted from the views bag', () => {
    it('reads a saved type\'s parent, label and overrides from its own bag entry', () => {
        const views: ViewOverridesMap = { 'user-a': { parent: 'kanban', label: 'A', groupBy: 'assignee' } };
        expect(userViewTypesFromViews(views)).toEqual([{ id: 'user-a', parent: 'kanban', label: 'A', overrides: { groupBy: 'assignee' } }]);
    });

    it('never treats a built-in node\'s own entry as a saved type', () => {
        const views: ViewOverridesMap = { kanban: { groupBy: 'assignee' } };
        expect(userViewTypesFromViews(views)).toEqual([]);
    });

    it('skips an entry missing a parent or a label rather than throwing', () => {
        const views: ViewOverridesMap = { 'user-bad': { groupBy: 'assignee' } };
        expect(userViewTypesFromViews(views)).toEqual([]);
    });

    it('answers with an empty list for an empty or absent bag', () => {
        expect(userViewTypesFromViews({})).toEqual([]);
        expect(userViewTypesFromViews(undefined as unknown as ViewOverridesMap)).toEqual([]);
    });
});

describe('builtinViewOverridesFromViews - a built-in view\'s own entries, narrowed out of the views bag', () => {
    it('carries only the built-in ids, leaving a saved type\'s entry out', () => {
        const views: ViewOverridesMap = {
            kanban: { groupBy: 'assignee' },
            'user-a': { parent: 'kanban', label: 'A', groupBy: 'owner' },
        };
        expect(builtinViewOverridesFromViews(views)).toEqual({ kanban: { groupBy: 'assignee' } });
    });

    it('leaves out a built-in id with nothing stored', () => {
        expect(builtinViewOverridesFromViews({})).toEqual({});
    });
});

describe('resolvedSettingsFromCascade - unpacking the wire payload into the flat shape', () => {
    function wire(partial: Partial<SettingsCascadePayload>): SettingsCascadePayload {
        return {
            views: {},
            cards: {},
            watchUnopenedFilesInViewer: true,
            openNewEditorIfNoneOpen: false,
            includeFilter: '**/*.md',
            excludeFilter: '',
            maxNotesPerFile: 10,
            diverged: [],
            hasWorkspaceOverrides: false,
            hasAnyOverrides: false,
            ...partial,
        };
    }

    it('defaults every key to its generic built-in default with nothing stored anywhere', () => {
        const resolved = resolvedSettingsFromCascade(wire({}));
        expect(resolved.viewType).toBe('auto');
        expect(resolved.cardType).toBe('auto');
        expect(resolved.groupBy).toBe('auto');
        expect(resolved.orientation).toBe('columns');
        expect(resolved.clockMode).toBe('active');
        expect(resolved.viewUserTypes).toEqual([]);
        expect(resolved.viewOverrides).toEqual({});
    });

    it('reads each view-homed key off its own home node in the views bag', () => {
        const resolved = resolvedSettingsFromCascade(wire({ views: { root: { viewType: 'kanban' }, line: { orientation: 'rows' } } }));
        expect(resolved.viewType).toBe('kanban');
        expect(resolved.orientation).toBe('rows');
    });

    it('reads each card-homed key off its own home node in the cards bag', () => {
        const resolved = resolvedSettingsFromCascade(wire({ cards: { allcards: { cardType: 'sticky' }, agent: { clockMode: 'span' } } }));
        expect(resolved.cardType).toBe('sticky');
        expect(resolved.clockMode).toBe('span');
    });

    it('derives viewUserTypes and viewOverrides from the views bag, keeping the two apart', () => {
        const resolved = resolvedSettingsFromCascade(wire({
            views: {
                kanban: { groupBy: 'assignee' },
                'user-a': { parent: 'kanban', label: 'A', groupBy: 'owner' },
            },
        }));
        expect(resolved.viewUserTypes).toEqual([{ id: 'user-a', parent: 'kanban', label: 'A', overrides: { groupBy: 'owner' } }]);
        expect(resolved.viewOverrides).toEqual({ kanban: { groupBy: 'assignee' } });
    });

    it('carries the flat global and files settings straight through', () => {
        const resolved = resolvedSettingsFromCascade(wire({ watchUnopenedFilesInViewer: false, includeFilter: '**/*.foo' }));
        expect(resolved.watchUnopenedFilesInViewer).toBe(false);
        expect(resolved.includeFilter).toBe('**/*.foo');
    });

    it('carries the three divergence aggregates straight through', () => {
        const resolved = resolvedSettingsFromCascade(wire({ diverged: ['views:kanban:groupBy'], hasWorkspaceOverrides: true, hasAnyOverrides: true }));
        expect(resolved.diverged).toEqual(['views:kanban:groupBy']);
        expect(resolved.hasWorkspaceOverrides).toBe(true);
        expect(resolved.hasAnyOverrides).toBe(true);
    });
});

/**
 * The extension declares one `notethink.settings.*` key per tree node per setting, and the two bundles
 * share no module graph, so this reads the manifest itself: every node at or below a key's home must have
 * a declared key, carrying a default only at the home, and no tree key may be declared anywhere else.
 */
describe('package.json declares a key for every node that can hold a tree setting', () => {
    const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const properties: Record<string, { default?: unknown; markdownDeprecationMessage?: string }> = manifest.contributes.configuration[0].properties;
    // the two global settings and the saved-type list sit under the view prefix but belong to no tree node
    const NON_TREE_PATHS = new Set(['view.userTypes', 'view.generic.watchUnopenedFilesInViewer', 'view.generic.openNewEditorIfNoneOpen']);
    function declaredPath(bag: 'views' | 'cards', node_id: string, key: string): string {
        if (key === 'viewType') { return 'view.type'; }
        if (key === 'cardType') { return 'card.type'; }
        const tree = bag === 'views' ? 'view' : 'card';
        const top = bag === 'views' ? ROOT_NODE : 'allcards';
        return node_id === top ? `${tree}.generic.${key}` : `${tree}.specific.${node_id}.${key}`;
    }
    function expectedTreePaths(): Map<string, boolean> {
        const expected = new Map<string, boolean>();
        for (const [key, home] of Object.entries(SETTING_HOMES)) {
            if (home.bag === 'views') {
                const holders = isPerViewKey(key as keyof typeof SETTING_HOMES) ? VIEW_REGISTRY.nodes.map(n => n.id).filter(id => chainOf(id).includes(home.node)) : [home.node];
                holders.forEach(id => expected.set(declaredPath('views', id, key), id === home.node));
            }
            if (home.bag === 'cards') {
                const holders = isPerCardKey(key as keyof typeof SETTING_HOMES) ? CARD_REGISTRY.nodes.map(n => n.id).filter(id => cardChainOf(id).includes(home.node)) : [home.node];
                holders.forEach(id => expected.set(declaredPath('cards', id, key), id === home.node));
            }
        }
        return expected;
    }
    // a deprecated declaration is a pre-0.4.9 key kept only so its old value can still be read, never a cell
    it('declares exactly the tree keys the view and card trees can hold', () => {
        const declared = Object.keys(properties)
            .filter(full => full.startsWith('notethink.settings.view.') || full.startsWith('notethink.settings.card.'))
            .filter(full => properties[full]?.markdownDeprecationMessage === undefined)
            .map(full => full.slice('notethink.settings.'.length))
            .filter(config_path => !NON_TREE_PATHS.has(config_path));
        expect(declared.sort()).toEqual([...expectedTreePaths().keys()].sort());
    });
    it('gives a default only to the key at a setting\'s home', () => {
        for (const [config_path, is_home] of expectedTreePaths()) {
            expect({ config_path, has_default: properties[`notethink.settings.${config_path}`]?.default !== undefined }).toEqual({ config_path, has_default: is_home });
        }
    });
});

import Debug from "debug";
import type { SettingsCascadeKey, SettingsCascadePayload, UserViewType } from "../types/Messages";

const debug = Debug("nodejs:notethink-views:viewregistryops");

/*
 * The view hierarchy as data. The dimensional ladder - root -> {document, grouped}; grouped -> {line,
 * grid(future), cube(future)}; line -> {kanban} - lives here as one declarative registry: every node's
 * parent, kind, label, selectability and configurability, plus the settings model layered on top. Every part of the view
 * programme (the selector, line->kanban parentage, a group-by owned by a shared ancestor, a setting a
 * child fixes but an ancestor can edit) is a query against this registry rather than logic re-derived in
 * three places.
 *
 * The settings model has three concerns and one engine:
 *  - storage: every setting has ONE home node where it is declared; a descendant may carry an override
 *  - an override is FIXED (child pins it as identity, read-only here, edit at the unlocking ancestor -
 *    kanban's group-by = status) or OPEN (child holds its own editable value - kanban's group order)
 *  - resolution: the effective structural value for a node is the deepest override on its ancestor
 *    chain, else the home default; the runtime per-session viewState -> extension cascade -> built-in
 *    default layering (composerops) sits UNDER each node's value and is not modelled here
 *
 * Abstract nodes (root, grouped) own settings but do not render; concrete nodes (document, line, kanban)
 * render. `line` is the single-axis card-lane view; `kanban` is `line` preset to status plus chrome.
 * grid/cube are future rungs the model accommodates but this file does not build.
 */

export type ViewNodeKind = 'abstract' | 'concrete';

/**
 * A node in the view hierarchy.
 * - parent: the node id above this one; undefined for root
 * - kind: 'abstract' nodes own settings but are not rendered; 'concrete' nodes render
 * - selectable: whether the user may switch the board to this view (abstract nodes and future rungs are false)
 * - configurable: whether this node owns settings worth showing, so the tree offers it for selection-of-settings
 *   even when it cannot render; the two marks are independent, and root and grouped carry only the second
 * - label: display base for the selector / drawer (l10n capitalisation is applied by viewTypeLabel)
 */
export interface ViewNode {
    id: string;
    parent?: string;
    kind: ViewNodeKind;
    selectable: boolean;
    configurable: boolean;
    label: string;
}

/**
 * A setting declared at its home node, with the structural default that applies when no descendant
 * override wins. `config_path` records the `notethink.settings.*` key this setting persists to (when it
 * has one) so the drawer and the extension can stay in lockstep without a second lookup table.
 */
export interface ViewSettingDecl {
    key: string;
    home: string;
    default?: unknown;
    config_path?: string;
}

/**
 * An override a descendant node applies to an inherited setting.
 * - mode 'fixed': the node pins the value as identity; it is read-only here and editable only at the
 *   nearest configurable ancestor that does not itself fix it (the unlocking view)
 * - mode 'open': the node holds its own editable value (a fork the descendant owns, e.g. kanban's group
 *   order persisted at its own config path)
 * - config_path: the `notethink.settings.*` key an OPEN override persists to, when it forks to its own key
 */
export interface ViewSettingOverride {
    node: string;
    key: string;
    mode: 'fixed' | 'open';
    value?: unknown;
    config_path?: string;
}

export interface ViewRegistry {
    nodes: ViewNode[];
    settings: ViewSettingDecl[];
    overrides: ViewSettingOverride[];
}

/**
 * SettingResolution, the answer the engine returns for "what does setting K look like at node N".
 * - applies: whether K is defined on N's ancestor chain at all (its home is N or an ancestor)
 * - value: the structural value - a fixed override's pinned value, else the home default
 * - fixed / fixed_at: whether a fixed override on the chain pins K for N, and the node applying it
 * - open_at: the node holding an OPEN (own editable) override, when one is the nearest override
 * - unlock_view: the configurable ancestor that unlocks a fixed setting (edit K from that node's settings)
 */
export interface SettingResolution {
    key: string;
    home?: string;
    applies: boolean;
    value: unknown;
    fixed: boolean;
    fixed_at?: string;
    open_at?: string;
    unlock_view?: string;
}

/*
 * Owning-node sentinels for settings that belong to no view type: NODE_GLOBAL renders under the settings
 * drawer's "Global settings" heading with no owning-type pill, NODE_FILES belongs to the Files drawer and
 * the view drawer never lists it. Mirrored from settings.ts alongside SETTING_HOMES below.
 */
export const NODE_GLOBAL = 'global';
export const NODE_FILES = 'files';
export const NODE_INTERNAL = 'internal';

// the tree's root: it owns the settings every view inherits, so changing one offers no new type
export const ROOT_NODE = 'root';

/**
 * Where each setting lives, mirrored from `SETTINGS` in `client/extension/src/lib/settings.ts`.
 *
 * The extension host and the webview are separate webpack bundles with no shared module graph, so there
 * is no import path from here to that map - this is the same deliberate mirror as the folder-view defaults
 * duplicated in the two `constants.ts` files, and the contract is that the shared subset agrees.
 *
 * ADDING A KEY TO `SettingsCascadePayload` WITHOUT A HOME HERE IS A COMPILE ERROR. That is the whole
 * point of the `satisfies Record<SettingsCascadeKey, ...>` below, and it is stronger than the constants.ts
 * mirror it is modelled on, which agrees only by review. Rely on it: a caller counting or grouping the
 * settings a node owns can treat this table as complete for every key on the wire, because an incomplete
 * one does not build. The mirror still has to be kept truthful by hand in one respect the compiler cannot
 * see - that each `node` and `path` matches the `SETTINGS` entry of the same name.
 * - node: the owning tree node, a view-registry id, a card-registry id, or one of the sentinels below
 * - path: the dotted `notethink.settings.*` config path, so a registry config_path resolves to one place
 */
export const SETTING_HOMES = {
    viewType:                   { node: 'root',      path: 'view.type' },
    cardType:                   { node: 'allcards',  path: 'card.type' },
    viewUserTypes:              { node: NODE_INTERNAL, path: 'view.userTypes' },
    showLinetagsInHeadlines:    { node: 'allcards',  path: 'view.generic.showLinetagsInHeadlines' },
    scrollNoteIntoView:         { node: 'root',      path: 'view.generic.scrollNoteIntoView' },
    autoExpandFocusedNote:      { node: 'allcards',  path: 'view.generic.autoExpandFocusedNote' },
    showLineNumbers:            { node: 'allcards',  path: 'view.generic.showLineNumbers' },
    groupBy:                    { node: 'grouped',   path: 'view.specific.grouped.groupBy' },
    orientation:                { node: 'line',      path: 'view.specific.line.orientation' },
    kanbanGroupBy:              { node: 'kanban',    path: 'view.specific.kanban.groupBy' },
    columnOrder:                { node: 'kanban',    path: 'view.specific.kanban.columnOrder' },
    kanbanCardRatio:            { node: 'kanban',    path: 'view.specific.kanban.cardRatio' },
    kanbanAnimateTransitions:   { node: 'kanban',    path: 'view.specific.kanban.animateTransitions' },
    watchUnopenedFilesInViewer: { node: NODE_GLOBAL, path: 'view.generic.watchUnopenedFilesInViewer' },
    openNewEditorIfNoneOpen:    { node: NODE_GLOBAL, path: 'view.generic.openNewEditorIfNoneOpen' },
    includeFilter:              { node: NODE_FILES,  path: 'files.includeFilter' },
    excludeFilter:              { node: NODE_FILES,  path: 'files.excludeFilter' },
    maxNotesPerFile:            { node: NODE_FILES,  path: 'files.maxNotesPerFile' },
} as const satisfies Record<SettingsCascadeKey, { node: string; path: string }>;

/*
 * the dimensional ladder plus the settings homes and overrides. `axes` (the ordered group keys),
 * `groupOrder` (the per-axis lane order) and `groupBy` (the user-chosen axis key) home at grouped;
 * `orientation` homes at line; the generic settings and the view selection home at root. kanban FIXES
 * axes[0] to status (edit by selecting Line) and holds its own OPEN group order and group-by at the
 * kanban config paths, so a change made from kanban forks rather than moving the ancestor's value.
 * grouped's own group order carries no config_path because no shipped key persists it - only kanban's
 * columnOrder does. Every node owns settings, so every node is configurable; only the concrete rungs
 * are selectable.
 */
export const VIEW_REGISTRY: ViewRegistry = {
    nodes: [
        { id: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Root' },
        { id: 'document', parent: 'root', kind: 'concrete', selectable: true, configurable: true, label: 'Document' },
        { id: 'grouped', parent: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Grouped' },
        { id: 'line', parent: 'grouped', kind: 'concrete', selectable: true, configurable: true, label: 'Line' },
        { id: 'kanban', parent: 'line', kind: 'concrete', selectable: true, configurable: true, label: 'Kanban' },
    ],
    settings: [
        { key: 'viewType', home: 'root', default: 'auto', config_path: SETTING_HOMES.viewType.path },
        { key: 'axes', home: 'grouped', default: undefined },
        { key: 'groupOrder', home: 'grouped', default: [] },
        { key: 'groupBy', home: 'grouped', default: 'auto', config_path: SETTING_HOMES.groupBy.path },
        { key: 'orientation', home: 'line', default: 'columns', config_path: SETTING_HOMES.orientation.path },
    ],
    overrides: [
        { node: 'kanban', key: 'axes', mode: 'fixed', value: ['status'] },
        { node: 'kanban', key: 'groupOrder', mode: 'open', value: undefined, config_path: SETTING_HOMES.columnOrder.path },
        { node: 'kanban', key: 'groupBy', mode: 'open', value: undefined, config_path: SETTING_HOMES.kanbanGroupBy.path },
    ],
};

/*
 * the rows whose pill and offer are decided by a registry setting rather than by a flat home. A row has
 * two keys: its STRUCTURAL key is the registry setting carrying the override semantics, its WRITE key is
 * the cascade key the value persists to. Group by is the case that forces the split - both groupBy and
 * kanbanGroupBy carry a kanban OPEN override, so keying that row on its write key would put its pill on
 * Kanban and suppress the offer, while `axes` is the key kanban FIXES to status and departing from that
 * pin is exactly what saving a new view type means. Group order carries no such pin, so reordering
 * lanes is a preference kanban owns and offers nothing. Every key absent here has no registry presence
 * and answers from SETTING_HOMES.
 */
export const STRUCTURAL_SETTING_KEYS: Partial<Record<SettingsCascadeKey, string>> = {
    viewType: 'viewType',
    groupBy: 'axes',
    kanbanGroupBy: 'axes',
    columnOrder: 'groupOrder',
    orientation: 'orientation',
};

/** the node record for an id in the given registry (defaults to the built-in VIEW_REGISTRY) */
export function getViewNode(id: string, registry: ViewRegistry = VIEW_REGISTRY): ViewNode | undefined {
    return registry.nodes.find(n => n.id === id);
}

/**
 * the ancestor chain for a node, deepest-first: the node itself, then its parent, up to the root. An
 * unknown id yields an empty chain. Bounded by the node count so a malformed parent cycle cannot loop.
 */
export function chainOf(id: string, registry: ViewRegistry = VIEW_REGISTRY): string[] {
    const chain: string[] = [];
    let current: string | undefined = id;
    const max_depth = registry.nodes.length;
    while (current !== undefined && chain.length <= max_depth) {
        const node = getViewNode(current, registry);
        if (!node) { break; }
        chain.push(node.id);
        current = node.parent;
    }
    return chain;
}

/** the ancestors of a node, deepest-first, excluding the node itself */
export function ancestorsOf(id: string, registry: ViewRegistry = VIEW_REGISTRY): string[] {
    return chainOf(id, registry).slice(1);
}

/** true when `ancestor` is a strict ancestor of `id` on the tree */
export function isDescendantOf(id: string, ancestor: string, registry: ViewRegistry = VIEW_REGISTRY): boolean {
    return ancestorsOf(id, registry).includes(ancestor);
}

/**
 * true when a view renders lanes (it sits under `grouped`): line and kanban today. Drives the settings
 * drawer's per-view dispatch (lane drawer vs document drawer) without a hardcoded `type ===` list.
 */
export function isGroupedViewType(id: string, registry: ViewRegistry = VIEW_REGISTRY): boolean {
    return isDescendantOf(id, 'grouped', registry);
}

/** the selectable concrete view ids in tree order (document, line, kanban); the source of the selector list */
export function selectableViewIds(registry: ViewRegistry = VIEW_REGISTRY): string[] {
    return registry.nodes.filter(n => n.selectable).map(n => n.id);
}

/** the direct children of a node in declaration order; pass undefined for the tree's roots */
export function childViewNodes(parent_id: string | undefined, registry: ViewRegistry = VIEW_REGISTRY): ViewNode[] {
    return registry.nodes.filter(n => n.parent === parent_id);
}

/** the nearest override for `key` walking `chain` deepest-first, or undefined when none is on the chain */
function nearestOverrideOnChain(chain: string[], key: string, registry: ViewRegistry): ViewSettingOverride | undefined {
    for (const node_id of chain) {
        const override = registry.overrides.find(o => o.node === node_id && o.key === key);
        if (override) { return override; }
    }
    return undefined;
}

/**
 * the ancestor that unlocks a fixed setting: the nearest node strictly above the fixing node that is
 * CONFIGURABLE and does not itself fix the key. undefined when nothing above can edit it. Configurable
 * rather than selectable, because the question this answers is "where is this setting editable", and the
 * settings tree offers a node's settings whether or not the board can render it. The two agree on today's
 * registry, where every rung that can be selected can also be configured; they part on an abstract owner
 * such as grouped, which holds the value but renders nothing.
 */
function unlockingViewOnChain(chain: string[], fixed_at: string, key: string, registry: ViewRegistry): string | undefined {
    const start = chain.indexOf(fixed_at) + 1;
    for (let i = start; i < chain.length; i++) {
        const node_id = chain[i];
        const node = getViewNode(node_id, registry);
        const fixes_here = registry.overrides.some(o => o.node === node_id && o.key === key && o.mode === 'fixed');
        if (node?.configurable && !fixes_here) { return node_id; }
    }
    return undefined;
}

/**
 * resolve a setting for a node against an explicit registry (the pure, testable core). Walks the node's
 * ancestor chain deepest-first; the nearest override wins over the home default, a fixed override reports
 * the view that unlocks it, and a setting whose home is not on the chain does not apply to the node.
 */
export function resolveSettingIn(registry: ViewRegistry, node_id: string, key: string): SettingResolution {
    const decl = registry.settings.find(s => s.key === key);
    const chain = chainOf(node_id, registry);
    if (!decl || !chain.includes(decl.home)) {
        return { key, home: decl?.home, applies: false, value: undefined, fixed: false };
    }
    const override = nearestOverrideOnChain(chain, key, registry);
    if (override?.mode === 'fixed') {
        return {
            key,
            home: decl.home,
            applies: true,
            value: override.value,
            fixed: true,
            fixed_at: override.node,
            unlock_view: unlockingViewOnChain(chain, override.node, key, registry),
        };
    }
    if (override?.mode === 'open') {
        return { key, home: decl.home, applies: true, value: decl.default, fixed: false, open_at: override.node };
    }
    return { key, home: decl.home, applies: true, value: decl.default, fixed: false };
}

/** resolve a setting for a node against the built-in registry */
export function resolveSetting(node_id: string, key: string): SettingResolution {
    return resolveSettingIn(VIEW_REGISTRY, node_id, key);
}

/**
 * The settings a tree node owns, in SETTING_HOMES declaration order. Pass a settings payload to narrow
 * the answer to the keys that payload actually carries, so a node's count reflects what the drawer can
 * show rather than what the mirror declares; omit it to count every declared setting.
 */
export function settingKeysForNode(node_id: string, settings?: Partial<SettingsCascadePayload>): SettingsCascadeKey[] {
    const keys = Object.keys(SETTING_HOMES) as SettingsCascadeKey[];
    return keys.filter(key => SETTING_HOMES[key].node === node_id && (settings === undefined || key in settings));
}

/** how many settings a node owns; the count the settings tree renders beside each node label */
export function nodeSettingCount(node_id: string, settings?: Partial<SettingsCascadePayload>): number {
    return settingKeysForNode(node_id, settings).length;
}

/** true for a setting home naming no view type, so its row renders no pill and never offers a new type */
function isSentinelNode(node_id: string): boolean {
    return node_id === NODE_GLOBAL || node_id === NODE_FILES || node_id === NODE_INTERNAL;
}

/** the registry setting governing a row, or the key itself when the key has no registry presence */
function structuralKeyFor(key: string): string {
    return STRUCTURAL_SETTING_KEYS[key as SettingsCascadeKey] ?? key;
}

/**
 * The node whose name a settings row's pill shows: the nearest node on the selected node's ancestor
 * chain that owns a declared value for the row, else the setting's flat home. This reconciles two
 * tables, because the registry models 5 keys while the drawer renders 17 - a registry-modelled row
 * resolves through the chain, where an existing OPEN override outranks the home, and every other row
 * answers with its SETTING_HOMES node. The three sentinel homes belong to no view type and yield
 * undefined.
 */
export function owningNodeFor(node_id: string, key: SettingsCascadeKey, registry: ViewRegistry = VIEW_REGISTRY): string | undefined {
    const home = SETTING_HOMES[key].node;
    if (isSentinelNode(home)) { return undefined; }
    const structural_key = STRUCTURAL_SETTING_KEYS[key];
    if (structural_key === undefined) { return home; }
    const resolution = resolveSettingIn(registry, node_id, structural_key);
    return resolution.open_at ?? resolution.home ?? home;
}

/**
 * True when changing this row from the selected node departs from a value an ancestor owns, which is
 * when the drawer offers "Save as a new view type". The pill and the offer are one question asked twice:
 * the offer fires when the pill names a STRICT ancestor of the selected node, so no per-setting list is
 * needed - a row the node owns itself (kanban's column order) and a row with no owning type at all (a
 * global) both fall out as false.
 *
 * Root is the one ancestor that does not offer. Its settings are the generic ones that reach every view,
 * so changing one says nothing about what kind of board this is: "Kanban with linetags" is a preference
 * someone has expressed, not a view type worth minting. That is a structural exemption for one node
 * rather than a list of settings, so the rule still needs no per-setting knowledge.
 */
export function offersNewViewType(selected_node: string, key: SettingsCascadeKey, registry: ViewRegistry = VIEW_REGISTRY): boolean {
    const owner = owningNodeFor(selected_node, key, registry);
    if (owner === undefined || owner === ROOT_NODE) { return false; }
    return isDescendantOf(selected_node, owner, registry);
}

/** true when a saved view type can become a node: it names a label, a fresh id and a parent that exists */
function isUsableUserViewType(user_type: UserViewType, nodes: ViewNode[]): boolean {
    if (!user_type || typeof user_type.id !== 'string' || user_type.id.length === 0) { return false; }
    if (typeof user_type.label !== 'string' || user_type.label.length === 0) { return false; }
    if (nodes.some(n => n.id === user_type.id)) { return false; }
    return nodes.some(n => n.id === user_type.parent);
}

/**
 * The OPEN registry overrides a saved view type contributes, one per setting key it declares, keyed by
 * the structural setting each one forks. No config_path: a minted type does not fork to a config key of
 * its own, it writes through the same path its parent's row already writes.
 */
function userTypeOverrides(user_type: UserViewType): ViewSettingOverride[] {
    const declared = user_type.overrides;
    if (typeof declared !== 'object' || declared === null) { return []; }
    return Object.entries(declared).map(([key, value]) => ({
        node: user_type.id,
        key: structuralKeyFor(key),
        mode: 'open' as const,
        value,
    }));
}

/**
 * The saved list with one type renamed. The id is deliberately untouched: it is the name every setting
 * saved against this type is stored under on the user's disk, so rewriting it would orphan them. What the
 * tree shows and what the type is called on disk are two different names, and only the first is editable.
 */
export function renameUserViewType(user_types: UserViewType[], id: string, label: string): UserViewType[] {
    const trimmed = label.trim();
    if (trimmed.length === 0) { return user_types; }
    return user_types.map(type => (type.id === id ? { ...type, label: trimmed } : type));
}

/**
 * The saved list with one type removed, along with any type saved on top of it - a minted type is a real
 * parent, so dropping one without its descendants would leave them pointing at a node the registry no
 * longer builds, and `registryWithUserTypes` would silently discard them anyway.
 */
export function removeUserViewType(user_types: UserViewType[], id: string): UserViewType[] {
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const type of user_types) {
            if (!doomed.has(type.id) && doomed.has(type.parent)) {
                doomed.add(type.id);
                grew = true;
            }
        }
    }
    return user_types.filter(type => !doomed.has(type.id));
}

/**
 * A registry with the user's saved view types merged in as real nodes under their parents: concrete,
 * selectable and configurable, so a minted type appears in the tree, carries a radio and is selectable
 * exactly like a built-in. Each declared override becomes an OPEN override on the minted node, so
 * resolveSetting answers for it and the row it was saved from stops offering to mint the same type
 * twice.
 *
 * Pure - the built-in registry is never mutated. The input comes from a user's settings.json and is
 * therefore untrusted, so an entry missing a label, reusing an id or naming an unknown parent is skipped
 * rather than thrown on. Entries fold in order, so a type may parent on one declared before it.
 */
export function registryWithUserTypes(user_types: UserViewType[], registry: ViewRegistry = VIEW_REGISTRY): ViewRegistry {
    const nodes = [...registry.nodes];
    const overrides = [...registry.overrides];
    for (const user_type of Array.isArray(user_types) ? user_types : []) {
        if (!isUsableUserViewType(user_type, nodes)) {
            debug('skipping malformed user view type %O', user_type);
            continue;
        }
        nodes.push({
            id: user_type.id,
            parent: user_type.parent,
            kind: 'concrete',
            selectable: true,
            configurable: true,
            label: user_type.label,
        });
        overrides.push(...userTypeOverrides(user_type));
    }
    return { nodes, settings: [...registry.settings], overrides };
}

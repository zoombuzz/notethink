import Debug from "debug";
import { DEFAULT_CARD_RATIO, DEFAULT_LINE_BREADTH } from "../components/views/kanban/columnwidthops";
import { GROUP_ORDER_DEFAULT } from "./grouporderops";
import { AGENT_CLOCK_MODE_DEFAULT } from "./agentactivityops";
import type { GroupDisplayEntry, ResolvedSettingsCascade, SettingsCascadeKey, SettingsCascadePayload, UserViewType } from "../types/Messages";

const debug = Debug("nodejs:notethink-views:viewregistryops");

/*
 * Mirrors of client/extension/src/constants.ts' folder-mode filter defaults and grouped-rung group
 * order, needed here for SETTING_HOMES' per-key defaults. notethink-views is a nested package with its
 * own build and no module graph reaching outside it, so these three values are the same deliberate
 * mirror as the rest of SETTING_HOMES, not an import of the outer webview app's own constants.ts.
 */
const DEFAULT_INCLUDE_FILTER = '**/*.md';
const DEFAULT_EXCLUDE_FILTER = '**/{node_modules,notegit/nodejs,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage,.venv,__pycache__,vendored}/**';
const DEFAULT_GROUP_DISPLAY: GroupDisplayEntry[] = ['untagged', 'doing', 'code-review', 'testing', 'done'].map(value => ({ value, shown: true }));

/*
 * The view hierarchy as data. The dimensional ladder - root -> {document, grouped}; grouped -> {line,
 * grid(future), cube(future)}; line -> {kanban} - lives here as one declarative registry: every node's
 * parent, kind, label, selectability and configurability. Every part of the view programme (the
 * selector, line->kanban parentage, a group-by owned by a shared ancestor) is a query against this
 * registry rather than logic re-derived in three places.
 *
 * The settings model has three concerns and one engine, `resolveViewSetting` below:
 *  - storage: every setting has ONE home node where it is declared (SETTING_HOMES); a view's own entry
 *    in the `views` bag the extension sends on the wire holds every value that node sets for itself,
 *    whether the key's home is that node or one above it - a built-in node's entry and a saved type's
 *    entry are the same shape, keyed the same way
 *  - resolution: a node's effective value for a key is the nearest node on its chain, from itself up to
 *    and including the key's home, whose own bag sets the key, else the key's generic built-in default;
 *    a built-in node may also carry a BUILT-IN bag value of its own (Kanban's `groupBy: 'status'`),
 *    which sits beneath anything stored but above a plain ancestor's value
 *  - the runtime per-session viewState -> extension cascade -> built-in default layering (composerops)
 *    sits UNDER the home's own value and is not modelled here
 *
 * Abstract nodes (root, grouped) own settings but do not render; concrete nodes (document, line, kanban)
 * render. `line` is the single-axis card-group view; `kanban` is `line` preset to status plus chrome.
 * grid/cube are future rungs the model accommodates but this file does not build.
 */

export type ViewNodeKind = 'abstract' | 'concrete';

/**
 * A node in the view hierarchy.
 * - parent: the node id above this one; undefined for root
 * - kind: 'abstract' nodes own settings but are not rendered; 'concrete' nodes render
 * - selectable: whether the user may switch the board to this view (abstract nodes and future rungs are false)
 * - configurable: whether this node owns settings worth showing, so the tree offers it for selection-of-settings
 *   even when it cannot render; the two marks are independent, and root and grouped carry only the second.
 *   Optional so the card registry's nodes - which carry no abstract/rendering distinction at all - are
 *   structurally a `ViewNode[]` too, letting the chain and resolution engine below serve both trees.
 * - label: display base for the selector / drawer (l10n capitalisation is applied by viewTypeLabel)
 */
export interface ViewNode {
    id: string;
    parent?: string;
    kind: ViewNodeKind;
    selectable: boolean;
    configurable?: boolean;
    label: string;
}

export interface ViewRegistry {
    nodes: ViewNode[];
}

/*
 * Owning-node sentinels for settings that belong to no view type: NODE_GLOBAL renders under the settings
 * drawer's "Global settings" heading with no owning-type pill, and NODE_FILES belongs to the Files drawer
 * and the view drawer never lists it. Mirrored from settings.ts alongside SETTING_HOMES below.
 */
export const NODE_GLOBAL = 'global';
export const NODE_FILES = 'files';

// the tree's root: it owns the settings every view inherits, so changing one offers no new type
export const ROOT_NODE = 'root';

/** which of the two bags a setting's own value lives in; the two flat sentinel homes (global, files) live in neither */
export type SettingsBag = 'views' | 'cards';

/**
 * Where each setting lives and what it falls back to with nothing stored anywhere, mirrored from
 * `CASCADE_KEY_DEFAULTS` in client/extension/src/lib/settings.ts.
 *
 * The extension host and the webview are separate webpack bundles with no shared module graph, so there
 * is no import path from here to that table - this is the same deliberate mirror as the folder-view
 * defaults duplicated in the two `constants.ts` files, and the contract is that the shared subset agrees.
 *
 * ADDING A KEY TO `SettingsCascadeKey` WITHOUT A HOME HERE IS A COMPILE ERROR. That is the whole point
 * of the `satisfies Record<SettingsCascadeKey, ...>` below: a caller counting or grouping the settings a
 * node owns can treat this table as complete for every key on the wire, because an incomplete one does
 * not build.
 * - node: the owning tree node - a view-registry id, a card-registry id, or one of the sentinels above
 * - bag: which bag the node's own value for this key lives in; undefined for the two flat sentinel homes
 * - default: the generic built-in default, used when nothing anywhere holds a value for this key
 */
export const SETTING_HOMES: Record<SettingsCascadeKey, { node: string; bag: SettingsBag | undefined; default: unknown }> = {
    viewType:                   { node: 'root',      bag: 'views', default: 'auto' },
    cardType:                   { node: 'allcards',  bag: 'cards', default: 'auto' },
    showLinetagsInHeadlines:    { node: 'allcards',  bag: 'cards', default: false },
    scrollNoteIntoView:         { node: 'root',      bag: 'views', default: true },
    autoExpandFocusedNote:      { node: 'allcards',  bag: 'cards', default: false },
    showLineNumbers:            { node: 'allcards',  bag: 'cards', default: false },
    groupBy:                    { node: 'grouped',   bag: 'views', default: 'auto' },
    orientation:                { node: 'line',      bag: 'views', default: 'columns' },
    lineBreadth:                { node: 'line',      bag: 'views', default: DEFAULT_LINE_BREADTH },
    groupDisplay:                { node: 'grouped',   bag: 'views', default: DEFAULT_GROUP_DISPLAY },
    groupOrder:                 { node: 'grouped',   bag: 'views', default: GROUP_ORDER_DEFAULT },
    cardRatio:                  { node: 'kanban',    bag: 'views', default: DEFAULT_CARD_RATIO },
    animateTransitions:         { node: 'kanban',    bag: 'views', default: true },
    defaultCardType:            { node: 'kanban',    bag: 'views', default: 'card' },
    clockMode:                  { node: 'agent',     bag: 'cards', default: AGENT_CLOCK_MODE_DEFAULT },
    watchUnopenedFilesInViewer: { node: NODE_GLOBAL, bag: undefined, default: true },
    openNewEditorIfNoneOpen:    { node: NODE_GLOBAL, bag: undefined, default: false },
    includeFilter:              { node: NODE_FILES,  bag: undefined, default: DEFAULT_INCLUDE_FILTER },
    excludeFilter:              { node: NODE_FILES,  bag: undefined, default: DEFAULT_EXCLUDE_FILTER },
    maxNotesPerFile:            { node: NODE_FILES,  bag: undefined, default: 10 },
};

/**
 * A built-in node's own value for a key, with no stored entry at all - Kanban's Group by defaults to
 * status rather than the generic `auto`, which is what makes a kanban board a kanban rather than merely
 * a line view preset to it. Checked ahead of a stored value in `ownBagFor` (stored still wins) and ahead
 * of plain parent inheritance in `inheritedViewSetting` (a node's own built-in value is not something it
 * inherits, so setting it back to status clears the stored entry rather than merely matching Line's).
 * Nothing besides Kanban's group axis needs one today; the table stays open for the next one.
 */
const BUILTIN_NODE_DEFAULTS: Partial<Record<string, Partial<Record<SettingsCascadeKey, unknown>>>> = {
    kanban: { groupBy: 'status' },
};

function builtinNodeDefault(node_id: string, key: SettingsCascadeKey): unknown {
    return BUILTIN_NODE_DEFAULTS[node_id]?.[key];
}

/**
 * True for every setting a view node can genuinely hold its own value for - every key whose home is a
 * real node in the (built-in) view tree, `viewType` excepted, since that is the selection itself rather
 * than a value a view holds. This is every row the view settings drawer renders except the two
 * NODE_GLOBAL ones (which stay global, with no per-view divergence at all).
 */
/**
 * True for every setting a node on `registry` can genuinely hold its own value for: its home is a real
 * node on that tree, and the key is not `selection_key` - the tree's own selection (`viewType` for the
 * view tree, `cardType` for the card tree), which is the choice of node itself rather than a value any
 * node holds. Generic over which tree so both `isPerViewKey` and the card tree's own predicate are one
 * function with two callers, not two copies.
 */
export function isPerTreeKey(key: SettingsCascadeKey, registry: ViewRegistry, selection_key: SettingsCascadeKey): boolean {
    if (key === selection_key) { return false; }
    return getViewNode(SETTING_HOMES[key].node, registry) !== undefined;
}

export function isPerViewKey(key: SettingsCascadeKey): boolean {
    return isPerTreeKey(key, VIEW_REGISTRY, 'viewType');
}

/*
 * The dimensional ladder. Every node owns settings and is configurable; only concrete rungs are
 * selectable. `kanban`'s own values for the per-view keys above - its group axis included - live in its
 * own entry in the `views` bag the extension assembles on the wire, resolved by `resolveViewSetting`
 * exactly like a saved type's own entry; there is no structural pin left in the registry itself.
 */
export const VIEW_REGISTRY: ViewRegistry = {
    nodes: [
        { id: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Root' },
        { id: 'document', parent: 'root', kind: 'concrete', selectable: true, configurable: true, label: 'Document' },
        { id: 'grouped', parent: 'root', kind: 'abstract', selectable: false, configurable: true, label: 'Grouped' },
        { id: 'line', parent: 'grouped', kind: 'concrete', selectable: true, configurable: true, label: 'Line' },
        { id: 'kanban', parent: 'line', kind: 'concrete', selectable: true, configurable: true, label: 'Kanban' },
    ],
};

// every id the registry declares, which is what tells a saved type's bag entry apart from a built-in's
const BUILTIN_VIEW_IDS = new Set(VIEW_REGISTRY.nodes.map(n => n.id));

/** the node record for an id in the given registry (defaults to the built-in VIEW_REGISTRY) */
export function getViewNode(id: string, registry: ViewRegistry = VIEW_REGISTRY): ViewNode | undefined {
    return registry.nodes.find(n => n.id === id);
}

/**
 * The ancestor chain for a node, deepest-first: the node itself, then its parent, up to the root. An
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
 * True when a view renders groups (it sits under `grouped`): line and kanban today. Drives the settings
 * drawer's per-view dispatch (group drawer vs document drawer) without a hardcoded `type ===` list.
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

/** true for a setting home naming no view type, so its row renders no pill and never offers a new type */
function isSentinelNode(node_id: string): boolean {
    return node_id === NODE_GLOBAL || node_id === NODE_FILES;
}

/** true when a saved view type can become a node: it names a label, a fresh id and a parent that exists */
function isUsableUserViewType(user_type: UserViewType, nodes: ViewNode[]): boolean {
    if (!user_type || typeof user_type.id !== 'string' || user_type.id.length === 0) { return false; }
    if (typeof user_type.label !== 'string' || user_type.label.length === 0) { return false; }
    if (nodes.some(n => n.id === user_type.id)) { return false; }
    return nodes.some(n => n.id === user_type.parent);
}

/**
 * The overrides a saved type declares, keyed by cascade key exactly as the drawer wrote them. The list
 * comes from a user's settings.json and is untrusted, so an entry carrying anything but an object reads
 * as declaring nothing rather than throwing.
 */
function declaredOverrides(user_type: UserViewType | undefined): Record<string, unknown> {
    const declared = user_type?.overrides;
    if (typeof declared !== 'object' || declared === null) { return {}; }
    return declared;
}

/**
 * True when a saved type declares its own value for `key` - unchanged by the per-view bag, since a
 * saved type's own bag is always its `overrides`, never a built-in node's own entry.
 */
export function userTypeHoldsKey(user_type: UserViewType | undefined, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(declaredOverrides(user_type), key);
}

/**
 * The per-view bag, `views` on the wire: one entry per node id (a built-in view or a saved type), holding
 * every value that node sets for itself, whatever its key's home. Assembled from each node's own declared
 * `notethink.settings.*` key, then resolved and merged across the Workspace/User scopes on the extension
 * side (client/extension/src/lib/settings.ts); the webview only ever sees the merged result. A saved
 * type's entry also carries `parent` and `label`; `ownBagFor` strips them off before a caller sees the
 * override keys alone.
 *
 * Named `ViewOverridesMap` rather than `ViewsBag` because it still serves the one other shape the rest of
 * the webview expects to find a built-in node's own values under (`ResolvedSettingsCascade.viewOverrides`,
 * built by `builtinViewOverridesFromViews` below) - the same shape, the same name, now also doubling as
 * the raw per-node bag.
 */
export type ViewOverridesMap = Record<string, Record<string, unknown>>;

/**
 * A node's own STORED bag of per-view values: a saved type's declared overrides, or a built-in node's
 * bag entry exactly as written - no built-in default folded in. Tells a row's pill apart from its
 * resolved value: a key this returns nothing for is never "specific to this node", whatever `ownBagFor`
 * (below) resolves it to from a built-in default.
 */
export function storedBagFor(node_id: string, user_types: UserViewType[], view_overrides: ViewOverridesMap): Record<string, unknown> {
    const user_type = user_types.find(t => t.id === node_id);
    if (user_type !== undefined) { return declaredOverrides(user_type); }
    return view_overrides[node_id] ?? {};
}

/** true when `node_id` genuinely stores its own value for `key` - a built-in default alone does not count */
function hasStoredValue(node_id: string, key: SettingsCascadeKey, user_types: UserViewType[], view_overrides: ViewOverridesMap): boolean {
    return Object.prototype.hasOwnProperty.call(storedBagFor(node_id, user_types, view_overrides), key);
}

/**
 * A node's own bag of per-view values for RESOLUTION: the stored bag (above) with the node's own
 * built-in default (if any) sitting beneath whatever is actually stored.
 */
export function ownBagFor(node_id: string, user_types: UserViewType[], view_overrides: ViewOverridesMap): Record<string, unknown> {
    const stored = storedBagFor(node_id, user_types, view_overrides);
    if (user_types.some(t => t.id === node_id)) { return stored; }
    const builtin_defaults = BUILTIN_NODE_DEFAULTS[node_id] ?? {};
    return { ...builtin_defaults, ...stored };
}

/**
 * ViewSettingResolution, the answer the engine returns for "what does setting K look like at node N".
 * - value: the resolved value
 * - owner: the view whose own bag the value came from, else the setting's home
 */
export interface ViewSettingResolution {
    value: unknown;
    owner: string;
}

/**
 * The one engine a node's effective value for a per-view-capable key resolves through: the nearest node
 * strictly between `node_id` and the key's home (itself included) whose own bag sets the key - a saved
 * type's declared overrides, or a built-in node's own bag entry, a built-in default included - else
 * `home_value`, the value already stored at the key's home. Used by the render path (composerops /
 * GenericView, for the rendered view) and by the drawer (for whichever node the user has selected), so
 * a pill, a dropdown's "(inherited)" label and the rendered board can never disagree about the answer.
 *
 * `home_value` is the caller's responsibility: it is simply the flat cascade value already read for this
 * key (the value stored at its home, defaulted exactly as every other setting is), since this file has no
 * access to the cascade.
 */
export function resolveViewSetting(
    registry: ViewRegistry,
    node_id: string,
    key: SettingsCascadeKey,
    home_value: unknown,
    user_types: UserViewType[] = [],
    view_overrides: ViewOverridesMap = {},
): ViewSettingResolution {
    const home = SETTING_HOMES[key].node;
    const chain = chainOf(node_id, registry);
    const home_index = chain.indexOf(home);
    const below_home = home_index === -1 ? chain : chain.slice(0, home_index);
    for (const candidate of below_home) {
        const bag = ownBagFor(candidate, user_types, view_overrides);
        if (Object.prototype.hasOwnProperty.call(bag, key)) { return { value: bag[key], owner: candidate }; }
    }
    return { value: home_value, owner: home };
}

/**
 * The value `node_id` would fall back to if it held no STORED value of its own for `key` - resolved
 * from `node_id`'s own built-in default when it has one (Kanban's status), else its PARENT's chain,
 * skipping the node's own bag. This is what an edit compares a new value against to decide whether to
 * clear the node's own value instead of setting it (`settingWriteFor`), what the "specific" pill's hover
 * names as the view it would inherit from again, and what a dropdown's "(inherited)" option label
 * matches against.
 *
 * A node's own built-in default is checked first, ahead of its parent, because it is not something the
 * node inherits: Kanban shows status with nothing stored at all, whatever Grouped's own group-by value
 * is, so setting Kanban's own value back to status must clear Kanban's stored entry rather than compare
 * it against Line's or Grouped's.
 */
export function inheritedViewSetting(
    registry: ViewRegistry,
    node_id: string,
    key: SettingsCascadeKey,
    home_value: unknown,
    user_types: UserViewType[] = [],
    view_overrides: ViewOverridesMap = {},
): ViewSettingResolution {
    const builtin_default = builtinNodeDefault(node_id, key);
    if (builtin_default !== undefined) { return { value: builtin_default, owner: node_id }; }
    const parent_id = getViewNode(node_id, registry)?.parent;
    if (parent_id === undefined) { return { value: home_value, owner: SETTING_HOMES[key].node }; }
    return resolveViewSetting(registry, parent_id, key, home_value, user_types, view_overrides);
}

/** structural equality for a resolved setting value: scalars by `===`, arrays and plain objects element/key-wise */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function viewSettingValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) { return true; }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, index) => viewSettingValuesEqual(item, b[index]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const a_keys = Object.keys(a);
        const b_keys = Object.keys(b);
        return a_keys.length === b_keys.length && a_keys.every(k => viewSettingValuesEqual(a[k], b[k]));
    }
    return false;
}

/**
 * The node whose own value a settings row's pill and owner label name: the nearest node on the selected
 * node's chain that owns a value for the key (a saved type's own override, or a built-in view's own bag
 * entry), else the key's flat home. One call reaches the same answer `resolveViewSetting` does, so the
 * owner label and the live render can never disagree.
 */
export function owningNodeFor(
    node_id: string,
    key: SettingsCascadeKey,
    registry: ViewRegistry = VIEW_REGISTRY,
    user_types: UserViewType[] = [],
    view_overrides: ViewOverridesMap = {},
): string | undefined {
    const home = SETTING_HOMES[key].node;
    if (isSentinelNode(home)) { return undefined; }
    return resolveViewSetting(registry, node_id, key, undefined, user_types, view_overrides).owner;
}

/**
 * The entry in the cascade's `diverged` list that answers for a row's M, given WHICH node actually owns
 * the resolved value - `<bag>:<node_id>:<key>`, exactly as `client/extension/src/lib/settings.ts`'s
 * `bagDivergedKeys` publishes it for every node's own cell, the setting's home node included: a per-tree
 * key has no separate flat storage anywhere, even at its home, so there is no bare-key form to match.
 * M therefore always describes the value the row actually shows, never the selected node's own
 * divergence when it is only inheriting. `bag` is the tree's own bag name (`'views'` or `'cards'`).
 */
export function divergedKeyFor(owner: string, key: SettingsCascadeKey, bag: 'views' | 'cards'): string {
    return `${bag}:${owner}:${key}`;
}

/**
 * Everything a settings row's control, pill and M marker need for one (selected node, key) pair,
 * resolved once through the one engine above so the two drawers - the view tree's and the card tree's -
 * can never disagree with the live render about what a row shows. Shared rather than duplicated: the two
 * trees differ only in which bag they read (`bag`), whether the key is even per that tree
 * (`is_per_tree_key`), and the tree itself (`registry`); the resolution and pill logic is one function.
 * - ownerId: the node whose own bag the effective value came from, or undefined when the key belongs to
 *   no node on this tree (a sentinel home); the caller turns this into a label for the owner pill
 * - inherited: the value `selectedNode` would show holding nothing of its own; undefined for a
 *   non-per-tree key, which has no such concept
 * - inheritedFromId / specificFromId: which state pill to render, as a node id for the caller to label -
 *   mutually exclusive, and both undefined at the setting's own home, where there is nothing to inherit
 *   from or clear back to
 * - inheritedIsBuiltinDefault: true when `inheritedFromId` names a node supplying the value from its own
 *   `BUILTIN_NODE_DEFAULTS` entry rather than a genuinely stored one (Kanban's Group by, with nothing
 *   saved anywhere) - VS names a value settings.json actually holds, so a built-in default is never VS
 *   even when the resolved owner is the selected node itself; the caller's pill still reads as inherited,
 *   with a hover naming the default rather than an ancestor
 */
export interface ResolvedTreeRow {
    value: unknown;
    inherited: unknown;
    ownerId: string | undefined;
    inheritedFromId: string | undefined;
    inheritedIsBuiltinDefault: boolean;
    specificFromId: string | undefined;
    diverged: boolean;
}

export function resolveTreeRow(
    registry: ViewRegistry,
    bag: 'views' | 'cards',
    is_per_tree_key: boolean,
    selected_node: string,
    key: SettingsCascadeKey,
    home_value: unknown,
    user_types: UserViewType[],
    own_bags: ViewOverridesMap,
    diverged_keys: string[],
): ResolvedTreeRow {
    const home = SETTING_HOMES[key].node;
    const owner_id = isSentinelNode(home) ? undefined : resolveViewSetting(registry, selected_node, key, home_value, user_types, own_bags).owner;
    if (!is_per_tree_key) {
        return { value: home_value, inherited: undefined, ownerId: owner_id, inheritedFromId: undefined, inheritedIsBuiltinDefault: false, specificFromId: undefined, diverged: diverged_keys.includes(key) };
    }
    const resolution = resolveViewSetting(registry, selected_node, key, home_value, user_types, own_bags);
    const diverged = diverged_keys.includes(divergedKeyFor(resolution.owner, key, bag));
    if (selected_node === home) {
        return { value: resolution.value, inherited: undefined, ownerId: resolution.owner, inheritedFromId: undefined, inheritedIsBuiltinDefault: false, specificFromId: undefined, diverged };
    }
    const inherited = inheritedViewSetting(registry, selected_node, key, home_value, user_types, own_bags);
    // VS names a genuinely stored value; a built-in default the owner carries without one reads as inherited
    if (builtinNodeDefault(resolution.owner, key) !== undefined && !hasStoredValue(resolution.owner, key, user_types, own_bags)) {
        return { value: resolution.value, inherited: inherited.value, ownerId: resolution.owner, inheritedFromId: resolution.owner, inheritedIsBuiltinDefault: true, specificFromId: undefined, diverged };
    }
    if (resolution.owner !== selected_node) {
        return { value: resolution.value, inherited: inherited.value, ownerId: resolution.owner, inheritedFromId: resolution.owner, inheritedIsBuiltinDefault: false, specificFromId: undefined, diverged };
    }
    return { value: resolution.value, inherited: inherited.value, ownerId: resolution.owner, inheritedFromId: undefined, inheritedIsBuiltinDefault: false, specificFromId: inherited.owner, diverged };
}

/** every cascade key, in `SETTING_HOMES` declaration order, that `isPerViewKey` accepts */
function perViewKeys(): SettingsCascadeKey[] {
    return (Object.keys(SETTING_HOMES) as SettingsCascadeKey[]).filter(isPerViewKey);
}

/**
 * A settings object with every per-view key replaced by its resolved value for `view_type`'s chain - the
 * group axis, group order/visibility, orientation, group breadth, group-card shape and `scrollNoteIntoView`
 * a rendered view actually uses, including its own value in its `views` bag entry or a saved type's own
 * overrides when it holds one. Every other key (the two NODE_GLOBAL ones, and anything on the card or
 * files tree) is passed through unchanged.
 *
 * This is the ONE resolver for a rendered view: it already folds a saved type's own overrides in (via
 * `ownBagFor`), so there is no second layering mechanism left to agree with. Called once per rendered view
 * (GenericView) and, row by row, by the drawer for whichever node the user has selected there - the same
 * call either way, so a kanban board and the drawer viewing kanban's own row can never disagree about
 * what "auto" resolves to.
 */
export function resolvedSettingsForView(
    registry: ViewRegistry,
    view_type: string,
    settings: Partial<ResolvedSettingsCascade>,
    user_types: UserViewType[],
    view_overrides: ViewOverridesMap,
): Partial<ResolvedSettingsCascade> {
    const resolved: Record<string, unknown> = { ...settings };
    for (const key of perViewKeys()) {
        resolved[key] = resolveViewSetting(registry, view_type, key, settings[key], user_types, view_overrides).value;
    }
    return resolved as Partial<ResolvedSettingsCascade>;
}

/**
 * The one write that carries a setting change to where it takes effect, whichever node is selected on
 * whichever tree:
 * - a key not per-tree there (a global, or a setting on the OTHER tree) writes its flat key
 * - the selected node IS the key's home -> the home's own cell, written literally (never cleared,
 *   exactly as writing a flat key always has)
 * - any other selected node (a saved type, or a node below the home) -> that node's own cell, cleared
 *   instead when the new value equals what the node would show holding nothing of its own
 *   (`inheritedViewSetting`, which already knows about a node's own built-in default)
 *
 * The result for a per-tree key is always a single-cell `bag` delta: storage no longer distinguishes a
 * built-in node's own entry from a saved type's, so there is nothing left here to branch on beyond "is
 * this the home". Shared by `settingWriteFor` (views) and the card tree's own write helper - the two
 * trees differ only in which bag they write and which key is per that tree, both supplied by the caller.
 */
export function writeForTree(
    registry: ViewRegistry,
    bag: 'views' | 'cards',
    is_per_tree_key: boolean,
    user_types: UserViewType[],
    own_bags: ViewOverridesMap,
    selected_node: string,
    key: SettingsCascadeKey,
    value: unknown,
    home_value: unknown,
): { setting: SettingsCascadeKey | 'views' | 'cards'; value: unknown } {
    if (!is_per_tree_key) { return { setting: key, value }; }
    const home = SETTING_HOMES[key].node;
    if (selected_node === home) {
        return { setting: bag, value: { sets: [{ node_id: selected_node, key, value }] } };
    }
    const inherited = inheritedViewSetting(registry, selected_node, key, home_value, user_types, own_bags).value;
    const write_value = viewSettingValuesEqual(value, inherited) ? undefined : value;
    return { setting: bag, value: { sets: [{ node_id: selected_node, key, value: write_value }] } };
}

export function settingWriteFor(
    registry: ViewRegistry,
    user_types: UserViewType[],
    view_overrides: ViewOverridesMap,
    selected_node: string,
    key: SettingsCascadeKey,
    value: unknown,
    home_value: unknown,
): { setting: SettingsCascadeKey | 'views'; value: unknown } {
    return writeForTree(registry, 'views', isPerViewKey(key), user_types, view_overrides, selected_node, key, value, home_value) as { setting: SettingsCascadeKey | 'views'; value: unknown };
}

/**
 * The saved list with one type's overrides merged with `overrides`: a key already held takes the new
 * value, a key it has never held is added, and every other key it holds is left alone. The id, label and
 * parent are untouched, so an update can neither re-home a type nor orphan the settings on a user's disk
 * stored under its id. Pure array transform used only to compute what a multi-key drawer write (minting a
 * type, a combined group-order drag) is about to mint or send; the write itself always goes through a
 * `views` bag delta, never this whole-array shape.
 */
export function updateUserViewTypeOverrides(user_types: UserViewType[], id: string, overrides: Record<string, unknown>): UserViewType[] {
    return user_types.map(type => (
        type.id === id ? { ...type, overrides: { ...declaredOverrides(type), ...overrides } } : type
    ));
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
 * The ids a saved type's removal doomed: the type itself, plus any type saved on top of it - a minted
 * type is a real parent, so dropping one without its descendants would leave them pointing at a node the
 * registry no longer builds. Used to build the one multi-cell `views` delta that deletes every doomed
 * entry together.
 */
export function doomedUserTypeIds(user_types: UserViewType[], id: string): string[] {
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
    return [...doomed];
}

/**
 * A registry with the user's saved view types merged in as real nodes under their parents: concrete,
 * selectable and configurable, so a minted type appears in the tree, carries a radio and is selectable
 * exactly like a built-in.
 *
 * Pure - the built-in registry is never mutated. The input comes from a user's settings.json and is
 * therefore untrusted, so an entry missing a label, reusing an id or naming an unknown parent is skipped
 * rather than thrown on. Entries fold in order, so a type may parent on one declared before it.
 */
export function registryWithUserTypes(user_types: UserViewType[], registry: ViewRegistry = VIEW_REGISTRY): ViewRegistry {
    const nodes = [...registry.nodes];
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
    }
    return { nodes };
}

/**
 * The settings a tree node owns, in SETTING_HOMES declaration order. Pass a settings payload to narrow
 * the answer to the keys that payload actually carries, so a node's count reflects what the drawer can
 * show rather than what the mirror declares; omit it to count every declared setting.
 */
export function settingKeysForNode(node_id: string, settings?: Partial<ResolvedSettingsCascade>): SettingsCascadeKey[] {
    const keys = Object.keys(SETTING_HOMES) as SettingsCascadeKey[];
    return keys.filter(key => SETTING_HOMES[key].node === node_id && (settings === undefined || key in settings));
}

/** how many settings a node owns; the count the settings tree renders beside each node label */
export function nodeSettingCount(node_id: string, settings?: Partial<ResolvedSettingsCascade>): number {
    return settingKeysForNode(node_id, settings).length;
}

/**
 * The saved view types carried in the `views` bag: every entry whose id is not a built-in node, with a
 * declared `parent` and `label` - what tells a saved type's entry apart from a built-in node's own. A
 * malformed entry (missing either field) reads as none, the same way `registryWithUserTypes` treats one
 * that cannot become a node.
 */
export function userViewTypesFromViews(views: ViewOverridesMap): UserViewType[] {
    const result: UserViewType[] = [];
    for (const [id, bag] of Object.entries(views ?? {})) {
        if (BUILTIN_VIEW_IDS.has(id)) { continue; }
        if (typeof bag?.parent !== 'string' || typeof bag?.label !== 'string') { continue; }
        const { parent, label, ...overrides } = bag;
        result.push({ id, label, parent, overrides });
    }
    return result;
}

/**
 * The built-in views' own bag entries, narrowed out of the `views` bag - the
 * `ResolvedSettingsCascade.viewOverrides` shape the rest of the webview reads, now simply the subset of
 * `views` keyed by a registry id rather than a saved type's. Entries holding nothing are left out.
 */
export function builtinViewOverridesFromViews(views: ViewOverridesMap): ViewOverridesMap {
    const result: ViewOverridesMap = {};
    for (const id of BUILTIN_VIEW_IDS) {
        const bag = views?.[id];
        if (bag && Object.keys(bag).length > 0) { result[id] = bag; }
    }
    return result;
}

/**
 * Unpacks the wire `SettingsCascadePayload` (the `views` / `cards` bags, the five flat settings, and the
 * three divergence aggregates) into the flat `ResolvedSettingsCascade` every view, drawer and composer
 * reads: one field per cascade key, read off its own home node in its own bag and defaulted exactly like
 * any other setting, plus `viewUserTypes` / `viewOverrides` derived from the `views` bag for the readers
 * that predate the bag storage model. The one place this translation happens; nothing downstream of
 * `buildViewDisplayOptions` (composerops.ts) ever reads `views` or `cards` directly.
 */
export function resolvedSettingsFromCascade(wire: Partial<SettingsCascadePayload> | undefined): ResolvedSettingsCascade {
    const views: ViewOverridesMap = wire?.views ?? {};
    const cards: ViewOverridesMap = wire?.cards ?? {};
    const resolved: Record<string, unknown> = {};
    for (const key of Object.keys(SETTING_HOMES) as SettingsCascadeKey[]) {
        const def = SETTING_HOMES[key];
        if (def.bag === 'views') { resolved[key] = views[def.node]?.[key] ?? def.default; }
        else if (def.bag === 'cards') { resolved[key] = cards[def.node]?.[key] ?? def.default; }
        else { resolved[key] = (wire as Record<string, unknown> | undefined)?.[key] ?? def.default; }
    }
    resolved.viewUserTypes = userViewTypesFromViews(views);
    resolved.viewOverrides = builtinViewOverridesFromViews(views);
    // the whole cards bag, unfiltered: every entry is a built-in card node's own bag, there being no saved card types
    resolved.cardOverrides = cards;
    resolved.diverged = wire?.diverged ?? [];
    resolved.hasWorkspaceOverrides = wire?.hasWorkspaceOverrides ?? false;
    resolved.hasAnyOverrides = wire?.hasAnyOverrides ?? false;
    return resolved as unknown as ResolvedSettingsCascade;
}

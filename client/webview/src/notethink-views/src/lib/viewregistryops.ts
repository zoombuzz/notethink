import Debug from "debug";

const debug = Debug("nodejs:notethink-views:viewregistryops");

/*
 * The view hierarchy as data. The dimensional ladder - root -> {document, grouped}; grouped -> {line,
 * grid(future), cube(future)}; line -> {kanban} - lives here as one declarative registry: every node's
 * parent, kind, label and selectability, plus the settings model layered on top. Every part of the view
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
 * - kind: 'abstract' nodes own settings but are not rendered/selectable; 'concrete' nodes render
 * - selectable: whether the user may choose this view (abstract nodes and future rungs are false)
 * - label: display base for the selector / drawer (l10n capitalisation is applied by viewTypeLabel)
 */
export interface ViewNode {
    id: string;
    parent?: string;
    kind: ViewNodeKind;
    selectable: boolean;
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
 *   nearest selectable ancestor that does not itself fix it (the unlocking view)
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
 * - unlock_view: the selectable ancestor that unlocks a fixed setting (edit K by selecting that view)
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

// group order home + config path, blessed 2026-07-17; grouped shares one order, kanban keeps its own columnOrder path
const GROUPED_GROUP_ORDER_PATH = 'view.specific.grouped.groupOrder';
const KANBAN_COLUMN_ORDER_PATH = 'view.specific.kanban.columnOrder';

/*
 * the dimensional ladder plus the settings homes and overrides. `axes` (the ordered group keys) and
 * `groupOrder` (the per-axis lane order) home at grouped; `orientation` homes at line; the generic
 * settings and the view selection home at root. kanban FIXES axes[0] to status (edit by selecting Line)
 * and holds its own OPEN group order at the existing kanban columnOrder path (no shipped key migrates).
 */
export const VIEW_REGISTRY: ViewRegistry = {
    nodes: [
        { id: 'root', kind: 'abstract', selectable: false, label: 'Root' },
        { id: 'document', parent: 'root', kind: 'concrete', selectable: true, label: 'Document' },
        { id: 'grouped', parent: 'root', kind: 'abstract', selectable: false, label: 'Grouped' },
        { id: 'line', parent: 'grouped', kind: 'concrete', selectable: true, label: 'Line' },
        { id: 'kanban', parent: 'line', kind: 'concrete', selectable: true, label: 'Kanban' },
    ],
    settings: [
        { key: 'viewType', home: 'root', default: 'auto', config_path: 'view.type' },
        { key: 'axes', home: 'grouped', default: undefined },
        { key: 'groupOrder', home: 'grouped', default: [], config_path: GROUPED_GROUP_ORDER_PATH },
        { key: 'orientation', home: 'line', default: 'columns' },
    ],
    overrides: [
        { node: 'kanban', key: 'axes', mode: 'fixed', value: ['status'] },
        { node: 'kanban', key: 'groupOrder', mode: 'open', value: undefined, config_path: KANBAN_COLUMN_ORDER_PATH },
    ],
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

/** the nearest override for `key` walking `chain` deepest-first, or undefined when none is on the chain */
function nearestOverrideOnChain(chain: string[], key: string, registry: ViewRegistry): ViewSettingOverride | undefined {
    for (const node_id of chain) {
        const override = registry.overrides.find(o => o.node === node_id && o.key === key);
        if (override) { return override; }
    }
    return undefined;
}

/**
 * the selectable ancestor that unlocks a fixed setting: the nearest node strictly above the fixing node
 * that is selectable and does not itself fix the key. undefined when nothing above can edit it.
 */
function unlockingViewOnChain(chain: string[], fixed_at: string, key: string, registry: ViewRegistry): string | undefined {
    const start = chain.indexOf(fixed_at) + 1;
    for (let i = start; i < chain.length; i++) {
        const node_id = chain[i];
        const node = getViewNode(node_id, registry);
        const fixes_here = registry.overrides.some(o => o.node === node_id && o.key === key && o.mode === 'fixed');
        if (node?.selectable && !fixes_here) { return node_id; }
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

/** true when `key` is fixed (pinned read-only) for the given node */
export function isSettingFixed(node_id: string, key: string): boolean {
    return resolveSetting(node_id, key).fixed;
}

/** the selectable ancestor that unlocks `key` for the given node, or undefined when it is not fixed */
export function unlockingViewFor(node_id: string, key: string): string | undefined {
    debug('unlockingViewFor %s.%s', node_id, key);
    return resolveSetting(node_id, key).unlock_view;
}

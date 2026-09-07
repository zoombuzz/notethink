import { lazy } from "react";
import type { ComponentType } from "react";
import Debug from "debug";
import { SETTING_HOMES, chainOf, registryWithUserTypes } from "../../lib/viewregistryops";
import type { SettingsCascadeKey, UserViewType } from "../../types/Messages";
import type { NoteProps } from "../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:cardregistryops");

/*
 * The card hierarchy as data, the orthogonal axis to the view registry. A view decides how notes are
 * laid out; a card decides how one note is drawn - the full card (pill, title, attributes, body) or a
 * compact summary. The two are chosen independently, so `sticky` cards work in a document just as they
 * do in a kanban lane. The axis covers the notes a view LAYS OUT, not the view's own container: the note
 * a DocumentView opens at holds every note below it in its body, so GenericNote keeps it on the full card
 * whatever is selected.
 *
 * Shaped deliberately like VIEW_REGISTRY rather than as a flat list of ids, because the same three
 * questions get asked of both axes: which entries may the user select, which node owns a setting, and
 * what does this node inherit. `allcards` is the abstract parent that owns the settings every card
 * shares; `card` and `sticky` are the concrete renderers. Adding a card type is one node here plus one
 * line in CARD_COMPONENTS.
 *
 * Each VIEW declares the card type it defaults to, keyed by view-registry node id and resolved up the
 * view tree, so a default set at `root` covers every view and a view that wants its own says so once.
 * That is why the default lives here as data rather than as a switch at the dispatch site.
 */

export type CardNodeKind = 'abstract' | 'concrete';

/**
 * A node in the card hierarchy.
 * - parent: the node id above this one; undefined for the registry root
 * - kind: 'abstract' nodes own settings but do not render; 'concrete' nodes render a note
 * - selectable: whether the user may choose this card type (abstract nodes are false)
 * - label: display base for the selector / drawer (capitalisation is applied by viewTypeLabel)
 */
export interface CardNode {
    id: string;
    parent?: string;
    kind: CardNodeKind;
    selectable: boolean;
    label: string;
}

/**
 * A view's declared default card type, keyed by view-registry node id. Resolved up the VIEW tree, so
 * the declaration at `root` is the fleet default and a deeper view overrides it for itself and its
 * descendants.
 */
export interface CardViewDefault {
    view: string;
    card: string;
}

export interface CardRegistry {
    nodes: CardNode[];
    view_defaults: CardViewDefault[];
}

// the meta-selection: resolve the card from the files or the view default, rather than pin one
export const CARD_AUTO = 'auto';

// the card every view falls back to when nothing else resolves: the full card
export const DEFAULT_CARD_TYPE = 'card';

export const CARD_REGISTRY: CardRegistry = {
    nodes: [
        { id: 'allcards', kind: 'abstract', selectable: false, label: 'All cards' },
        { id: 'card', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Card' },
        { id: 'sticky', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Sticky' },
    ],
    view_defaults: [
        { view: 'root', card: DEFAULT_CARD_TYPE },
        { view: 'kanban', card: DEFAULT_CARD_TYPE },
    ],
};

/*
 * component per concrete card id, keyed by the same ids the card registry declares. dynamic import() is
 * required by React.lazy for per-card code-splitting; static imports would pull every renderer into the
 * initial bundle. `auto` is not a registry node - it is the resolved meta-selection, so it never reaches
 * this map.
 */
export const CARD_COMPONENTS: Record<string, ComponentType<NoteProps>> = {
    card: lazy(() => import('./MarkdownNote')),
    sticky: lazy(() => import('./StickyNote')),
};

/** the node record for a card id in the given registry (defaults to the built-in CARD_REGISTRY) */
export function getCardNode(id: string, registry: CardRegistry = CARD_REGISTRY): CardNode | undefined {
    return registry.nodes.find(n => n.id === id);
}

/**
 * the ancestor chain for a card node, deepest-first: the node itself, then its parent, up to the
 * registry root. An unknown id yields an empty chain. Bounded by the node count so a malformed parent
 * cycle cannot loop.
 */
export function cardChainOf(id: string, registry: CardRegistry = CARD_REGISTRY): string[] {
    const chain: string[] = [];
    let current: string | undefined = id;
    const max_depth = registry.nodes.length;
    while (current !== undefined && chain.length <= max_depth) {
        const node = getCardNode(current, registry);
        if (!node) { break; }
        chain.push(node.id);
        current = node.parent;
    }
    return chain;
}

/** the direct children of a card node in declaration order; pass undefined for the tree's roots */
export function childCardNodes(parent_id: string | undefined, registry: CardRegistry = CARD_REGISTRY): CardNode[] {
    return registry.nodes.filter(n => n.parent === parent_id);
}

/** true when `ancestor` is a strict ancestor of `id` on the card tree */
export function isCardDescendantOf(id: string, ancestor: string, registry: CardRegistry = CARD_REGISTRY): boolean {
    return cardChainOf(id, registry).slice(1).includes(ancestor);
}

/** the registry's own root, whose settings every card inherits; the one owner that offers no new type */
function cardRootNode(registry: CardRegistry): string | undefined {
    return registry.nodes.find(n => n.parent === undefined)?.id;
}

/**
 * The card node whose name a settings row's pill shows. The card axis is a flat home lookup rather than
 * the chain resolution the view axis needs: a card node carries no fixed or open override model, so
 * there is nothing on the chain that could outrank the home. A key homed off this tree - at a view node,
 * or at one of the sentinels - belongs to no card type and yields undefined, so its row renders no pill.
 */
export function owningCardNodeFor(key: SettingsCascadeKey, registry: CardRegistry = CARD_REGISTRY): string | undefined {
    const home = SETTING_HOMES[key].node;
    return getCardNode(home, registry) === undefined ? undefined : home;
}

/**
 * True when changing this row from the selected card node departs from a value an ancestor owns, which
 * is when the drawer would offer "Save as a new card type". The same rule the view axis follows: the
 * offer fires when the pill names a STRICT ancestor of the selected node, and the tree's own root is
 * exempt because its settings reach every card, so changing one is a preference rather than a new type.
 *
 * Nothing calls this yet, and that is the honest state rather than an oversight. Every card setting homes
 * at the root, where the rule is exempt by design, so a card drawer that mounted the offer would mount a
 * control no shipped setting can reach. The predicate is kept and unit-tested because it is the half that
 * is genuinely structural: home one setting at `card` or `sticky` and the answer is already right, and
 * wiring the drawer to it is then the only work left.
 */
export function offersNewCardType(selected_node: string, key: SettingsCascadeKey, registry: CardRegistry = CARD_REGISTRY): boolean {
    const owner = owningCardNodeFor(key, registry);
    if (owner === undefined || owner === cardRootNode(registry)) { return false; }
    return isCardDescendantOf(selected_node, owner, registry);
}

/** the selectable concrete card ids in tree order (card, sticky); the source of the selector list */
export function selectableCardIds(registry: CardRegistry = CARD_REGISTRY): string[] {
    return registry.nodes.filter(n => n.selectable).map(n => n.id);
}

/**
 * the ordered card types the selector offers: `auto` plus every selectable registry card that has a
 * component wired in CARD_COMPONENTS. A registry card declared without a component is not offered, so the
 * card tree can grow ahead of its renderers.
 */
export function selectableCardTypes(registry: CardRegistry = CARD_REGISTRY): string[] {
    return [CARD_AUTO, ...selectableCardIds(registry).filter(id => id in CARD_COMPONENTS)];
}

/**
 * the card type a view defaults to: the nearest declaration on the view's own ancestor chain in the VIEW
 * registry, so `kanban` answers for itself and every other view inherits the one declared at `root`. An
 * unknown or absent view type falls back to DEFAULT_CARD_TYPE.
 *
 * Minted types are merged in before the walk, so a type the user saved inherits the card its parent
 * declares rather than falling through to the default. That is the same answer today, because every
 * declared default is `card`, and the right one the day a view declares something else.
 */
export function defaultCardTypeForView(view_type: string | undefined, user_types: UserViewType[] = [], registry: CardRegistry = CARD_REGISTRY): string {
    if (!view_type) { return DEFAULT_CARD_TYPE; }
    for (const view_id of chainOf(view_type, registryWithUserTypes(user_types))) {
        const declared = registry.view_defaults.find(d => d.view === view_id);
        if (declared) { return declared.card; }
    }
    debug('no declared card default on the chain for view %s', view_type);
    return DEFAULT_CARD_TYPE;
}

/**
 * resolve a card-type selection to the concrete card that renders. A selectable id is taken as pinned; a
 * missing selection, `auto`, or an id with no renderer all fall through to the view's declared default.
 * The auto-resolution proper (the per-file nt_card majority vote) happens in AutoView and reaches this
 * function as an already-concrete selection.
 */
export function resolveCardType(selection: string | undefined, view_type?: string, user_types: UserViewType[] = [], registry: CardRegistry = CARD_REGISTRY): string {
    if (selection && selection !== CARD_AUTO && selection in CARD_COMPONENTS) { return selection; }
    return defaultCardTypeForView(view_type, user_types, registry);
}

/** the component that renders a resolved card type, falling back to the default card for an unknown id */
export function cardComponentFor(card_type: string): ComponentType<NoteProps> {
    return CARD_COMPONENTS[card_type] ?? CARD_COMPONENTS[DEFAULT_CARD_TYPE];
}

import { lazy } from "react";
import type { ComponentType } from "react";
import Debug from "debug";
import {
    SETTING_HOMES,
    chainOf,
    isPerTreeKey,
    registryWithUserTypes,
    resolveTreeRow,
    resolveViewSetting,
    writeForTree,
    type ResolvedTreeRow,
    type ViewOverridesMap,
} from "../../lib/viewregistryops";
import { AGENT_VIRTUAL_NAMESPACE, sessionForUnboundKey, sessionsForStory, storyKeyForNote, storyLastActiveMs, type ActivitySnapshot } from "../../lib/agentactivityops";
import { isVirtualNote, virtualNoteKeyOf } from "../../lib/virtualnoteops";
import type { ResolvedSettingsCascade, SettingsCascadeKey, UserViewType } from "../../types/Messages";
import type { NoteProps } from "../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:cardregistryops");

/*
 * The card hierarchy as data, the orthogonal axis to the view registry. A view decides how notes are
 * laid out; a card decides how one note is drawn - the full card (pill, title, attributes, body), a
 * sticky, or the agents working on the note's story. The two are chosen independently, so `sticky`
 * cards work in a document just as they do in a kanban group. The axis covers the notes a view LAYS OUT,
 * not the view's own container: the note a DocumentView opens at holds every note below it in its body,
 * so GenericNote keeps it on the full card whatever is selected.
 *
 * Shaped deliberately like VIEW_REGISTRY rather than as a flat list of ids, because the same three
 * questions get asked of both axes: which entries may the user select, which node owns a setting, and
 * what does this node inherit. `allcards` is the abstract parent that owns the settings every card
 * shares, and every node under it is a concrete renderer. Adding a card type is one node here plus one
 * line in CARD_COMPONENTS.
 *
 * Each VIEW declares the card type it defaults to, keyed by view-registry node id and resolved up the
 * view tree, so a default set at `root` covers every view and a view that wants its own says so once.
 * That is why the default lives here as data rather than as a switch at the dispatch site. A view whose
 * settings carry a default card type (VIEW_DEFAULT_CARD_TYPE_SETTINGS) has that declaration replaced by
 * the configured value through cardRegistryWithViewSettings, so the user's choice rides the same walk.
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

// the card drawing the AI agents working on a note's story, and the one card type that admits virtual notes
export const AGENT_CARD_TYPE = 'agent';

export const CARD_REGISTRY: CardRegistry = {
    nodes: [
        { id: 'allcards', kind: 'abstract', selectable: false, label: 'All cards' },
        { id: 'card', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Card' },
        { id: 'sticky', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Sticky' },
        { id: AGENT_CARD_TYPE, parent: 'allcards', kind: 'concrete', selectable: true, label: 'Agent' },
    ],
    view_defaults: [
        { view: 'root', card: DEFAULT_CARD_TYPE },
        { view: 'kanban', card: DEFAULT_CARD_TYPE },
    ],
};

/*
 * Component per concrete card id, keyed by the same ids the card registry declares. Dynamic import() is
 * required by React.lazy for per-card code-splitting; static imports would pull every renderer into the
 * initial bundle. `auto` is not a registry node - it is the resolved meta-selection, so it never reaches
 * this map.
 */
export const CARD_COMPONENTS: Record<string, ComponentType<NoteProps>> = {
    card: lazy(() => import('./MarkdownNote')),
    sticky: lazy(() => import('./StickyNote')),
    agent: lazy(() => import('./AgentNote')),
};

/** the node record for a card id in the given registry (defaults to the built-in CARD_REGISTRY) */
export function getCardNode(id: string, registry: CardRegistry = CARD_REGISTRY): CardNode | undefined {
    return registry.nodes.find(n => n.id === id);
}

/**
 * The ancestor chain for a card node, deepest-first: the node itself, then its parent, up to the
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
 * The card node a setting is structurally homed at - a flat lookup against the tree shape, not the
 * resolved owner a row's pill names (that is `owningNodeFor` from viewregistryops.ts, called with the
 * card registry and the cards bag, since a card node can now hold its own value for a setting homed
 * above it exactly as a view can). This one answers "which node owns the key by declaration", which is
 * what `offersNewCardType` below needs to test ancestry against. A key homed off this tree - at a view
 * node, or at one of the sentinels - belongs to no card type and yields undefined.
 */
export function owningCardNodeFor(key: SettingsCascadeKey, registry: CardRegistry = CARD_REGISTRY): string | undefined {
    const home = SETTING_HOMES[key].node;
    return getCardNode(home, registry) === undefined ? undefined : home;
}

/** true for every card-tree setting a card node can genuinely hold its own value for, `cardType` excepted */
export function isPerCardKey(key: SettingsCascadeKey): boolean {
    return isPerTreeKey(key, CARD_REGISTRY, 'cardType');
}

/**
 * The one write for a card settings row, the card tree's half of `settingWriteFor` / `writeForTree`:
 * the selected card node's own cell, home-written literally or cleared against what it would inherit,
 * exactly as a view row writes. `cardType` and a non-card-tree key fall through to their flat key, since
 * the selection itself is not a value any card node holds.
 */
export function cardSettingWriteFor(
    selected_node: string,
    key: SettingsCascadeKey,
    value: unknown,
    home_value: unknown,
    card_overrides: ViewOverridesMap,
): { setting: SettingsCascadeKey | 'cards'; value: unknown } {
    return writeForTree(CARD_REGISTRY, 'cards', isPerCardKey(key), [], card_overrides, selected_node, key, value, home_value) as { setting: SettingsCascadeKey | 'cards'; value: unknown };
}

/**
 * Everything one card settings row needs - resolved value, what it would inherit, which pill to show,
 * and whether it is diverged - through the same engine a view row resolves through, so the card drawer
 * can never disagree with how a note actually renders.
 */
export function resolveCardTreeRow(
    selected_node: string,
    key: SettingsCascadeKey,
    home_value: unknown,
    card_overrides: ViewOverridesMap,
    diverged_keys: string[],
): ResolvedTreeRow {
    return resolveTreeRow(CARD_REGISTRY, 'cards', isPerCardKey(key), selected_node, key, home_value, [], card_overrides, diverged_keys);
}

// the card-tree settings resolvedSettingsForCard resolves per rendered card type
const CARD_TREE_KEYS: SettingsCascadeKey[] = ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers', 'clockMode'];

/**
 * A settings object with every card-tree key replaced by its resolved value for `card_type`'s own
 * chain - the same role `resolvedSettingsForView` plays for a rendered view, called once per note by
 * GenericNote so a sticky carrying its own value in `cardOverrides` renders with it. Every other key
 * (view-tree and global/files settings) passes through unchanged.
 *
 * Returns the SAME `settings` reference when nothing actually resolves differently - the overwhelming
 * common case, since no card type holds its own override yet - rather than always spreading a fresh
 * object: GenericNote calls this on every render, and a fresh reference there would defeat the card
 * component's own memo even when nothing about its settings changed.
 */
export function resolvedSettingsForCard(card_type: string, settings: Partial<ResolvedSettingsCascade>): Partial<ResolvedSettingsCascade> {
    const card_overrides = settings.cardOverrides ?? {};
    const resolved: Record<string, unknown> = {};
    let changed = false;
    for (const key of CARD_TREE_KEYS) {
        const value = resolveViewSetting(CARD_REGISTRY, card_type, key, settings[key], [], card_overrides).value;
        if (value !== settings[key]) { changed = true; }
        resolved[key] = value;
    }
    if (!changed) { return settings; }
    return { ...settings, ...resolved } as Partial<ResolvedSettingsCascade>;
}

/**
 * True when changing this row from the selected card node departs from a value an ancestor owns, which
 * is when the drawer would offer "Save as a new card type". The same rule the view axis follows: the
 * offer fires when the pill names a STRICT ancestor of the selected node, and the tree's own root is
 * exempt because its settings reach every card, so changing one is a preference rather than a new type.
 *
 * Nothing calls this yet, and that is the honest state rather than an oversight. Every card setting homes
 * either at the root, where the rule is exempt by design, or (clockMode) at `agent`, a leaf with no
 * descendant to depart from, so a card drawer that mounted the offer would still mount a control no
 * shipped setting can reach. The predicate is kept and unit-tested because it is the half that is
 * genuinely structural: home one setting at `card` or `sticky`, each of which COULD grow a descendant,
 * and the answer is already right; wiring the drawer to it is then the only work left.
 */
export function offersNewCardType(selected_node: string, key: SettingsCascadeKey, registry: CardRegistry = CARD_REGISTRY): boolean {
    const owner = owningCardNodeFor(key, registry);
    if (owner === undefined || owner === cardRootNode(registry)) { return false; }
    return isCardDescendantOf(selected_node, owner, registry);
}

/** the selectable concrete card ids in tree order; the source of the selector list */
export function selectableCardIds(registry: CardRegistry = CARD_REGISTRY): string[] {
    return registry.nodes.filter(n => n.selectable).map(n => n.id);
}

/**
 * The selectable card ids that can actually render, in tree order: every selectable registry card with a
 * component wired in CARD_COMPONENTS. A registry card declared without a component is left out, so the
 * card tree can grow ahead of its renderers. These are the choices a view's default card type offers.
 */
export function renderableCardIds(registry: CardRegistry = CARD_REGISTRY): string[] {
    return selectableCardIds(registry).filter(id => id in CARD_COMPONENTS);
}

/** the ordered card types the selector offers: `auto` plus every renderable card */
export function selectableCardTypes(registry: CardRegistry = CARD_REGISTRY): string[] {
    return [CARD_AUTO, ...renderableCardIds(registry)];
}

/**
 * The view settings that configure a view's default card type, keyed by view-registry node id. A view
 * listed here takes its default from that setting; every other view keeps the registry's declaration,
 * inherited up its chain as before.
 */
export const VIEW_DEFAULT_CARD_TYPE_SETTINGS: Partial<Record<string, SettingsCascadeKey>> = {
    kanban: 'defaultCardType',
};

/**
 * The card registry with each configured view's declared default replaced by the value its setting holds.
 * Pure - the built-in registry is never mutated, and with nothing configured it is returned unchanged. A
 * setting naming no renderable card is ignored rather than trusted, since it comes from a user's
 * settings.json, so a view can never be left with a default nothing draws. Callers hand the result to
 * resolveCardType, which walks it exactly as it walks the built-in one, so a type minted under kanban
 * inherits kanban's configured default by the same chain walk.
 */
export function cardRegistryWithViewSettings(settings: Partial<Record<SettingsCascadeKey, unknown>> | undefined, registry: CardRegistry = CARD_REGISTRY): CardRegistry {
    if (!settings) { return registry; }
    const configured: CardViewDefault[] = [];
    for (const [view, key] of Object.entries(VIEW_DEFAULT_CARD_TYPE_SETTINGS)) {
        const value = key === undefined ? undefined : settings[key];
        if (typeof value === 'string' && value in CARD_COMPONENTS) {
            configured.push({ view, card: value });
        }
    }
    if (configured.length === 0) { return registry; }
    const configured_views = new Set(configured.map(d => d.view));
    return {
        nodes: registry.nodes,
        view_defaults: [...registry.view_defaults.filter(d => !configured_views.has(d.view)), ...configured],
    };
}

/**
 * The card type a view defaults to: the nearest declaration on the view's own ancestor chain in the VIEW
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
 * Resolves a card-type selection to the concrete card that renders. A selectable id is taken as pinned; a
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

/**
 * What a card type's ordering timestamp function needs beyond the note itself, kept to the one thing
 * that varies live (the agent activity snapshot) plus the fallback doc path a single-file view has no
 * origin to carry. Grouping order (`grouporderops.ts`) stays independent of card types and agent code by
 * taking a plain `(note) => number | undefined` instead of this context - `noteOrderTimestampFn` below
 * is where the two meet.
 */
export interface OrderTimestampContext {
    snapshot: ActivitySnapshot | undefined;
    fallback_doc_path?: string;
}

/**
 * A card type's definition of "when this card last changed", in epoch ms, for the automatic group
 * orders (`newestFirst` / `newestLast`) to read a group's latest timestamp across its own cards.
 * Declaring one here is the whole job of making a card type order-aware; a type that declares none
 * falls back to `fileChangedOrderTimestamp`, the default card's own rule.
 */
export type OrderTimestampFn = (note: NoteProps, ctx: OrderTimestampContext) => number | undefined;

/**
 * The agent card's ordering timestamp: when an agent last wrote to this card, i.e. the latest
 * write to its own story among the sessions bound to it (a session's `updated_at` where it carries no
 * per-story time), or, for a virtual unbound-agent note, its own session's `updated_at`. This is the one place a card's agent activity is read for ordering, so a board and its
 * settings drawer read it alike.
 */
function agentOrderTimestamp(note: NoteProps, ctx: OrderTimestampContext): number | undefined {
    const own_session = isVirtualNote(note) ? sessionForUnboundKey(ctx.snapshot, virtualNoteKeyOf(note, AGENT_VIRTUAL_NAMESPACE)) : undefined;
    const story_key = own_session ? undefined : storyKeyForNote(note, ctx.fallback_doc_path);
    const sessions = own_session ? [own_session] : sessionsForStory(ctx.snapshot, story_key);
    let latest: number | undefined;
    for (const state of sessions) {
        const ms = story_key ? storyLastActiveMs(state, story_key) : Date.parse(state.session.updated_at);
        if (ms === undefined || Number.isNaN(ms)) { continue; }
        if (latest === undefined || ms > latest) { latest = ms; }
    }
    return latest;
}

/** every other card type's ordering timestamp: when the card's data last changed, the mtime of the file holding its story; a note with none has no timestamp */
function fileChangedOrderTimestamp(note: NoteProps): number | undefined {
    return note.origin?.file_mtime;
}

// one stable reference so two lookups for the same fallback type are `===`, not two freshly built closures
const FALLBACK_ORDER_TIMESTAMP_FN: OrderTimestampFn = note => fileChangedOrderTimestamp(note);

// one entry per card type with its own ordering attribute; every other type falls back to file-changed
const ORDER_TIMESTAMP_FNS: Partial<Record<string, OrderTimestampFn>> = {
    [AGENT_CARD_TYPE]: agentOrderTimestamp,
};

/** the ordering timestamp function a card type declares, or the file-changed default for a type that declares none */
export function orderTimestampFnFor(card_type: string): OrderTimestampFn {
    return ORDER_TIMESTAMP_FNS[card_type] ?? FALLBACK_ORDER_TIMESTAMP_FN;
}

/**
 * The plain `(note) => ms | undefined` function `orderGroupValues` takes, bound to one resolved card
 * type and one activity context, so the caller (the board or its settings drawer, both of which already
 * resolve the card type the same way `GenericNote` does) can hand grouping a pure function without
 * grouping ever importing a card type or agent code itself.
 */
export function noteOrderTimestampFn(card_type: string, ctx: OrderTimestampContext): (note: NoteProps) => number | undefined {
    const fn = orderTimestampFnFor(card_type);
    return (note: NoteProps) => fn(note, ctx);
}

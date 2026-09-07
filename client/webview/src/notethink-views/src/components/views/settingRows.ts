import * as l10n from "@vscode/l10n";
import { CARD_REGISTRY, cardChainOf, owningCardNodeFor, type CardRegistry } from "../notes/cardregistryops";
import { DEFAULT_CARD_RATIO } from "./kanban/columnwidthops";
import { NODE_GLOBAL, SETTING_HOMES, VIEW_REGISTRY, chainOf, owningNodeFor, type ViewRegistry } from "../../lib/viewregistryops";
import type { SettingsCascadeKey } from "../../types/Messages";

/**
 * The rows a settings pane renders, and the rules that place them. Both axes are here, because a row is
 * the same thing on either one - a marker, a name, a control and an owning-type pill - and only the tree
 * it is placed against differs.
 *
 * A row is not the same thing as a settings key. `SETTING_HOMES` says where every key lives, but four of
 * its keys are not rows at all - `viewType` and `cardType` are their tree's radio rather than a control,
 * and the three `NODE_FILES` keys belong to the Files drawer - while the lane axis is one row spelled by
 * two keys, `groupBy` at grouped and `kanbanGroupBy` at kanban. These tables are therefore the row spec,
 * and `SETTING_HOMES` decides where each row lands.
 */
export type SettingControlKind = 'checkbox' | 'groupBy' | 'orientation' | 'columnOrder' | 'cardRatio';

/**
 * One declared row.
 * - key: the cascade key this row reads and writes, which is also its testid suffix
 * - control: which control the pane renders in the third column
 * - fallback: the built-in default, mirroring SETTINGS in client/extension/src/lib/settings.ts; it only
 *   shows before the first cascade arrives, since the composer stamps every key from then on
 * - alias: rows sharing an alias are one setting homed at more than one node, and collapse to whichever
 *   of them is homed deepest on the selected node's chain
 */
export interface SettingRowDef {
    key: SettingsCascadeKey;
    control: SettingControlKind;
    fallback: unknown;
    alias?: string;
}

/** the cascade values a pane reads its controls from, narrowed to the keys that have arrived */
export type SettingRowValues = Partial<Record<SettingsCascadeKey, unknown>>;

const AXIS_ALIAS = 'axis';

/*
 * Declaration order is the within-node order the pane renders, so the kanban rows read group-by, column
 * order, animate exactly as the drawer's design states them. Across nodes the chain decides the order,
 * so this list needs no most-specific-first arrangement of its own.
 */
export const VIEW_SETTING_ROWS: SettingRowDef[] = [
    { key: 'kanbanGroupBy', control: 'groupBy', fallback: 'auto', alias: AXIS_ALIAS },
    { key: 'groupBy', control: 'groupBy', fallback: 'auto', alias: AXIS_ALIAS },
    { key: 'columnOrder', control: 'columnOrder', fallback: [] },
    { key: 'kanbanCardRatio', control: 'cardRatio', fallback: DEFAULT_CARD_RATIO },
    { key: 'kanbanAnimateTransitions', control: 'checkbox', fallback: true },
    { key: 'orientation', control: 'orientation', fallback: 'columns' },
    { key: 'scrollNoteIntoView', control: 'checkbox', fallback: true },
    { key: 'watchUnopenedFilesInViewer', control: 'checkbox', fallback: true },
    { key: 'openNewEditorIfNoneOpen', control: 'checkbox', fallback: false },
];

/*
 * The card pane's rows. All three describe how one note is drawn rather than how a view lays notes out,
 * which is why they home on the card tree and appear on the card tab alone. Their config paths still read
 * `view.generic.*`: a path is a permanent name on a user's disk, so re-homing a setting moves which pane
 * shows it and never where it is stored.
 */
export const CARD_SETTING_ROWS: SettingRowDef[] = [
    { key: 'showLinetagsInHeadlines', control: 'checkbox', fallback: false },
    { key: 'autoExpandFocusedNote', control: 'checkbox', fallback: false },
    { key: 'showLineNumbers', control: 'checkbox', fallback: false },
];

/** the tree node a row is homed at, which is what decides both its position in the pane and its count */
export function rowHome(def: SettingRowDef): string {
    return SETTING_HOMES[def.key].node;
}

/**
 * The row's visible name. A switch of literals rather than a label field on the table, because
 * `vscode-l10n-dev export` reads `l10n.t('...')` statically and a label threaded through a variable
 * would never reach the bundle.
 *
 * Two of these are named for the thing rather than for the axis it happens to be drawn on. Orientation
 * transposes the board, so "column order" and "column width" name nothing once the lanes are rows; the
 * lanes are groups whichever way they run, and the width is only ever a consequence of the card shape.
 * The config paths still say `columnOrder` and `cardRatio` - a path is a permanent name on a user's disk,
 * so renaming a row moves what it is called and never where it is stored.
 */
export function settingRowLabel(key: SettingsCascadeKey): string {
    switch (key) {
        case 'groupBy':
        case 'kanbanGroupBy': return l10n.t('Group by');
        case 'columnOrder': return l10n.t('Group order');
        case 'kanbanCardRatio': return l10n.t('Target card ratio');
        case 'kanbanAnimateTransitions': return l10n.t('Animate passive transitions');
        case 'orientation': return l10n.t('Orientation');
        case 'showLinetagsInHeadlines': return l10n.t('Show linetags in headlines');
        case 'scrollNoteIntoView': return l10n.t('Scroll note into view');
        case 'autoExpandFocusedNote': return l10n.t('Auto-expand focused note');
        case 'showLineNumbers': return l10n.t('Show line numbers');
        case 'watchUnopenedFilesInViewer': return l10n.t('Watch unopened files in viewer');
        case 'openNewEditorIfNoneOpen': return l10n.t('Open a new editor if none is open');
        default: return key;
    }
}

/**
 * How many settings differ from their saved default, worded for both drawers so the two cannot describe
 * the same number differently. It carries no brackets: the view drawer parenthesises it in the Change
 * defaults summary, and the card drawer, which has no disclosure to hide it behind, states it plainly.
 */
export function divergedCountLabel(count: number): string {
    return count === 1 ? l10n.t('1 setting diverged') : l10n.t('{0} settings diverged', count);
}

/** the alias sibling homed deepest on the chain, which is the one row the pane renders for that setting */
function deepestOfAlias(candidates: SettingRowDef[], alias: string, chain: string[]): SettingRowDef | undefined {
    const siblings = candidates.filter(def => def.alias === alias);
    return siblings.reduce<SettingRowDef | undefined>((best, def) => {
        if (best === undefined) { return def; }
        return chain.indexOf(rowHome(def)) < chain.indexOf(rowHome(best)) ? def : best;
    }, undefined);
}

/**
 * The declared rows whose home sits on `chain`, ordered by how deep the type NAMED ON THEIR PILL sits,
 * most-specific first.
 *
 * The pill is the sort key rather than the storage home, because the pill is what the reader can see. The
 * two agree on every row but one: the lane axis is stored at kanban and pilled Grouped, since kanban pins
 * the axis rather than owning it, so sorting on the home put Group by above Group order under a pill
 * saying it belonged further up the tree. Sorting on the pill makes the list read exactly as the pill
 * column reads - Kanban, Line, Grouped, All views - which is the tree upside down, and the tree is drawn
 * root-first directly above it.
 *
 * The alias collapse deliberately keeps using the home. Which of two aliased rows renders is a question
 * about which key a change writes to, and that is storage, not presentation.
 */
function rowsOnChain(rows: SettingRowDef[], chain: string[], ownerOf: (def: SettingRowDef) => string | undefined): SettingRowDef[] {
    const on_chain = rows.filter(def => chain.includes(rowHome(def)));
    const collapsed = on_chain.filter(def => def.alias === undefined || def === deepestOfAlias(on_chain, def.alias, chain));
    const depth = (def: SettingRowDef): number => {
        const index = chain.indexOf(ownerOf(def) ?? rowHome(def));
        return index === -1 ? chain.indexOf(rowHome(def)) : index;
    };
    return [...collapsed].sort((a, b) => depth(a) - depth(b));
}

/**
 * The rows the view pane lists for a selected node, most-specific first, so selecting Kanban reads the
 * kanban rows, then line, then grouped, then All views. An alias group collapses to its deepest home, so
 * the lane axis renders once - as `kanbanGroupBy` from a kanban board and as `groupBy` from anywhere above
 * it, which is how one control writes a kanban override without disturbing the ancestor's value.
 *
 * Sorting is stable within a node, so declaration order survives as the within-node order. A row homed at
 * a sentinel node or on the card tree never matches a view chain and so never appears here.
 */
export function viewRowsForNode(node_id: string, registry: ViewRegistry = VIEW_REGISTRY): SettingRowDef[] {
    return rowsOnChain(VIEW_SETTING_ROWS, chainOf(node_id, registry), def => owningNodeFor(node_id, def.key, registry));
}

/**
 * The rows the card pane lists for a selected card node, by the same most-specific-first rule. Every card
 * setting homes at the tree's root today, so each of the three appears whichever card node is selected;
 * the chain filter is what a setting homed at `sticky` would need to show there and nowhere else.
 */
export function cardRowsForNode(node_id: string, registry: CardRegistry = CARD_REGISTRY): SettingRowDef[] {
    return rowsOnChain(CARD_SETTING_ROWS, cardChainOf(node_id, registry), def => owningCardNodeFor(def.key, registry));
}

/** the rows belonging to no view type, listed under the view pane's Global settings heading with no pill */
export function globalSettingRows(): SettingRowDef[] {
    return VIEW_SETTING_ROWS.filter(def => rowHome(def) === NODE_GLOBAL);
}

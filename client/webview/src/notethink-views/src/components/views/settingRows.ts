import * as l10n from "@vscode/l10n";
import { CARD_REGISTRY, DEFAULT_CARD_TYPE, cardChainOf, type CardRegistry } from "../notes/cardregistryops";
import { DEFAULT_CARD_RATIO, DEFAULT_LINE_BREADTH } from "./kanban/columnwidthops";
import { NODE_GLOBAL, SETTING_HOMES, VIEW_REGISTRY, chainOf, type ViewRegistry } from "../../lib/viewregistryops";
import { AGENT_CLOCK_MODE_DEFAULT } from "../../lib/agentactivityops";
import { GROUP_ORDER_DEFAULT } from "../../lib/grouporderops";
import type { SettingsCascadeKey } from "../../types/Messages";

/**
 * The rows a settings pane renders, and the rules that place them. Both axes are here, because a row is
 * the same thing on either one - a marker, a name, a control and an owning-type pill - and only the tree
 * it is placed against differs.
 *
 * A row is not the same thing as a settings key. `SETTING_HOMES` says where every key lives, but several
 * of its keys are not rows at all - `viewType` and `cardType` are their tree's radio rather than a
 * control, the three `NODE_FILES` keys belong to the Files drawer, and `viewUserTypes` / `viewOverrides`
 * are persisted state with no control of their own. These tables are therefore the row spec, and
 * `SETTING_HOMES` decides where each row lands.
 */
export type SettingControlKind = 'checkbox' | 'groupBy' | 'orientation' | 'groupDisplay' | 'groupOrder' | 'cardRatio' | 'cardType' | 'breadth' | 'clockMode';

/**
 * One declared row.
 * - key: the cascade key this row reads and writes, which is also its testid suffix
 * - control: which control the pane renders in the third column
 * - fallback: the built-in default, mirroring SETTINGS in client/extension/src/lib/settings.ts; it only
 *   shows before the first cascade arrives, since the composer stamps every key from then on
 */
export interface SettingRowDef {
    key: SettingsCascadeKey;
    control: SettingControlKind;
    fallback: unknown;
}

/**
 * The cascade values a pane reads its controls from, narrowed to the keys that have arrived.
 * `viewUserTypes` / `viewOverrides` / `cardOverrides` are not rows (settingRows.ts never reads them by
 * key), but each drawer carries its own in the same resolved settings block to resolve a row's pill and
 * owner, so the type admits them too.
 */
export type SettingRowValues = Partial<Record<SettingsCascadeKey, unknown>> & {
    viewUserTypes?: unknown;
    viewOverrides?: unknown;
    cardOverrides?: unknown;
};

/*
 * Declaration order is the within-node order the pane renders, so the kanban rows read group-by, group
 * display, card ratio, animate, default card type exactly as the drawer's design states them. Across nodes
 * the chain decides the order, so this list needs no most-specific-first arrangement of its own.
 */
export const VIEW_SETTING_ROWS: SettingRowDef[] = [
    { key: 'groupBy', control: 'groupBy', fallback: 'auto' },
    { key: 'groupOrder', control: 'groupOrder', fallback: GROUP_ORDER_DEFAULT },
    { key: 'groupDisplay', control: 'groupDisplay', fallback: [] },
    { key: 'cardRatio', control: 'cardRatio', fallback: DEFAULT_CARD_RATIO },
    { key: 'animateTransitions', control: 'checkbox', fallback: true },
    { key: 'defaultCardType', control: 'cardType', fallback: DEFAULT_CARD_TYPE },
    { key: 'orientation', control: 'orientation', fallback: 'columns' },
    { key: 'lineBreadth', control: 'breadth', fallback: DEFAULT_LINE_BREADTH },
    { key: 'scrollNoteIntoView', control: 'checkbox', fallback: true },
    { key: 'watchUnopenedFilesInViewer', control: 'checkbox', fallback: true },
    { key: 'openNewEditorIfNoneOpen', control: 'checkbox', fallback: false },
];

/*
 * The card pane's rows: how one note is drawn rather than how a view lays notes out, which is why they
 * home on the card tree and appear on the card tab alone. The first three home at `allcards` (every
 * card type), stored at `cards.allcards.<key>`. `clockMode` homes at `agent` specifically, the first
 * card setting to home below the root, so it appears only when the agent card type is selected; its bag
 * entry is `cards.agent.clockMode`.
 */
export const CARD_SETTING_ROWS: SettingRowDef[] = [
    { key: 'showLinetagsInHeadlines', control: 'checkbox', fallback: false },
    { key: 'autoExpandFocusedNote', control: 'checkbox', fallback: false },
    { key: 'showLineNumbers', control: 'checkbox', fallback: false },
    { key: 'clockMode', control: 'clockMode', fallback: AGENT_CLOCK_MODE_DEFAULT },
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
 * transposes the board, so a "column" names nothing once the groups are rows, and "Group display" calls
 * them groups, which they are whichever way they run. The breadth row is the exception, named for the
 * axis it runs along: "Column width" while the groups are columns and "Row height" once they are rows,
 * which is why the label takes the orientation.
 */
export function settingRowLabel(key: SettingsCascadeKey, orientation?: unknown): string {
    switch (key) {
        case 'lineBreadth': return orientation === 'rows' ? l10n.t('Row height') : l10n.t('Column width');
        case 'groupBy': return l10n.t('Group by');
        case 'groupDisplay': return l10n.t('Group display');
        case 'groupOrder': return l10n.t('Group order');
        case 'cardRatio': return l10n.t('Target card ratio');
        case 'animateTransitions': return l10n.t('Animate passive transitions');
        case 'defaultCardType': return l10n.t('Default card type');
        case 'orientation': return l10n.t('Orientation');
        case 'showLinetagsInHeadlines': return l10n.t('Show linetags in headlines');
        case 'scrollNoteIntoView': return l10n.t('Scroll note into view');
        case 'autoExpandFocusedNote': return l10n.t('Auto-expand focused note');
        case 'showLineNumbers': return l10n.t('Show line numbers');
        case 'watchUnopenedFilesInViewer': return l10n.t('Watch unopened files in viewer');
        case 'openNewEditorIfNoneOpen': return l10n.t('Open a new editor if none is open');
        case 'clockMode': return l10n.t('Clock mode');
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

/**
 * The declared rows banded by HOME in chain order: the selected node's own band first (if it homes any
 * rows at all), then each ancestor's, ending with the tree's root. Banding by home rather than by a
 * row's resolved owner is what lets a thin divider mark each band boundary regardless of which node,
 * built-in or saved, actually holds a value today - the band a row sits in never moves as a value is set
 * or cleared, only the pill beside it does. Shared by the view and card panes, which differ only in
 * which rows and which chain they band.
 *
 * Declaration order survives as the within-band order. A row homed off `chain` entirely never appears.
 */
function rowsBandedByHome(rows: SettingRowDef[], chain: string[]): SettingRowDef[] {
    return chain.flatMap(home_node => rows.filter(def => rowHome(def) === home_node));
}

/** the rows the view pane lists for a selected node, banded by home - see rowsBandedByHome */
export function viewRowsForNode(node_id: string, registry: ViewRegistry = VIEW_REGISTRY): SettingRowDef[] {
    return rowsBandedByHome(VIEW_SETTING_ROWS, chainOf(node_id, registry));
}

/**
 * The rows the card pane lists for a selected card node, banded by home exactly as the view pane's rows
 * are. Three of the four card rows home at `allcards`, so they appear whichever card node is selected;
 * `clockMode` homes at `agent` and so appears only there, the chain filter earning its place for the
 * first time on this axis.
 */
export function cardRowsForNode(node_id: string, registry: CardRegistry = CARD_REGISTRY): SettingRowDef[] {
    return rowsBandedByHome(CARD_SETTING_ROWS, cardChainOf(node_id, registry));
}

/** the rows belonging to no view type, listed under the view pane's Global settings heading with no pill */
export function globalSettingRows(): SettingRowDef[] {
    return VIEW_SETTING_ROWS.filter(def => rowHome(def) === NODE_GLOBAL);
}

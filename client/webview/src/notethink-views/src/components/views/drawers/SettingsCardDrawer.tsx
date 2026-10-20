import Debug from "debug";
import React, { useCallback, useMemo, useState } from "react";
import * as l10n from "@vscode/l10n";
import type { ReactNode } from "react";
import {
    CARD_AUTO,
    CARD_REGISTRY,
    cardChainOf,
    cardSettingWriteFor,
    childCardNodes,
    getCardNode,
    resolveCardTreeRow,
    type CardNode,
} from "../../notes/cardregistryops";
import { nodeSettingCount, owningNodeFor, type ViewOverridesMap } from "../../../lib/viewregistryops";
import { AGENT_CLOCK_MODE_DEFAULT, AGENT_CLOCK_MODES, agentClockModeLabel, type AgentClockMode } from "../../../lib/agentactivityops";
import type { ResolvedSettingsCascade, SettingsCascadeKey } from "../../../types/Messages";
import styles from "../../ViewRenderer.module.scss";
import SettingsRow from "../SettingsRow";
import { viewTypeLabel } from "../viewTypeLabel";
import { CARD_SETTING_ROWS, cardRowsForNode, divergedCountLabel, orderRowsByOwner, settingRowLabel, type SettingRowDef, type SettingRowValues } from "../settingRows";
import DrawerTree, { type DrawerTreeNode } from "./DrawerTree";

const debug = Debug("nodejs:notethink-views:SettingsCardDrawer");

/**
 * The card settings drawer: the card-type tree on the left, the selected type's settings on the right.
 *
 * The card axis's half of the same drawer the view axis already has, and deliberately the same shape - a
 * reader who has learned one tab has learned the other, right down to the inherited/specific pills, the
 * M marker and the home banding: a card node can now hold its own value for a setting homed above it
 * (at `allcards`) exactly as a view can, resolved and written through the same engine
 * (`resolveCardTreeRow` / `cardSettingWriteFor` in cardregistryops.ts, both thin wrappers over the view
 * tree's own `resolveTreeRow` / `writeForTree`).
 *
 * This drawer deliberately mounts no new-card-type offer. `offersNewCardType` exists and is unit-tested,
 * but every card setting homes at the tree's root, where the rule is exempt - so the control would be one
 * no shipped setting could ever reach. Home a setting at `card` or `sticky` and wiring it here is the
 * remaining work; until then the absence is the design, not a gap.
 * - settings: the resolved cascade block, read for every control's value
 * - diverged: the cascade keys differing from their saved default, which is what marks a row M
 * - resolvedCardType: the concrete card the notes currently draw as, which is where the highlight starts
 * - cardTypeSelection: the persisted choice the radios reflect, `auto` when nothing is pinned
 */
export interface SettingsCardDrawerProps {
    viewId: string;
    settings: SettingRowValues;
    diverged: string[];
    resolvedCardType: string;
    cardTypeSelection: string;
    onCardTypeChange: (card_type: string) => void;
    onSettingChange: (key: SettingsCascadeKey | 'cards', value: unknown) => void;
}

/**
 * A card node's display name. The registry root is the whole tree rather than a type anyone would call
 * "Allcards", so it is relabelled; every other node goes through the shared `viewTypeLabel` so the tree,
 * the pills and the toolbar tab can never word the same card type differently.
 */
function cardNodeLabel(node: CardNode): string {
    if (node.parent === undefined) { return l10n.t('All cards'); }
    return viewTypeLabel(node.id);
}

/** a card node id into its drawer label, or undefined through, for the pills resolveCardTreeRow names by id */
function labelOf(node_id: string | undefined): string | undefined {
    if (node_id === undefined) { return undefined; }
    const node = getCardNode(node_id);
    return node ? cardNodeLabel(node) : node_id;
}

/** the pill's text for a row: the card node the resolved value actually comes from, or undefined when the key belongs to no card type */
function ownerLabelFor(selected_node: string, key: SettingsCascadeKey, card_overrides: ViewOverridesMap): string | undefined {
    return labelOf(owningNodeFor(selected_node, key, CARD_REGISTRY, [], card_overrides));
}

interface CardRowControlProps {
    def: SettingRowDef;
    value: unknown;
    onChange: (def: SettingRowDef, value: unknown) => void;
}

/** the clock mode select: the three AGENT_CLOCK_MODES, labelled by agentClockModeLabel so the row and the row's own tooltip never word a mode differently */
function ClockModeControl(props: { value: unknown; onChange: (mode: AgentClockMode) => void }): React.ReactElement {
    const value: AgentClockMode = AGENT_CLOCK_MODES.includes(props.value as AgentClockMode) ? props.value as AgentClockMode : AGENT_CLOCK_MODE_DEFAULT;
    return (
        <select
            className={styles.settingsSelect}
            data-testid="setting-control-clockMode"
            value={value}
            aria-label={settingRowLabel('clockMode')}
            onChange={(e) => props.onChange(e.target.value as AgentClockMode)}
        >
            {AGENT_CLOCK_MODES.map(mode => (
                <option key={mode} value={mode}>{agentClockModeLabel(mode)}</option>
            ))}
        </select>
    );
}

/**
 * The third column's control for one card row: a checkbox for every boolean setting, and the clock
 * mode select for `clockMode` - the extension point a future card setting needing its own select
 * adds a case to, not a shape to collapse into a bare checkbox.
 */
function CardRowControl(props: CardRowControlProps): React.ReactElement {
    switch (props.def.control) {
        case 'clockMode':
            return <ClockModeControl value={props.value} onChange={(mode) => props.onChange(props.def, mode)} />;
        case 'checkbox':
        default:
            return (
                <input
                    type="checkbox"
                    data-testid={`setting-control-${props.def.key}`}
                    checked={props.value === true}
                    aria-label={settingRowLabel(props.def.key)}
                    onChange={(e) => props.onChange(props.def, e.target.checked)}
                />
            );
    }
}

/**
 * What the tree builder needs to draw a row: the two independent marks and the two callbacks behind
 * them. `radio_name` groups one drawer's radios, so two drawers on a page never share a selection.
 */
interface CardTreeContext {
    selected_node: string;
    card_type_selection: string;
    resolved_card_type: string;
    counted_settings: Partial<ResolvedSettingsCascade>;
    radio_name: string;
    onHighlight: (node_id: string) => void;
    onPickType: (card_type: string) => void;
}

/**
 * The trailing slot on a tree row: the radio, then the count of settings that node owns.
 *
 * The radio appears on every card that can render, plus on the root, where it stands for `auto` - the
 * root owns the card-type setting and `auto` is precisely the state of having pinned nothing below it,
 * exactly as the view tree puts its own auto radio on All views.
 */
function treeRowTrailing(node: CardNode, ctx: CardTreeContext): ReactNode {
    const is_root = node.parent === undefined;
    const radio_value = is_root ? CARD_AUTO : node.id;
    return (
        <>
            {(is_root || node.selectable) && (
                <input
                    type="radio"
                    name={ctx.radio_name}
                    data-testid={`card-radio-${radio_value}`}
                    checked={ctx.card_type_selection === radio_value}
                    aria-label={is_root ? viewTypeLabel(CARD_AUTO, ctx.resolved_card_type) : l10n.t('Switch to {0}', cardNodeLabel(node))}
                    onChange={() => ctx.onPickType(radio_value)}
                />
            )}
            <span className={styles.settingsTreeCount} data-testid={`card-node-count-${node.id}`}>
                {`(${nodeSettingCount(node.id, ctx.counted_settings)})`}
            </span>
        </>
    );
}

/** the whole card registry as DrawerTree rows, recursing from `parent_id` (undefined for the tree's root) */
function buildCardTreeNodes(parent_id: string | undefined, ctx: CardTreeContext): DrawerTreeNode[] {
    return childCardNodes(parent_id).map((node) => {
        const children = buildCardTreeNodes(node.id, ctx);
        return {
            id: node.id,
            testId: `card-node-${node.id}`,
            label: cardNodeLabel(node),
            glyph: children.length > 0 ? '›' : '',
            expanded: children.length > 0 ? true : undefined,
            kind: node.selectable ? 'selectable' : 'abstract',
            current: node.id === ctx.selected_node,
            trailing: treeRowTrailing(node, ctx),
            children: children.length > 0 ? children : undefined,
            onSelect: () => ctx.onHighlight(node.id),
        };
    });
}

/**
 * Everything one card row's control and pills need, resolved once through `resolveCardTreeRow` so the
 * pane and the diverged tally can never disagree about what a row shows.
 */
interface ResolvedCardRow {
    value: unknown;
    owner_id: string | undefined;
    ownerLabel: string | undefined;
    inheritedFrom: string | undefined;
    inheritedIsBuiltinDefault: boolean;
    specificFrom: string | undefined;
    diverged: boolean;
}

function resolveCardRow(def: SettingRowDef, selected_node: string, settings: SettingRowValues, card_overrides: ViewOverridesMap, diverged_keys: string[]): ResolvedCardRow {
    const home_value = settings[def.key] ?? def.fallback;
    const resolved = resolveCardTreeRow(selected_node, def.key, home_value, card_overrides, diverged_keys);
    return {
        value: resolved.value,
        owner_id: resolved.ownerId,
        ownerLabel: ownerLabelFor(selected_node, def.key, card_overrides),
        inheritedFrom: labelOf(resolved.inheritedFromId),
        inheritedIsBuiltinDefault: resolved.inheritedIsBuiltinDefault,
        specificFrom: labelOf(resolved.specificFromId),
        diverged: resolved.diverged,
    };
}

interface CardSettingsPaneProps {
    rows: SettingRowDef[];
    selectedNode: string;
    settings: SettingRowValues;
    cardOverrides: ViewOverridesMap;
    diverged: string[];
    onRowChange: (def: SettingRowDef, value: unknown) => void;
}

/**
 * The right pane: one five-column grid holding the selected node's chain rows, banded by owner exactly
 * as the view pane's rows are, with a thin rule wherever the owner changes. The columns carry no heads of
 * their own - the "Card settings" heading above the pane says what the rows are. There is no Global
 * settings group here: a global belongs to no tree, and the view pane is where it is listed.
 */
function CardSettingsPane(props: CardSettingsPaneProps): React.ReactElement {
    const resolved_rows = props.rows.map(def => ({ def, ...resolveCardRow(def, props.selectedNode, props.settings, props.cardOverrides, props.diverged) }));
    const ordered_rows = orderRowsByOwner(resolved_rows, cardChainOf(props.selectedNode));
    const renderRow = (def: SettingRowDef, resolved: ResolvedCardRow): React.ReactElement => (
        <SettingsRow
            key={def.key}
            rowKey={def.key}
            label={settingRowLabel(def.key)}
            ownerLabel={resolved.ownerLabel}
            diverged={resolved.diverged}
            inheritedFrom={resolved.inheritedFrom}
            inheritedIsBuiltinDefault={resolved.inheritedIsBuiltinDefault}
            specificFrom={resolved.specificFrom}
            control={
                <CardRowControl
                    def={def}
                    value={resolved.value}
                    onChange={props.onRowChange}
                />
            }
        />
    );
    return (
        <div className={styles.settingsRowGrid} data-testid="card-settings-rows">
            {ordered_rows.flatMap((entry, index) => {
                const row = renderRow(entry.def, entry);
                // a thin rule opens each run of rows owned by a different card node, as the view pane's bands do
                if (index === 0 || entry.owner_id === ordered_rows[index - 1].owner_id) { return [row]; }
                return [<div key={`owner-divider-${entry.def.key}`} className={styles.settingsOwnerDivider} data-testid="settings-owner-divider" aria-hidden="true" />, row];
            })}
        </div>
    );
}

/**
 * The divergence tally. The view pane hides its own behind Change defaults, which the card pane does not
 * carry - the default actions are whole-cascade, so they belong on one tab rather than both - so this one
 * states the count plainly and puts the explanation in its title.
 */
function DivergedCount(props: { count: number }): React.ReactElement {
    return (
        <p
            className={styles.settingsDivergedNote}
            data-testid="card-diverged-count"
            title={l10n.t('Settings diverged from the defaults and are already saved')}
        >
            {divergedCountLabel(props.count)}
        </p>
    );
}

/** the node whose settings the right pane shows: the user's pick while it names a real node, else the rendered card */
function resolveSelectedNode(picked: string | undefined, resolved_card_type: string): string {
    if (picked !== undefined && getCardNode(picked) !== undefined) { return picked; }
    if (getCardNode(resolved_card_type) !== undefined) { return resolved_card_type; }
    return CARD_REGISTRY.nodes[0].id;
}

/** the cascade narrowed to the keys this drawer renders, so a node's count states what clicking it shows */
function countedSettings(settings: SettingRowValues): Partial<ResolvedSettingsCascade> {
    const narrowed: Record<string, unknown> = {};
    for (const def of CARD_SETTING_ROWS) {
        if (def.key in settings) { narrowed[def.key] = settings[def.key]; }
    }
    return narrowed as Partial<ResolvedSettingsCascade>;
}

function SettingsCardDrawer(props: SettingsCardDrawerProps): React.ReactElement {
    const [picked_node, setPickedNode] = useState<string | undefined>(undefined);
    const selected_node = resolveSelectedNode(picked_node, props.resolvedCardType);
    const { onCardTypeChange, onSettingChange } = props;
    // the selected card's own bag; cardSettingWriteFor and resolveCardTreeRow route every read and write through it
    const card_overrides = (props.settings.cardOverrides as ViewOverridesMap | undefined) ?? {};
    const handle_pick_type = useCallback((card_type: string): void => {
        onCardTypeChange(card_type);
        if (card_type !== CARD_AUTO) { setPickedNode(card_type); }
    }, [onCardTypeChange]);
    const handle_row_change = useCallback((def: SettingRowDef, value: unknown): void => {
        const home_value = props.settings[def.key] ?? def.fallback;
        const write = cardSettingWriteFor(selected_node, def.key, value, home_value, card_overrides);
        onSettingChange(write.setting, write.value);
    }, [card_overrides, onSettingChange, props.settings, selected_node]);
    const rows = useMemo(() => cardRowsForNode(selected_node), [selected_node]);
    const diverged_count = rows.filter(def => resolveCardRow(def, selected_node, props.settings, card_overrides, props.diverged).diverged).length;
    debug('selected=%s rows=%d diverged=%d', selected_node, rows.length, diverged_count);
    const tree_nodes = buildCardTreeNodes(undefined, {
        selected_node,
        card_type_selection: props.cardTypeSelection,
        resolved_card_type: props.resolvedCardType,
        counted_settings: countedSettings(props.settings),
        radio_name: `v${props.viewId}-card-type`,
        onHighlight: setPickedNode,
        onPickType: handle_pick_type,
    });
    return (
        <div className={`${styles.drawerBody} ${styles.settingsDrawerBody}`} data-testid="settings-drawer-card">
            <div className={styles.settingsPanes}>
                <div className={styles.settingsHeadTree}>
                    <h4 className={styles.settingsHeadLabel} data-testid="card-types-heading">{l10n.t('Card types')}</h4>
                </div>
                <div className={styles.settingsHeadRows}>
                    <h4 className={styles.settingsHeadLabel} data-testid="card-settings-heading">{l10n.t('Card settings')}</h4>
                    <h3 className={styles.settingsDrawerTitle}>{l10n.t('Card')}</h3>
                </div>
                <div className={styles.settingsTreePane}>
                    <DrawerTree nodes={tree_nodes} testId="settings-card-tree" ariaLabel={l10n.t('Card type')} />
                </div>
                <div className={styles.settingsRowsPane}>
                    <CardSettingsPane
                        rows={rows}
                        selectedNode={selected_node}
                        settings={props.settings}
                        cardOverrides={card_overrides}
                        diverged={props.diverged}
                        onRowChange={handle_row_change}
                    />
                    <DivergedCount count={diverged_count} />
                </div>
            </div>
        </div>
    );
}

export default React.memo(SettingsCardDrawer);

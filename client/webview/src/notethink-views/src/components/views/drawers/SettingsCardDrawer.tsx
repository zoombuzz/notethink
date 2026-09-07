import Debug from "debug";
import React, { useCallback, useMemo, useState } from "react";
import * as l10n from "@vscode/l10n";
import type { ReactNode } from "react";
import {
    CARD_AUTO,
    CARD_REGISTRY,
    childCardNodes,
    getCardNode,
    owningCardNodeFor,
    type CardNode,
} from "../../notes/cardregistryops";
import { nodeSettingCount } from "../../../lib/viewregistryops";
import type { SettingsCascadeKey, SettingsCascadePayload } from "../../../types/Messages";
import styles from "../../ViewRenderer.module.scss";
import SettingsRow from "../SettingsRow";
import { viewTypeLabel } from "../viewTypeLabel";
import { CARD_SETTING_ROWS, cardRowsForNode, divergedCountLabel, settingRowLabel, type SettingRowDef, type SettingRowValues } from "../settingRows";
import DrawerTree, { type DrawerTreeNode } from "./DrawerTree";

const debug = Debug("nodejs:notethink-views:SettingsCardDrawer");

/**
 * The card settings drawer: the card-type tree on the left, the selected type's settings on the right.
 *
 * The card axis's half of the same drawer the view axis already has, and deliberately the same shape - a
 * reader who has learned one tab has learned the other. The tree is the card-type selector, and the two
 * marks a row can carry are independent here too: a radio pins the card every note draws as, while the
 * highlight says whose settings the right pane is showing.
 *
 * What differs is only what the tree is made of. A card node carries no fixed or open override model, so
 * a row's owner is a flat home lookup rather than a chain resolution.
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
    onSettingChange: (key: SettingsCascadeKey, value: unknown) => void;
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

/** the pill's text for a row, or undefined when the row belongs to no card type and so shows none */
function ownerLabelFor(def: SettingRowDef): string | undefined {
    const owner_id = owningCardNodeFor(def.key);
    if (owner_id === undefined) { return undefined; }
    const owner = getCardNode(owner_id);
    return owner ? cardNodeLabel(owner) : owner_id;
}

interface CardRowControlProps {
    def: SettingRowDef;
    value: unknown;
    onChange: (def: SettingRowDef, value: unknown) => void;
}

/**
 * The third column's control for one card row. Every card setting is a boolean today, so the switch has
 * a single arm; it is the extension point a card setting needing a select adds to, not a shape to
 * collapse into a bare checkbox.
 */
function CardRowControl(props: CardRowControlProps): React.ReactElement {
    switch (props.def.control) {
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
    counted_settings: Partial<SettingsCascadePayload>;
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

interface CardSettingsPaneProps {
    rows: SettingRowDef[];
    settings: SettingRowValues;
    diverged: string[];
    onRowChange: (def: SettingRowDef, value: unknown) => void;
}

/**
 * The right pane: one four-column grid holding the selected node's chain rows, so the names and controls
 * stay aligned down the whole list. The columns carry no heads of their own - the "Card settings" heading
 * above the pane says what the rows are. There is no Global settings group here: a global belongs to no
 * tree, and the view pane is where it is listed.
 */
function CardSettingsPane(props: CardSettingsPaneProps): React.ReactElement {
    return (
        <div className={styles.settingsRowGrid} data-testid="card-settings-rows">
            {props.rows.map(def => (
                <SettingsRow
                    key={def.key}
                    rowKey={def.key}
                    label={settingRowLabel(def.key)}
                    ownerLabel={ownerLabelFor(def)}
                    diverged={props.diverged.includes(def.key)}
                    control={
                        <CardRowControl
                            def={def}
                            value={props.settings[def.key] ?? def.fallback}
                            onChange={props.onRowChange}
                        />
                    }
                />
            ))}
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
function countedSettings(settings: SettingRowValues): Partial<SettingsCascadePayload> {
    const narrowed: Record<string, unknown> = {};
    for (const def of CARD_SETTING_ROWS) {
        if (def.key in settings) { narrowed[def.key] = settings[def.key]; }
    }
    return narrowed as Partial<SettingsCascadePayload>;
}

function SettingsCardDrawer(props: SettingsCardDrawerProps): React.ReactElement {
    const [picked_node, setPickedNode] = useState<string | undefined>(undefined);
    const selected_node = resolveSelectedNode(picked_node, props.resolvedCardType);
    const { onCardTypeChange, onSettingChange } = props;
    const handle_pick_type = useCallback((card_type: string): void => {
        onCardTypeChange(card_type);
        if (card_type !== CARD_AUTO) { setPickedNode(card_type); }
    }, [onCardTypeChange]);
    const handle_row_change = useCallback((def: SettingRowDef, value: unknown): void => {
        onSettingChange(def.key, value);
    }, [onSettingChange]);
    const rows = useMemo(() => cardRowsForNode(selected_node), [selected_node]);
    const diverged_count = rows.filter(def => props.diverged.includes(def.key)).length;
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
                        settings={props.settings}
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

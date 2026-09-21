import Debug from "debug";
import React, { useCallback, useMemo, useState } from "react";
import * as l10n from "@vscode/l10n";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";
import type { ReactNode } from "react";
import { formatColumnLabel, mergeSavedColumnOrder, moveInOrder } from "../../../lib/noteops";
import {
    VIEW_REGISTRY,
    childViewNodes,
    getViewNode,
    nodeSettingCount,
    offersNewViewType,
    owningNodeFor,
    registryWithUserTypes,
    removeUserViewType,
    renameUserViewType,
    settingWriteFor,
    updateUserViewTypeOverrides,
    userTypeHoldsKey,
    type ViewNode,
    type ViewRegistry,
} from "../../../lib/viewregistryops";
import type { SettingsCascadeKey, SettingsCascadePayload, UserViewType } from "../../../types/Messages";
import styles from "../../ViewRenderer.module.scss";
import { CARD_RATIOS, DEFAULT_CARD_RATIO, clampBreadth, parseBreadthInput } from "../kanban/columnwidthops";
import { useBreadthDraft } from "../kanban/useBreadthDraft";
import { DEFAULT_CARD_TYPE, renderableCardIds } from "../../notes/cardregistryops";
import GroupBySelector from "../GroupBySelector";
import SettingsRow from "../SettingsRow";
import { viewTypeLabel } from "../viewTypeLabel";
import { divergedCountLabel, globalSettingRows, settingRowLabel, viewRowsForNode, VIEW_SETTING_ROWS, type SettingRowDef, type SettingRowValues } from "../settingRows";
import DrawerTree, { type DrawerTreeNode } from "./DrawerTree";

const debug = Debug("nodejs:notethink-views:SettingsViewDrawer");

declare const NOTETHINK_VERSION: string | undefined;

// the id standing for "no type pinned, resolve per file": a selection, never a node
const AUTO_TYPE = 'auto';

/**
 * The view settings drawer: the view-type tree on the left, the selected type's settings on the right.
 *
 * One drawer serves every view. The tree is the type selector, so a document view reaches kanban the
 * same way a kanban board reaches document, and the two marks a row can carry are independent - a radio
 * switches the board and exists only on a type that can render, while the highlight says whose settings
 * the right pane is showing and exists on every node, including the abstract ones that own settings but
 * render nothing.
 * - settings: the resolved cascade block, read for every control's value
 * - diverged: the cascade keys differing from their saved default, which is what marks a row M
 * - userTypes: the view types the user minted, merged into the registry so they appear in the tree
 * - currentType: the concrete type the board renders, which is where the highlight starts
 * - viewTypeSelection: the persisted choice the radios reflect, `auto` when nothing is pinned
 */
export interface SettingsViewDrawerProps {
    viewId: string;
    settings: SettingRowValues;
    diverged: string[];
    userTypes: UserViewType[];
    currentType: string;
    viewTypeSelection: string;
    autoResolvedType?: string;
    onViewTypeChange: (view_type: string) => void;
    onSettingChange: (key: SettingsCascadeKey, value: unknown) => void;
    naturalColumnOrder: string[];
    onColumnOrderChange: (next_order: string[]) => void;
    groupByResolvedKey: string;
    groupByCandidateKeys: string[];
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    canResetToDefault?: boolean;
}

/**
 * A node's display name. Root is the whole tree rather than a type anyone would call "Root", so it is
 * relabelled; every other node goes through the shared `viewTypeLabel` against the merged registry, so
 * a minted type reads as the name its author typed rather than the slug it is stored under, and the
 * tree, the pills and the toolbar tab can never word the same type differently.
 */
function nodeLabel(node: ViewNode, registry: ViewRegistry): string {
    if (node.parent === undefined) { return l10n.t('All views'); }
    return viewTypeLabel(node.id, undefined, registry);
}

/** the pill's text for a row, or undefined when the row belongs to no view type and so shows none */
function ownerLabelFor(selected_node: string, def: SettingRowDef, registry: ViewRegistry): string | undefined {
    const owner_id = owningNodeFor(selected_node, def.key, registry);
    if (owner_id === undefined) { return undefined; }
    const owner = getViewNode(owner_id, registry);
    return owner ? nodeLabel(owner, registry) : owner_id;
}

/**
 * The id a minted view type is written to settings.json under. Derived from the label once and frozen
 * there, because it is a permanent name on a user's disk: rewriting it later would orphan every setting
 * saved against the old one. The `user-` prefix keeps the space of minted ids disjoint from the built-in
 * rungs, and a numeric suffix settles the case where two saves produce the same slug.
 */
export function mintUserViewTypeId(label: string, registry: ViewRegistry): string {
    const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const base = `user-${slug.length > 0 ? slug : 'view'}`;
    let candidate = base;
    let suffix = 2;
    while (registry.nodes.some(n => n.id === candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}

/**
 * The name the save form opens pre-filled with: the node the user is looking at plus what they changed,
 * so the offer that follows a group-by change reads "Kanban by Assignee". A boolean has no value worth
 * naming, so it names the setting instead and says which way it went.
 */
export function newViewTypeNameHint(node_label: string, def: SettingRowDef, value: unknown): string {
    if (typeof value === 'boolean') {
        return value
            ? l10n.t('{0} with {1}', node_label, settingRowLabel(def.key))
            : l10n.t('{0} without {1}', node_label, settingRowLabel(def.key));
    }
    return l10n.t('{0} by {1}', node_label, formatColumnLabel(String(value)));
}

interface ColumnOrderControlProps {
    viewId: string;
    saved: string[];
    natural: string[];
    onReorder: (next_order: string[]) => void;
}

/**
 * The lane order editor: one draggable chip per lane, stacked in board order. Laying them out left to
 * right would mirror the board, and it does not fit - the control column runs out before five lanes do -
 * so the list reads top to bottom instead. Every column the board shows must be reorderable, which is
 * what `mergeSavedColumnOrder` guarantees: a status added since the order was saved would otherwise be
 * unreachable here.
 *
 * Drag comes from the same library the board drags cards with, so a chip is keyboard-reorderable for
 * free (space to lift, arrows to move, space to drop) and needs no pair of nudge buttons beside it. There
 * is deliberately no reset: no other row in this drawer carries one, and the revert under Change
 * defaults is the one place a change is undone wholesale.
 */
function ColumnOrderControl(props: ColumnOrderControlProps): React.ReactElement {
    const ordered = mergeSavedColumnOrder(props.saved, props.natural);
    const handleDragEnd = (result: DropResult): void => {
        if (!result.destination) { return; }
        const next = moveInOrder(ordered, result.source.index, result.destination.index);
        if (next !== ordered) { props.onReorder(next); }
    };
    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId={`v${props.viewId}-column-order`}>
                {(provided_drop) => (
                    <div
                        className={styles.settingsDrawerColumnOrder}
                        data-testid="setting-control-columnOrder"
                        ref={provided_drop.innerRef}
                        {...provided_drop.droppableProps}
                    >
                        {ordered.map((column_name, index) => {
                            const formatted_label = formatColumnLabel(column_name);
                            return (
                                <Draggable key={column_name} draggableId={`column-${column_name}`} index={index}>
                                    {(provided_drag) => (
                                        <span
                                            className={styles.settingsDrawerColumnChip}
                                            data-testid={`column-order-chip-${column_name}`}
                                            ref={provided_drag.innerRef}
                                            {...provided_drag.draggableProps}
                                            {...provided_drag.dragHandleProps}
                                            style={provided_drag.draggableProps.style as React.CSSProperties | undefined}
                                            aria-label={l10n.t('Reorder {0}', formatted_label)}
                                        >
                                            <span className={styles.settingsDrawerColumnGrip} aria-hidden="true">&#8942;&#8942;</span>
                                            {formatted_label}
                                        </span>
                                    )}
                                </Draggable>
                            );
                        })}
                        {provided_drop.placeholder}
                    </div>
                )}
            </Droppable>
        </DragDropContext>
    );
}

interface RowControlProps {
    viewId: string;
    def: SettingRowDef;
    value: unknown;
    groupByResolvedKey: string;
    groupByCandidateKeys: string[];
    naturalColumnOrder: string[];
    orientation: unknown;
    onChange: (def: SettingRowDef, value: unknown) => void;
}

/**
 * The lane breadth as a pixel text box, the non-drag path to the number a lane boundary sets. It follows a
 * drag live by reading the shared draft, and writes only when the user commits: Enter or leaving the box.
 * Something that is not a number is dropped and the box goes back to the setting, and a number under the
 * floor is held to it.
 */
function BreadthControl(props: { viewId: string; value: unknown; label: string; onCommit: (breadth: number) => void }): React.ReactElement {
    const draft = useBreadthDraft(props.viewId);
    const saved = clampBreadth(props.value);
    const [text, setText] = useState<string | undefined>(undefined);
    const commit = (): void => {
        if (text === undefined) { return; }
        const parsed = parseBreadthInput(text);
        setText(undefined);
        if (parsed !== undefined && parsed !== saved) { props.onCommit(parsed); }
    };
    return (
        <input
            type="text"
            inputMode="numeric"
            className={styles.settingsBreadthInput}
            data-testid="setting-control-lineBreadth"
            value={text ?? String(draft ?? saved)}
            aria-label={props.label}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { commit(); }
                if (e.key === 'Escape') { setText(undefined); }
            }}
        />
    );
}

function CardRatioControl(props: { value: unknown; label: string; onChange: (ratio: number) => void }): React.ReactElement {
    return (
        <select
            className={styles.settingsSelect}
            data-testid="setting-control-kanbanCardRatio"
            value={String(typeof props.value === 'number' ? props.value : DEFAULT_CARD_RATIO)}
            aria-label={props.label}
            title={l10n.t('Pick the height-to-width shape you want cards to land near: a card holding more than that shape allows clips its own body to reach it.')}
            onChange={(e) => props.onChange(Number(e.target.value))}
        >
            {CARD_RATIOS.map(ratio => (
                <option key={ratio} value={String(ratio)}>{l10n.t('1 : {0}', ratio.toFixed(1))}</option>
            ))}
        </select>
    );
}

/**
 * The third column's control for one row. Group by is editable wherever it is rendered, including from
 * a kanban board: the axis kanban pins is what makes it a kanban, so departing from it is a new view
 * type rather than a locked control, and the offer beneath the rows is how that departure is saved.
 */
function RowControl(props: RowControlProps): React.ReactElement {
    const def = props.def;
    switch (def.control) {
        case 'groupBy':
            return (
                <GroupBySelector
                    selection={typeof props.value === 'string' ? props.value : AUTO_TYPE}
                    resolvedKey={props.groupByResolvedKey}
                    candidateKeys={props.groupByCandidateKeys}
                    onChange={(group_by_key) => props.onChange(def, group_by_key)}
                />
            );
        case 'breadth':
            return (
                <BreadthControl
                    viewId={props.viewId}
                    value={props.value}
                    label={settingRowLabel(def.key, props.orientation)}
                    onCommit={(breadth) => props.onChange(def, breadth)}
                />
            );
        case 'cardRatio': return <CardRatioControl value={props.value} label={settingRowLabel(def.key)} onChange={(ratio) => props.onChange(def, ratio)} />;
        case 'cardType': {
            // the concrete cards only: a view's default is what Auto resolves to, so Auto itself is no answer
            const card_types = renderableCardIds();
            return (
                <select
                    className={styles.settingsSelect}
                    data-testid={`setting-control-${def.key}`}
                    value={typeof props.value === 'string' && card_types.includes(props.value) ? props.value : DEFAULT_CARD_TYPE}
                    aria-label={settingRowLabel(def.key)}
                    onChange={(e) => props.onChange(def, e.target.value)}
                >
                    {card_types.map(card_type => (
                        <option key={card_type} value={card_type}>{viewTypeLabel(card_type)}</option>
                    ))}
                </select>
            );
        }
        case 'orientation':
            return (
                <select
                    className={styles.settingsSelect}
                    data-testid="setting-control-orientation"
                    value={props.value === 'rows' ? 'rows' : 'columns'}
                    aria-label={l10n.t('Orientation')}
                    onChange={(e) => props.onChange(def, e.target.value)}
                >
                    <option value="columns">{l10n.t('Columns')}</option>
                    <option value="rows">{l10n.t('Rows')}</option>
                </select>
            );
        case 'columnOrder':
            return (
                <ColumnOrderControl
                    viewId={props.viewId}
                    saved={Array.isArray(props.value) ? props.value as string[] : []}
                    natural={props.naturalColumnOrder}
                    onReorder={(next_order) => props.onChange(def, next_order)}
                />
            );
        case 'checkbox':
        default:
            return (
                <input
                    type="checkbox"
                    data-testid={`setting-control-${def.key}`}
                    checked={props.value === true}
                    aria-label={settingRowLabel(def.key)}
                    onChange={(e) => props.onChange(def, e.target.checked)}
                />
            );
    }
}

/**
 * What the tree builder needs to draw a row: the registry it walks, the two independent marks, and the
 * two callbacks behind them. `radio_name` groups one drawer's radios, so two drawers on a page never
 * share a selection.
 */
interface TypeTreeContext {
    registry: ViewRegistry;
    selected_node: string;
    view_type_selection: string;
    auto_resolved_type?: string;
    counted_settings: Partial<SettingsCascadePayload>;
    radio_name: string;
    onHighlight: (node_id: string) => void;
    onPickType: (view_type: string) => void;
}

/**
 * The trailing slot on a tree row: the radio, then the count of settings that node owns.
 *
 * The radio appears on every type that can render, plus on the root, where it stands for `auto` - the
 * root owns the view-type setting and `auto` is precisely the state of having pinned nothing below it,
 * so putting the choice there keeps every selectable state reachable without inventing a pseudo-node.
 * An abstract node in the middle of the tree still gets none, so it reads as settings-only.
 */
function treeRowTrailing(node: ViewNode, ctx: TypeTreeContext): ReactNode {
    const is_root = node.parent === undefined;
    const radio_value = is_root ? AUTO_TYPE : node.id;
    const label = nodeLabel(node, ctx.registry);
    return (
        <>
            {(is_root || node.selectable) && (
                <input
                    type="radio"
                    name={ctx.radio_name}
                    data-testid={`view-radio-${radio_value}`}
                    checked={ctx.view_type_selection === radio_value}
                    aria-label={is_root ? viewTypeLabel(AUTO_TYPE, ctx.auto_resolved_type, ctx.registry) : l10n.t('Switch to {0}', label)}
                    onChange={() => ctx.onPickType(radio_value)}
                />
            )}
            <span className={styles.settingsTreeCount} data-testid={`view-node-count-${node.id}`}>
                {`(${nodeSettingCount(node.id, ctx.counted_settings)})`}
            </span>
        </>
    );
}

/** the whole registry as DrawerTree rows, recursing from `parent_id` (undefined for the tree's root) */
function buildTypeTreeNodes(parent_id: string | undefined, ctx: TypeTreeContext): DrawerTreeNode[] {
    return childViewNodes(parent_id, ctx.registry).map((node) => {
        const children = buildTypeTreeNodes(node.id, ctx);
        return {
            id: node.id,
            testId: `view-node-${node.id}`,
            label: nodeLabel(node, ctx.registry),
            glyph: children.length > 0 ? '›' : '',
            expanded: children.length > 0 ? true : undefined,
            kind: node.selectable ? 'selectable' : 'abstract',
            current: node.id === ctx.selected_node,
            disabled: !node.selectable && !node.configurable,
            trailing: treeRowTrailing(node, ctx),
            children: children.length > 0 ? children : undefined,
            onSelect: () => ctx.onHighlight(node.id),
        };
    });
}

interface SettingsPaneProps {
    viewId: string;
    rows: SettingRowDef[];
    globalRows: SettingRowDef[];
    selectedNode: string;
    registry: ViewRegistry;
    settings: SettingRowValues;
    diverged: string[];
    naturalColumnOrder: string[];
    groupByResolvedKey: string;
    groupByCandidateKeys: string[];
    onRowChange: (def: SettingRowDef, value: unknown) => void;
}

/**
 * The right pane: one four-column grid holding the selected node's chain rows and then the global rows
 * under their own heading. Everything sits in a single grid so the two groups share one set of column
 * widths and the names and controls stay aligned across the heading. The columns carry no heads of their
 * own - the "View settings" heading above the pane says what the rows are, and the pill column reads as
 * provenance unlabelled.
 */
function SettingsPane(props: SettingsPaneProps): React.ReactElement {
    const renderRow = (def: SettingRowDef, owner_label: string | undefined): React.ReactElement => (
        <SettingsRow
            key={def.key}
            rowKey={def.key}
            label={settingRowLabel(def.key, props.settings.orientation)}
            ownerLabel={owner_label}
            diverged={props.diverged.includes(def.key)}
            control={
                <RowControl
                    viewId={props.viewId}
                    def={def}
                    value={props.settings[def.key] ?? def.fallback}
                    groupByResolvedKey={props.groupByResolvedKey}
                    groupByCandidateKeys={props.groupByCandidateKeys}
                    naturalColumnOrder={props.naturalColumnOrder}
                    orientation={props.settings.orientation}
                    onChange={props.onRowChange}
                />
            }
        />
    );
    return (
        <div className={styles.settingsRowGrid} data-testid="settings-rows">
            {props.rows.map(def => renderRow(def, ownerLabelFor(props.selectedNode, def, props.registry)))}
            {props.globalRows.length > 0 && (
                <div className={styles.settingsGroupHeading} data-testid="global-settings-heading">{l10n.t('Global settings')}</div>
            )}
            {props.globalRows.map(def => renderRow(def, undefined))}
        </div>
    );
}

interface NewTypeOfferProps {
    def: SettingRowDef;
    ownerLabel: string | undefined;
    nameHint: string;
    updateTypeLabel?: string;
    onUpdate?: () => void;
    onSave: (label: string) => void;
}

/**
 * The sentence above the offer's buttons: which setting moved, which type up the tree owns it, and what
 * can be done about it. Two literals rather than one assembled from parts, because `vscode-l10n-dev
 * export` reads `l10n.t('...')` statically and a sentence stitched together would never reach the bundle.
 */
function offerReason(def: SettingRowDef, owner_label: string | undefined, update_type_label: string | undefined): string {
    const owner = owner_label ?? l10n.t('another view type');
    if (update_type_label === undefined) {
        return l10n.t('{0} is owned by {1}. Save your change as a new view type to keep it without altering the type it came from.', settingRowLabel(def.key), owner);
    }
    return l10n.t('{0} is owned by {1}. Update {2} to keep the change in it, or save it as a new view type instead.', settingRowLabel(def.key), owner, update_type_label);
}

/**
 * The offer to keep a change that landed on a setting an ancestor owns. It leads with WHY - which setting
 * moved and which type up the tree owns it - because the bare button that shipped first asked a question
 * nothing on screen answered. On a type the user owns there are two ways to keep the change, and updating
 * the type they are standing on leads, because minting a second type beside it is the larger act. The name
 * is taken inline rather than through `window.prompt`, which a VS Code webview does not honour, and opens
 * pre-filled so accepting is one click.
 */
function NewTypeOffer(props: NewTypeOfferProps): React.ReactElement {
    const [draft, setDraft] = useState<string | undefined>(undefined);
    return (
        <div className={styles.settingsNewTypeOffer} data-testid="new-view-type-offer">
            <p className={styles.settingsCustomTypesNote} data-testid="new-view-type-reason">
                {offerReason(props.def, props.ownerLabel, props.updateTypeLabel)}
            </p>
            {draft === undefined ? (
                <div className={styles.settingsCustomTypesRow}>
                    {props.onUpdate !== undefined && (
                        <button type="button" data-testid="user-view-type-update" onClick={props.onUpdate}>
                            {l10n.t('Update this view type')}
                        </button>
                    )}
                    <button type="button" data-testid="new-view-type-open" onClick={() => setDraft(props.nameHint)}>
                        {l10n.t('Save as a new view type')}
                    </button>
                </div>
            ) : (
                <div className={styles.settingsCustomTypesRow}>
                    <label>
                        {l10n.t('Name the new view type')}
                        {' '}
                        <input
                            type="text"
                            className={styles.settingsNewTypeName}
                            data-testid="new-view-type-name"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                        />
                    </label>
                    <button type="button" data-testid="new-view-type-save" disabled={draft.trim().length === 0} onClick={() => props.onSave(draft)}>
                        {l10n.t('Save')}
                    </button>
                    <button type="button" data-testid="new-view-type-cancel" onClick={() => setDraft(undefined)}>
                        {l10n.t('Cancel')}
                    </button>
                </div>
            )}
        </div>
    );
}

interface UserTypeControlsProps {
    userType: UserViewType;
    onRename: (id: string, label: string) => void;
    onDelete: (id: string) => void;
}

/**
 * Rename and delete, offered on a minted type and on nothing else - a built-in rung is not the user's to
 * remove. Renaming changes only what the tree shows: the id stays frozen, because it is what every
 * setting saved against the type is stored under. Deleting asks twice rather than through
 * `window.confirm`, which a VS Code webview does not honour either.
 */
function UserTypeControls(props: UserTypeControlsProps): React.ReactElement {
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const [confirming, setConfirming] = useState(false);
    const type = props.userType;
    const pending = (draft ?? type.label).trim();
    return (
        <div className={styles.settingsCustomTypesRow} data-testid="user-view-type-controls">
            <label>
                {l10n.t('Name')}
                {' '}
                <input
                    type="text"
                    className={styles.settingsNewTypeName}
                    data-testid="user-view-type-name"
                    value={draft ?? type.label}
                    onChange={(e) => setDraft(e.target.value)}
                />
            </label>
            <button
                type="button"
                data-testid="user-view-type-rename"
                disabled={pending.length === 0 || pending === type.label}
                onClick={() => { props.onRename(type.id, pending); setDraft(undefined); }}
            >
                {l10n.t('Rename view type')}
            </button>
            {confirming ? (
                <>
                    <button type="button" data-testid="user-view-type-delete-confirm" onClick={() => { props.onDelete(type.id); setConfirming(false); }}>
                        {l10n.t('Delete {0}', type.label)}
                    </button>
                    <button type="button" data-testid="user-view-type-delete-cancel" onClick={() => setConfirming(false)}>
                        {l10n.t('Cancel')}
                    </button>
                </>
            ) : (
                <button type="button" data-testid="user-view-type-delete" onClick={() => setConfirming(true)}>
                    {l10n.t('Delete view type')}
                </button>
            )}
        </div>
    );
}

interface CustomViewTypesDisclosureProps {
    offerRows: SettingRowDef[];
    offerOwnerLabel: string | undefined;
    nameHint: string;
    overrides: Record<string, unknown>;
    selectedUserType: UserViewType | undefined;
    onSave: (label: string, overrides: Record<string, unknown>) => void;
    onUpdate: (overrides: Record<string, unknown>) => void;
    onRename: (id: string, label: string) => void;
    onDelete: (id: string) => void;
}

/**
 * Everything about the user's own view types, behind one disclosure under Change defaults: what they are,
 * the offer to mint one, and the controls for the one currently selected.
 *
 * The two disclosures are deliberately the same shape, because they answer the same kind of question -
 * something here changes state beyond this board, and the reader should have to open it before it can.
 * This one opens itself when an offer arrives, since an offer nobody can see is not an offer, and stays
 * wherever the reader leaves it afterwards. The caller renders it only when it holds something, so it is
 * never an empty panel explaining a feature the reader cannot reach from where they are standing.
 */
function CustomViewTypesDisclosure(props: CustomViewTypesDisclosureProps): React.ReactElement {
    const offer = props.offerRows[0];
    /*
     * Open by default whenever there is an offer, and wherever the reader last put it once they have said.
     * No effect syncing one to the other: the caller keys this component on the set of reasons, so a fresh
     * offer is a fresh component with the preference unset again.
     */
    const [reader_open, setReaderOpen] = useState<boolean | undefined>(undefined);
    const open = reader_open ?? offer !== undefined;
    return (
        <details
            className={styles.settingsCustomTypes}
            data-testid="custom-view-types"
            open={open}
            onToggle={(e) => setReaderOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary data-testid="custom-view-types-summary">
                <span className={styles.settingsChangeDefaultsLabel}>{l10n.t('Custom view types')}</span>
            </summary>
            <div className={styles.settingsDisclosureBody}>
                <p className={styles.settingsDivergedNote}>
                    {l10n.t('A custom view type is a built-in one plus your own settings. It sits in the tree beside the type it came from and can be switched to like any other.')}
                </p>
                {offer !== undefined && (
                    <NewTypeOffer
                        def={offer}
                        ownerLabel={props.offerOwnerLabel}
                        nameHint={props.nameHint}
                        updateTypeLabel={props.selectedUserType?.label}
                        onUpdate={props.selectedUserType === undefined ? undefined : () => props.onUpdate(props.overrides)}
                        onSave={(label) => props.onSave(label, props.overrides)}
                    />
                )}
                {props.selectedUserType !== undefined && (
                    <UserTypeControls key={props.selectedUserType.id} userType={props.selectedUserType} onRename={props.onRename} onDelete={props.onDelete} />
                )}
            </div>
        </details>
    );
}

interface ChangeDefaultsDisclosureProps {
    divergedCount: number;
    onMakeDefault: () => void;
    onResetToDefault: () => void;
    canResetToDefault?: boolean;
}

/**
 * The two default actions, collapsed behind one disclosure so the pane leads with the settings rather
 * than with a row of buttons. Both drive the diverged count to zero: saving promotes every value to the
 * user scope, reverting clears the workspace scope, and each is disabled while it would do nothing -
 * saving needs something to have diverged, reverting needs a workspace override to clear. The panel
 * therefore never offers an action it cannot carry out, which is what the tally beside its name is for.
 * Restoring the built-in defaults is deliberately not here - it stays in the Files drawer, which is where
 * a wiped filter has to be recoverable from.
 */
function ChangeDefaultsDisclosure(props: ChangeDefaultsDisclosureProps): React.ReactElement {
    return (
        <details className={styles.settingsChangeDefaults} data-testid="change-defaults">
            <summary data-testid="change-defaults-summary">
                <span className={styles.settingsChangeDefaultsLabel}>{l10n.t('Change defaults')}</span>
                {' '}
                <span className={styles.settingsDivergedTally} data-testid="diverged-count">
                    ({divergedCountLabel(props.divergedCount)})
                </span>
            </summary>
            <div className={styles.settingsDisclosureBody}>
                <p className={styles.settingsDivergedNote}>
                    {props.divergedCount === 0
                        ? l10n.t('Nothing here differs from your saved defaults.')
                        : l10n.t('Settings diverged from the defaults and are already saved')}
                </p>
                <div className={styles.settingsDisclosureActions}>
                <button
                    type="button"
                    data-testid="save-as-default"
                    onClick={props.onMakeDefault}
                    disabled={props.divergedCount === 0}
                    title={l10n.t('Save every current setting as your default across every VS Code window.')}
                >
                    {l10n.t('Save as user default')}
                </button>
                <button
                    type="button"
                    data-testid="revert-to-defaults"
                    onClick={props.onResetToDefault}
                    disabled={!props.canResetToDefault}
                    title={l10n.t("Clear this workspace's overrides and fall back to your defaults.")}
                    >
                        {l10n.t('Revert to user default')}
                    </button>
                </div>
            </div>
        </details>
    );
}

/** the version line closing the drawer, right-aligned under the title so the two read as one corner column */
function DrawerVersionLine(): React.ReactElement {
    return (
        <p className={styles.settingsDrawerVersion} data-testid="version-label">
            NoteThink v{typeof NOTETHINK_VERSION !== 'undefined' ? NOTETHINK_VERSION : 'dev'}
            {' '}(ext: {(window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ as string || '?'})
        </p>
    );
}

/** the node whose settings the right pane shows: the user's pick while it names a real node, else the rendered view */
function resolveSelectedNode(picked: string | undefined, current_type: string, registry: ViewRegistry): string {
    if (picked !== undefined && getViewNode(picked, registry) !== undefined) { return picked; }
    if (getViewNode(current_type, registry) !== undefined) { return current_type; }
    return VIEW_REGISTRY.nodes[0].id;
}

/**
 * The rows that make this board something other than its parent: the ones that differ from their saved
 * default AND belong to a type above the selected node. Those are exactly the departures a new view type
 * would capture, so they are the reasons to offer minting one.
 *
 * Asked of the settings rather than remembered from a click, which is the whole point. The offer used to
 * be a note of the row the user last touched, so a board reopened with orientation already on rows had
 * nothing to remember and made no offer until the control was touched again.
 */
function useOfferRows(rows: SettingRowDef[], diverged: string[], selected_node: string, registry: ViewRegistry): SettingRowDef[] {
    return useMemo(
        () => rows.filter(def => diverged.includes(def.key) && offersNewViewType(selected_node, def.key, registry)),
        [rows, diverged, selected_node, registry],
    );
}

/** the cascade narrowed to the keys this drawer renders, so a node's count states what clicking it shows */
function countedSettings(settings: SettingRowValues): Partial<SettingsCascadePayload> {
    const narrowed: Record<string, unknown> = {};
    for (const def of VIEW_SETTING_ROWS) {
        if (def.key in settings) { narrowed[def.key] = settings[def.key]; }
    }
    return narrowed as Partial<SettingsCascadePayload>;
}

/**
 * The drawer's own state, which is now one thing: which node the pane is showing.
 *
 * The offer to mint a view type used to live here too, as a note of the row the user last touched. That
 * was the wrong shape and it showed: a board reopened with an ancestor-owned setting already diverged had
 * nothing to remember, so the offer that should have been standing was simply absent until the user
 * touched the control again. It is a question about the settings, not about the session, and it is asked
 * of them directly in the component.
 *
 * The highlight is a pick over the rendered type rather than a copy of it, so it follows the board until
 * the user disagrees and stays put afterwards, and a pick naming a node the registry has since dropped
 * falls back rather than stranding the pane.
 */
interface SettingsDrawerSelection {
    selected_node: string;
    selected_user_type: UserViewType | undefined;
    handle_highlight: (node_id: string) => void;
    handle_pick_type: (view_type: string) => void;
    handle_row_change: (def: SettingRowDef, value: unknown) => void;
    handle_save_new_type: (label: string, overrides: Record<string, unknown>) => void;
    handle_update_type: (overrides: Record<string, unknown>) => void;
    handle_rename_type: (id: string, label: string) => void;
    handle_delete_type: (id: string) => void;
}

function useSettingsDrawerSelection(props: SettingsViewDrawerProps, registry: ViewRegistry): SettingsDrawerSelection {
    const [picked_node, setPickedNode] = useState<string | undefined>(undefined);
    const selected_node = resolveSelectedNode(picked_node, props.currentType, registry);
    const { onViewTypeChange, onSettingChange, onColumnOrderChange, userTypes } = props;
    const selected_user_type = userTypes.find(type => type.id === selected_node);
    const handle_highlight = useCallback((node_id: string): void => {
        setPickedNode(node_id);
    }, []);
    const handle_pick_type = useCallback((view_type: string): void => {
        onViewTypeChange(view_type);
        if (view_type !== AUTO_TYPE) { setPickedNode(view_type); }
    }, [onViewTypeChange]);
    /*
     * A row the selected type already holds is written into that type, because a workspace write to such a
     * key is written, ignored and then painted over: the type's overrides layer over the whole cascade when
     * the board renders. That is what made the control snap back to the type's value on the next echo.
     */
    const handle_row_change = useCallback((def: SettingRowDef, value: unknown): void => {
        if (selected_user_type !== undefined && userTypeHoldsKey(selected_user_type, def.key)) {
            const write = settingWriteFor(userTypes, selected_user_type, def.key, value);
            onSettingChange(write.setting, write.value);
            return;
        }
        if (def.control === 'columnOrder') {
            onColumnOrderChange(value as string[]);
        } else {
            onSettingChange(def.key, value);
        }
    }, [onColumnOrderChange, onSettingChange, selected_user_type, userTypes]);
    /*
     * Saving is three writes, not one, because a minted type only means anything once the board renders as
     * it: `applyUserTypeOverrides` layers a type's overrides while walking the RENDERED type's chain, so a
     * type that is saved and not pinned contributes nothing. And the values have to come off the parent -
     * the offer promises to keep the change "without altering the type it came from", which is only true
     * once the workspace scope is cleared. Leaving them behind kept the row diverged, kept the offer
     * standing over a change it had already captured, and minted a duplicate on the next save.
     */
    const handle_save_new_type = useCallback((label: string, overrides: Record<string, unknown>): void => {
        const keys = Object.keys(overrides) as SettingsCascadeKey[];
        if (keys.length === 0) { return; }
        const minted: UserViewType = {
            id: mintUserViewTypeId(label, registry),
            label: label.trim(),
            parent: selected_node,
            overrides,
        };
        onSettingChange('viewUserTypes', [...userTypes, minted]);
        onViewTypeChange(minted.id);
        for (const key of keys) { onSettingChange(key, undefined); }
        setPickedNode(minted.id);
    }, [registry, selected_node, onSettingChange, onViewTypeChange, userTypes]);
    /*
     * Updating is the same shape as minting, less the mint: the diverged values move into the selected
     * type's overrides and then off the workspace scope, which is the only thing that makes them the
     * type's rather than this workspace's. The board is pinned to the type when it is showing something
     * else, because a type's overrides apply only while it is the type being rendered.
     */
    const handle_update_type = useCallback((overrides: Record<string, unknown>): void => {
        const keys = Object.keys(overrides) as SettingsCascadeKey[];
        if (selected_user_type === undefined || keys.length === 0) { return; }
        onSettingChange('viewUserTypes', updateUserViewTypeOverrides(userTypes, selected_user_type.id, overrides));
        if (props.viewTypeSelection !== selected_user_type.id) { onViewTypeChange(selected_user_type.id); }
        for (const key of keys) { onSettingChange(key, undefined); }
    }, [onSettingChange, onViewTypeChange, props.viewTypeSelection, selected_user_type, userTypes]);
    const handle_rename_type = useCallback((id: string, label: string): void => {
        onSettingChange('viewUserTypes', renameUserViewType(userTypes, id, label));
    }, [onSettingChange, userTypes]);
    /*
     * Deleting the type the board is rendering would leave the view-type setting naming a node the registry
     * no longer builds, so the selection is handed back to the parent in the same act. Falling through to
     * `auto` would be a second, invisible decision about what the board should show.
     */
    const handle_delete_type = useCallback((id: string): void => {
        const doomed = userTypes.find(type => type.id === id);
        onSettingChange('viewUserTypes', removeUserViewType(userTypes, id));
        if (props.viewTypeSelection === id) { onViewTypeChange(doomed?.parent ?? AUTO_TYPE); }
        setPickedNode(doomed?.parent);
    }, [onSettingChange, onViewTypeChange, props.viewTypeSelection, userTypes]);
    return {
        selected_node,
        selected_user_type,
        handle_highlight,
        handle_pick_type,
        handle_row_change,
        handle_save_new_type,
        handle_update_type,
        handle_rename_type,
        handle_delete_type,
    };
}

function SettingsViewDrawer(props: SettingsViewDrawerProps): React.ReactElement {
    const registry = useMemo(() => registryWithUserTypes(props.userTypes), [props.userTypes]);
    const drawer = useSettingsDrawerSelection(props, registry);
    const { selected_node, selected_user_type } = drawer;
    const chain_rows = useMemo(() => viewRowsForNode(selected_node, registry), [selected_node, registry]);
    const global_rows = useMemo(() => globalSettingRows(), []);
    const diverged_count = [...chain_rows, ...global_rows].filter(def => props.diverged.includes(def.key)).length;
    debug('selected=%s rows=%d diverged=%d', selected_node, chain_rows.length, diverged_count);
    const tree_nodes = buildTypeTreeNodes(undefined, {
        registry,
        selected_node,
        view_type_selection: props.viewTypeSelection,
        auto_resolved_type: props.autoResolvedType,
        counted_settings: countedSettings(props.settings),
        radio_name: `v${props.viewId}-view-type`,
        onHighlight: drawer.handle_highlight,
        onPickType: drawer.handle_pick_type,
    });
    const selected_label = nodeLabel(getViewNode(selected_node, registry) ?? registry.nodes[0], registry);
    const offer_rows = useOfferRows(chain_rows, props.diverged, selected_node, registry);
    return (
        <div className={`${styles.drawerBody} ${styles.settingsDrawerBody}`} data-testid="settings-drawer-view">
            <div className={styles.settingsPanes}>
                <div className={styles.settingsHeadTree}>
                    <h4 className={styles.settingsHeadLabel} data-testid="view-types-heading">{l10n.t('View types')}</h4>
                </div>
                <div className={styles.settingsHeadRows}>
                    <h4 className={styles.settingsHeadLabel} data-testid="view-settings-heading">{l10n.t('View settings')}</h4>
                    <h3 className={styles.settingsDrawerTitle}>{l10n.t('View')}</h3>
                </div>
                <div className={styles.settingsTreePane}>
                    <DrawerTree nodes={tree_nodes} testId="settings-type-tree" ariaLabel={l10n.t('View type')} />
                </div>
                <div className={styles.settingsRowsPane}>
                    <SettingsPane
                        viewId={props.viewId}
                        rows={chain_rows}
                        globalRows={global_rows}
                        selectedNode={selected_node}
                        registry={registry}
                        settings={props.settings}
                        diverged={props.diverged}
                        naturalColumnOrder={props.naturalColumnOrder}
                        groupByResolvedKey={props.groupByResolvedKey}
                        groupByCandidateKeys={props.groupByCandidateKeys}
                        onRowChange={drawer.handle_row_change}
                    />
                    <div className={styles.settingsDisclosures}>
                        <ChangeDefaultsDisclosure
                            divergedCount={diverged_count}
                            onMakeDefault={props.onMakeDefault}
                            onResetToDefault={props.onResetToDefault}
                            canResetToDefault={props.canResetToDefault}
                        />
                        {/* the panel earns its place only with something in it: an offer, or a type to rename or delete */}
                        {(offer_rows.length > 0 || selected_user_type !== undefined) && (
                        <CustomViewTypesDisclosure
                            /* a fresh set of reasons is a fresh offer, so the panel reopens and the name form starts over */
                            key={offer_rows.map(def => def.key).join('|') || 'none'}
                            offerRows={offer_rows}
                            offerOwnerLabel={offer_rows[0] && ownerLabelFor(selected_node, offer_rows[0], registry)}
                            nameHint={offer_rows[0] ? newViewTypeNameHint(selected_label, offer_rows[0], props.settings[offer_rows[0].key] ?? offer_rows[0].fallback) : ''}
                            overrides={Object.fromEntries(offer_rows.map(def => [def.key, props.settings[def.key] ?? def.fallback]))}
                            selectedUserType={selected_user_type}
                            onSave={drawer.handle_save_new_type}
                            onUpdate={drawer.handle_update_type}
                            onRename={drawer.handle_rename_type}
                            onDelete={drawer.handle_delete_type}
                        />
                        )}
                    </div>
                </div>
            </div>
            <DrawerVersionLine />
        </div>
    );
}

export default React.memo(SettingsViewDrawer);

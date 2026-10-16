import * as vscode from 'vscode';
import { DEFAULT_GROUP_DISPLAY, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER } from '../constants';
import { writeToLogAtLevel } from './errorops';

/**
 * Settings module: one canonical place to read, write and inspect every notethink setting.
 *
 * Every view- and card-tree setting has its own declared `notethink.settings.*` configuration key, one
 * per (node, key) pair: a value held at the top of a tree is `view.generic.<key>` / `card.generic.<key>`,
 * one held by any other built-in node is `view.specific.<node>.<key>` / `card.specific.<node>.<key>`, and
 * the two selections are `view.type` / `card.type`. `VIEW_NODE_KEYS` / `CARD_NODE_KEYS` below are the one
 * table naming which node declares which keys; `buildDeclaredSettingsContributions` derives every
 * `package.json` contribution from it, so the manifest cannot drift from what this module actually reads
 * and writes. A saved view type cannot declare its key in advance, so it stays in the `view.userTypes`
 * array instead, one entry per saved type (`{id, label, parent, overrides}`). A handful of settings
 * belong to no tree and stay individually declared flat keys (`FLAT_SETTINGS` below) - the two globals
 * and the three Files-drawer filters.
 *
 * `bagAt` assembles a VIRTUAL per-node map from the declared keys at one scope, reproducing the shape the
 * webview has always read (`notethink.settings.views` / `.cards` on the wire): one entry per node,
 * holding every value that node sets for itself. Nothing downstream of it - `mergedBag`, `readBagCell`,
 * `bagDivergedKeys`, `buildSettingsCascadePayload` - needed to change, because the wire shape never did;
 * only the storage underneath `bagAt` and `applyBagDelta` moved from two object-valued settings to one
 * key per node per setting.
 *
 * Every setting has exactly ONE write path (workspace scope, or Global in a folderless window) and ONE
 * comparison: "diverged" means differs from the saved default, where the saved default is the
 * user-scope value if one exists, else the built-in default. Both default actions drive diverged to zero.
 *
 * `CASCADE_KEY_DEFAULTS` mirrors the webview's SETTING_HOMES defaults (viewregistryops.ts) - the two are
 * separate webpack bundles with no shared module graph, so the one default per key is a deliberate
 * duplication rather than a second opinion. A view or card node's own built-in bag value (Kanban's own
 * Group by defaulting to status) is a webview-only resolution concern: the extension never defaults an
 * individual bag cell, it only assembles, merges and writes whatever is actually stored.
 */

/*
 * Owning-node sentinels, for settings that belong to no view or card type.
 * - NODE_GLOBAL: renders under the settings drawer's "Global settings" heading, with no owning-type pill
 * - NODE_FILES: belongs to the Files drawer
 */
export const NODE_GLOBAL = 'global';
export const NODE_FILES = 'files';

export interface GroupDisplayEntry {
    value: string;
    shown: boolean;
    axis?: string;
}

export type SettingsBag = 'views' | 'cards';

/** one single-cell (or whole-entry, when `key` is null) change inside a `views` or `cards` bag */
export interface BagCellOp {
    node_id: string;
    key: string | null;
    value: unknown;
}

interface FlatSettingSchema {
    type: 'string' | 'boolean' | 'integer';
    minimum?: number;
}

// the five settings that belong to no tree, each its own declared configuration key
export const FLAT_SETTINGS = {
    watchUnopenedFilesInViewer: { path: 'view.generic.watchUnopenedFilesInViewer', default: true as boolean,  node: NODE_GLOBAL, schema: { type: 'boolean' } as FlatSettingSchema },
    openNewEditorIfNoneOpen:    { path: 'view.generic.openNewEditorIfNoneOpen',    default: false as boolean, node: NODE_GLOBAL, schema: { type: 'boolean' } as FlatSettingSchema },
    includeFilter:              { path: 'files.includeFilter',   default: DEFAULT_INCLUDE_FILTER as string,   node: NODE_FILES,  schema: { type: 'string' } as FlatSettingSchema },
    excludeFilter:              { path: 'files.excludeFilter',   default: DEFAULT_EXCLUDE_FILTER as string,   node: NODE_FILES,  schema: { type: 'string' } as FlatSettingSchema },
    maxNotesPerFile:            { path: 'files.maxNotesPerFile', default: 10 as number,                       node: NODE_FILES,  schema: { type: 'integer', minimum: 1 } as FlatSettingSchema },
} as const;

export type FlatSettingKey = keyof typeof FLAT_SETTINGS;
type FlatSettingValue<K extends FlatSettingKey> = typeof FLAT_SETTINGS[K]['default'];

/**
 * The generic built-in default for every cascade key, declared-key-homed ones included - the baseline a
 * cell's divergence is measured against when nothing sits at the User scope. Mirrors the webview's
 * SETTING_HOMES default column one for one; a key's NODE-SPECIFIC built-in value (Kanban's own status
 * default) is not here, because it never changes what counts as diverged - the baseline is always the
 * key's own generic default, whichever node the cell belongs to. Also the set of keys every node table,
 * home table and schema table below is keyed against (`CascadeKey`).
 */
export const CASCADE_KEY_DEFAULTS = {
    viewType: 'auto',
    cardType: 'auto',
    showLinetagsInHeadlines: false,
    scrollNoteIntoView: true,
    autoExpandFocusedNote: false,
    showLineNumbers: false,
    groupBy: 'auto',
    orientation: 'columns',
    lineBreadth: 220,
    groupDisplay: DEFAULT_GROUP_DISPLAY,
    groupOrder: 'custom',
    cardRatio: 1.4,
    animateTransitions: true,
    defaultCardType: 'card',
    clockMode: 'active',
} as const satisfies Record<string, unknown>;

type CascadeKey = keyof typeof CASCADE_KEY_DEFAULTS;

/**
 * Which node id declares each per-tree key, for `VIEW_NODE_KEYS` / `CARD_NODE_KEYS` below: the one node
 * whose own declared key carries the generic built-in default; every other node that also declares the
 * key is a copy with no default, so unset means inherit.
 */
const CASCADE_KEY_HOME: Record<CascadeKey, string> = {
    viewType: 'root',
    scrollNoteIntoView: 'root',
    groupBy: 'grouped',
    groupDisplay: 'grouped',
    groupOrder: 'grouped',
    orientation: 'line',
    lineBreadth: 'line',
    cardRatio: 'kanban',
    animateTransitions: 'kanban',
    defaultCardType: 'kanban',
    cardType: 'allcards',
    showLinetagsInHeadlines: 'allcards',
    autoExpandFocusedNote: 'allcards',
    showLineNumbers: 'allcards',
    clockMode: 'agent',
};

/**
 * Every (node, key) pair declared on the view tree, in table order - the single source for storage, for
 * `buildDeclaredSettingsContributions`'s package.json output, and for the drift test that compares the
 * two. `root` is the tree's top (its own keys go under `view.generic.*`); every other node's keys go
 * under `view.specific.<node>.*`.
 */
const VIEW_NODE_KEYS: Record<string, CascadeKey[]> = {
    root: ['viewType', 'scrollNoteIntoView'],
    document: ['scrollNoteIntoView'],
    grouped: ['scrollNoteIntoView', 'groupBy', 'groupDisplay', 'groupOrder'],
    line: ['scrollNoteIntoView', 'groupBy', 'groupDisplay', 'groupOrder', 'orientation', 'lineBreadth'],
    kanban: ['scrollNoteIntoView', 'groupBy', 'groupDisplay', 'groupOrder', 'orientation', 'lineBreadth', 'cardRatio', 'animateTransitions', 'defaultCardType'],
};

// the card tree's equivalent of VIEW_NODE_KEYS; `allcards` is this tree's top, under `card.generic.*`
const CARD_NODE_KEYS: Record<string, CascadeKey[]> = {
    allcards: ['cardType', 'showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers'],
    card: ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers'],
    sticky: ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers'],
    agent: ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers', 'clockMode'],
};

interface CascadeKeySchema {
    type: 'string' | 'boolean' | 'number' | 'array';
    enum?: string[];
    minimum?: number;
    maximum?: number;
    items?: Record<string, unknown>;
}

const GROUP_DISPLAY_ITEMS = {
    type: 'object',
    required: ['value', 'shown'],
    properties: {
        value: { type: 'string' },
        shown: { type: 'boolean' },
        axis: { type: 'string' },
    },
};

/** the JSON-schema fragment (type, enum, minimum/maximum, items) every node declaring a key shares; only "default" varies by node */
const CASCADE_KEY_SCHEMA: Record<CascadeKey, CascadeKeySchema> = {
    viewType: { type: 'string' },
    cardType: { type: 'string' },
    showLinetagsInHeadlines: { type: 'boolean' },
    scrollNoteIntoView: { type: 'boolean' },
    autoExpandFocusedNote: { type: 'boolean' },
    showLineNumbers: { type: 'boolean' },
    groupBy: { type: 'string' },
    orientation: { type: 'string', enum: ['columns', 'rows'] },
    lineBreadth: { type: 'number', minimum: 120 },
    groupDisplay: { type: 'array', items: GROUP_DISPLAY_ITEMS },
    groupOrder: { type: 'string', enum: ['custom', 'newestFirst', 'newestLast', 'alphabetical', 'cardCount'] },
    cardRatio: { type: 'number', minimum: 0.5, maximum: 4 },
    animateTransitions: { type: 'boolean' },
    defaultCardType: { type: 'string' },
    clockMode: { type: 'string', enum: ['span', 'active', 'sinceStart'] },
};

/** which tree a bag name belongs to, for building a config path or looking up its node-keys table */
function treeOf(bag: SettingsBag): 'view' | 'card' {
    return bag === 'views' ? 'view' : 'card';
}

function declaredNodeKeys(bag: SettingsBag): Record<string, CascadeKey[]> {
    return bag === 'views' ? VIEW_NODE_KEYS : CARD_NODE_KEYS;
}

/**
 * The config path (below `notethink.settings.`) one node's declared key lives at: the two selections are
 * `view.type` / `card.type` regardless of node, since there is only ever one; every other key is
 * `<tree>.generic.<key>` at the tree's top node (`root` / `allcards`), else `<tree>.specific.<node>.<key>`.
 */
function cascadeKeyPath(tree: 'view' | 'card', node_id: string, key: CascadeKey): string {
    if (key === 'viewType') { return 'view.type'; }
    if (key === 'cardType') { return 'card.type'; }
    const top_node = tree === 'view' ? 'root' : 'allcards';
    return node_id === top_node ? `${tree}.generic.${key}` : `${tree}.specific.${node_id}.${key}`;
}

/** a 0.4.7 saved type's override name, for the four kanban-prefixed keys that have since dropped the prefix; the short name wins when both are present */
const LEGACY_USER_TYPE_OVERRIDE_NAMES: Record<string, string> = {
    kanbanGroupBy: 'groupBy',
    kanbanCardRatio: 'cardRatio',
    kanbanAnimateTransitions: 'animateTransitions',
    kanbanDefaultCardType: 'defaultCardType',
};

/**
 * Translates a saved type's overrides from 0.4.7's kanban-prefixed names to today's short ones. A legacy
 * name is dropped once translated; a short name already present wins over the legacy one it duplicates,
 * so a rewritten entry never carries both. Every other key passes through unchanged.
 */
function translatedOverrides(overrides: Record<string, unknown> | undefined): Record<string, unknown> {
    const source = overrides ?? {};
    const translated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
        const short_key = LEGACY_USER_TYPE_OVERRIDE_NAMES[key];
        if (short_key === undefined) { translated[key] = value; continue; }
        if (short_key in source) { continue; }
        translated[short_key] = value;
    }
    return translated;
}

/** a saved view type exactly as `view.userTypes` stores one entry */
interface UserViewTypeStored {
    id: string;
    label: string;
    parent: string;
    overrides?: Record<string, unknown>;
}

/** `view.userTypes` at one scope, with every malformed entry (no string id) dropped rather than throwing */
function savedTypesAt(scope: 'workspaceValue' | 'globalValue'): UserViewTypeStored[] {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect<UserViewTypeStored[]>('view.userTypes');
    const list = inspected?.[scope];
    return Array.isArray(list) ? list.filter((entry): entry is UserViewTypeStored => typeof entry?.id === 'string') : [];
}

const CONFIG_ROOT = 'notethink.settings';

export function isFlatSettingKey(value: unknown): value is FlatSettingKey {
    return typeof value === 'string' && value in FLAT_SETTINGS;
}

/**
 * The scope an ordinary edit writes to. Workspace, so a change stays local until the user promotes it -
 * except in a folderless window (a loose .md opened with no workspace), where VS Code rejects a Workspace
 * write outright, so the user scope is the only place the value can go.
 */
export function editTarget(): vscode.ConfigurationTarget {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

export function flatSettingKeys(): FlatSettingKey[] {
    return Object.keys(FLAT_SETTINGS) as FlatSettingKey[];
}

function resolvedAt<K extends FlatSettingKey>(key: K, scope: 'workspaceValue' | 'globalValue'): FlatSettingValue<K> | undefined {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(FLAT_SETTINGS[key].path);
    return inspected?.[scope] as FlatSettingValue<K> | undefined;
}

export function readFlatSetting<K extends FlatSettingKey>(key: K): FlatSettingValue<K> {
    const def = FLAT_SETTINGS[key];
    const value = vscode.workspace.getConfiguration(CONFIG_ROOT).get(def.path, def.default);
    // defensive `??` in case a host/mock returns undefined despite the default-value arg
    return (value ?? def.default) as FlatSettingValue<K>;
}

export function hasFlatWorkspaceOverride<K extends FlatSettingKey>(key: K): boolean {
    return resolvedAt(key, 'workspaceValue') !== undefined;
}

/** true when the flat key has a value at either the Workspace or the Global (User) scope */
export function hasFlatOverride<K extends FlatSettingKey>(key: K): boolean {
    return resolvedAt(key, 'workspaceValue') !== undefined || resolvedAt(key, 'globalValue') !== undefined;
}

export async function writeFlatSetting<K extends FlatSettingKey>(
    key: K,
    value: FlatSettingValue<K> | undefined,
    target: vscode.ConfigurationTarget,
): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_ROOT).update(FLAT_SETTINGS[key].path, value, target);
}

/** the saved default a flat key falls back to: the user-scope value when one is set, else the built-in default */
export function savedFlatDefaultOf<K extends FlatSettingKey>(key: K): FlatSettingValue<K> {
    const global_value = resolvedAt(key, 'globalValue');
    return global_value === undefined ? FLAT_SETTINGS[key].default : global_value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// structural: an array-valued setting (plain strings, or groupDisplay's {value, shown} entries) is never `===` fresh
function settingValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) { return true; }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, index) => settingValuesEqual(item, b[index]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const a_keys = Object.keys(a);
        const b_keys = Object.keys(b);
        return a_keys.length === b_keys.length && a_keys.every(k => settingValuesEqual(a[k], b[k]));
    }
    return false;
}

export function isFlatDivergedFromDefault<K extends FlatSettingKey>(key: K): boolean {
    return !settingValuesEqual(readFlatSetting(key), savedFlatDefaultOf(key));
}

function flatDivergedKeys(): FlatSettingKey[] {
    return flatSettingKeys().filter(key => isFlatDivergedFromDefault(key));
}

/** one built-in node's declared-key values at one scope, as a plain object - empty when nothing is set there */
function builtinNodeEntryAt(tree: 'view' | 'card', node_id: string, keys: CascadeKey[], scope: 'workspaceValue' | 'globalValue'): Record<string, unknown> {
    const entry: Record<string, unknown> = {};
    for (const key of keys) {
        const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(cascadeKeyPath(tree, node_id, key));
        const value = inspected?.[scope];
        if (value !== undefined) { entry[key] = value; }
    }
    return entry;
}

/**
 * A bag ('views' or 'cards') exactly as stored at one scope, with no merge across scopes - assembled from
 * each declared node key's own `inspect(...)[scope]` (never its `defaultValue`, so unset stays absent),
 * plus, for `views`, that scope's saved types translated to their current override names. Reproduces the
 * exact map shape the webview has always read on the wire; only this assembly step, and `applyBagDelta`
 * below, know that the storage underneath is one key per node per setting rather than two object-valued
 * settings.
 */
function bagAt(bag: SettingsBag, scope: 'workspaceValue' | 'globalValue'): Record<string, Record<string, unknown>> {
    const tree = treeOf(bag);
    const result: Record<string, Record<string, unknown>> = {};
    for (const [node_id, keys] of Object.entries(declaredNodeKeys(bag))) {
        const entry = builtinNodeEntryAt(tree, node_id, keys, scope);
        if (Object.keys(entry).length > 0) { result[node_id] = entry; }
    }
    if (bag === 'views') {
        for (const saved_type of savedTypesAt(scope)) {
            result[saved_type.id] = { parent: saved_type.parent, label: saved_type.label, ...translatedOverrides(saved_type.overrides) };
        }
    }
    return result;
}

/**
 * A bag read for the cascade: a Workspace entry overrides a User one key by key within each node,
 * rather than one scope shadowing the other's whole map the way a flat setting works - this is a
 * per-node store rather than a single value, so a Workspace edit to one node must not hide a User-scope
 * value held by another node.
 */
function mergedBag(bag: SettingsBag): Record<string, Record<string, unknown>> {
    const user = bagAt(bag, 'globalValue');
    const workspace = bagAt(bag, 'workspaceValue');
    const merged: Record<string, Record<string, unknown>> = {};
    for (const node_id of new Set([...Object.keys(user), ...Object.keys(workspace)])) {
        merged[node_id] = { ...(user[node_id] ?? {}), ...(workspace[node_id] ?? {}) };
    }
    return merged;
}

/** one bag cell's merged (Workspace-over-User) value, or undefined when nothing anywhere holds it */
export function readBagCell(bag: SettingsBag, node_id: string, key: string): unknown {
    return mergedBag(bag)[node_id]?.[key];
}

async function writeDeclaredCascadeCell(tree: 'view' | 'card', node_id: string, key: CascadeKey, value: unknown, target: vscode.ConfigurationTarget): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_ROOT).update(cascadeKeyPath(tree, node_id, key), value, target);
}

/**
 * Applies one op against a built-in node's own declared keys. `key === null` touches every key the node
 * declares: `value === undefined` clears all of them, any other (object) value writes each key the
 * replacement carries and clears the rest - the one write shape that both mints a fresh entry (nothing
 * stored yet) and replaces one wholesale. `key` set writes or clears that one declared key; an
 * undeclared key is logged and skipped rather than silently dropped.
 */
async function applyBuiltinNodeOp(tree: 'view' | 'card', node_keys: CascadeKey[], op: BagCellOp, target: vscode.ConfigurationTarget): Promise<void> {
    if (op.key === null) {
        const replacement = isPlainObject(op.value) ? op.value : undefined;
        for (const key of node_keys) {
            await writeDeclaredCascadeCell(tree, op.node_id, key, replacement?.[key], target);
        }
        return;
    }
    if (!node_keys.includes(op.key as CascadeKey)) {
        writeToLogAtLevel('error', 'applyBagDelta', `undeclared key ${op.key} for node ${op.node_id}`);
        return;
    }
    await writeDeclaredCascadeCell(tree, op.node_id, op.key as CascadeKey, op.value, target);
}

/** `saved_types` with `entry` in place of the one sharing its id, or appended when none does */
function withSavedType(saved_types: UserViewTypeStored[], entry: UserViewTypeStored): UserViewTypeStored[] {
    const index = saved_types.findIndex(t => t.id === entry.id);
    return index === -1 ? [...saved_types, entry] : saved_types.map((t, i) => (i === index ? entry : t));
}

/**
 * The entry a per-key edit starts from: the target scope's own entry, else a fresh one carrying only the
 * id, label and parent of the same type held at the other scope, so editing a User-scope type from a
 * workspace writes a complete Workspace entry rather than nothing.
 */
function savedTypeEditBase(saved_types: UserViewTypeStored[], other_scope_types: UserViewTypeStored[], id: string): UserViewTypeStored | undefined {
    const own = saved_types.find(t => t.id === id);
    if (own !== undefined) { return own; }
    const other = other_scope_types.find(t => t.id === id);
    return other === undefined ? undefined : { id, label: other.label, parent: other.parent, overrides: {} };
}

/**
 * Applies one op against an in-memory saved-type list. `key === null` mints or replaces the whole entry
 * (an `undefined` value deletes it instead); `label` and `parent` set the entry's own fields; any other
 * key edits one override, rewriting the entry's overrides under their current names. An op naming a saved
 * type neither scope holds is logged and skipped rather than silently dropped.
 */
function applySavedTypeOp(saved_types: UserViewTypeStored[], other_scope_types: UserViewTypeStored[], op: BagCellOp): UserViewTypeStored[] {
    if (op.key === null) {
        if (op.value === undefined) { return saved_types.filter(t => t.id !== op.node_id); }
        if (!isPlainObject(op.value)) {
            writeToLogAtLevel('error', 'applyBagDelta', `malformed saved type replacement for ${op.node_id}`);
            return saved_types;
        }
        const { parent, label, ...overrides } = op.value;
        return withSavedType(saved_types, { id: op.node_id, label: label as string, parent: parent as string, overrides });
    }
    const base = savedTypeEditBase(saved_types, other_scope_types, op.node_id);
    if (base === undefined) {
        writeToLogAtLevel('error', 'applyBagDelta', `cannot set ${op.key} on unknown saved type ${op.node_id}`);
        return saved_types;
    }
    if (op.key === 'label' || op.key === 'parent') {
        if (typeof op.value !== 'string') {
            writeToLogAtLevel('error', 'applyBagDelta', `saved type ${op.node_id} ${op.key} must be a string`);
            return saved_types;
        }
        return withSavedType(saved_types, { ...base, [op.key]: op.value });
    }
    const overrides = translatedOverrides(base.overrides);
    if (op.value === undefined) { delete overrides[op.key]; } else { overrides[op.key] = op.value; }
    return withSavedType(saved_types, { ...base, overrides });
}

/**
 * Applies every cell op in `sets` to `target`'s own scope, in order - the one write path a bag-cell edit
 * takes, whichever node(s) it touches. An op naming a built-in node routes to that node's own declared
 * key(s) (`applyBuiltinNodeOp`), written immediately; an op naming a saved type (views only) accumulates
 * against an in-memory copy of that scope's `view.userTypes`, written back once after the loop so a
 * multi-op delta (minting a type across several fields) lands as one array write. An op naming neither -
 * an unknown node on the cards tree, which has no saved types - is logged and skipped.
 */
export async function applyBagDelta(bag: SettingsBag, sets: BagCellOp[], target: vscode.ConfigurationTarget): Promise<void> {
    const tree = treeOf(bag);
    const node_keys = declaredNodeKeys(bag);
    const scope = target === vscode.ConfigurationTarget.Global ? 'globalValue' : 'workspaceValue';
    let saved_types = bag === 'views' ? savedTypesAt(scope) : [];
    const other_scope_types = bag === 'views' ? savedTypesAt(scope === 'globalValue' ? 'workspaceValue' : 'globalValue') : [];
    let saved_types_changed = false;
    for (const op of sets) {
        if (typeof op?.node_id !== 'string') {
            writeToLogAtLevel('error', 'applyBagDelta', `malformed op ${JSON.stringify(op)}`);
            continue;
        }
        const own_keys = node_keys[op.node_id];
        if (own_keys) {
            await applyBuiltinNodeOp(tree, own_keys, op, target);
            continue;
        }
        if (bag !== 'views') {
            writeToLogAtLevel('error', 'applyBagDelta', `unknown ${bag} node ${op.node_id}`);
            continue;
        }
        const next = applySavedTypeOp(saved_types, other_scope_types, op);
        if (next !== saved_types) { saved_types = next; saved_types_changed = true; }
    }
    if (saved_types_changed) {
        await vscode.workspace.getConfiguration(CONFIG_ROOT).update('view.userTypes', saved_types.length > 0 ? saved_types : undefined, target);
    }
}

/**
 * Writes an already-merged node map (as `mergedBag` returns it) into `target`'s own declared keys - the
 * reverse of `bagAt`, used only to promote the merged Workspace-over-User picture to the User scope. Every
 * built-in node's merged entry is written key by key; every other entry, carrying a string `parent` and
 * `label`, is a saved type and goes into one `view.userTypes` write at the end.
 */
async function writeBagAt(bag: SettingsBag, merged: Record<string, Record<string, unknown>>, target: vscode.ConfigurationTarget): Promise<void> {
    const tree = treeOf(bag);
    const node_keys = declaredNodeKeys(bag);
    for (const [node_id, keys] of Object.entries(node_keys)) {
        const entry = merged[node_id] ?? {};
        for (const key of keys) {
            await writeDeclaredCascadeCell(tree, node_id, key, entry[key], target);
        }
    }
    if (bag !== 'views') { return; }
    const saved_types: UserViewTypeStored[] = [];
    for (const [node_id, entry] of Object.entries(merged)) {
        if (node_keys[node_id]) { continue; }
        if (typeof entry.parent !== 'string' || typeof entry.label !== 'string') { continue; }
        const { parent, label, ...overrides } = entry;
        saved_types.push({ id: node_id, label, parent, overrides });
    }
    await vscode.workspace.getConfiguration(CONFIG_ROOT).update('view.userTypes', saved_types.length > 0 ? saved_types : undefined, target);
}

/** clears every declared key of a whole bag at one scope - the whole-cascade actions' recovery path */
async function clearBagAt(bag: SettingsBag, target: vscode.ConfigurationTarget): Promise<void> {
    const tree = treeOf(bag);
    for (const [node_id, keys] of Object.entries(declaredNodeKeys(bag))) {
        for (const key of keys) {
            await writeDeclaredCascadeCell(tree, node_id, key, undefined, target);
        }
    }
    if (bag === 'views') {
        await vscode.workspace.getConfiguration(CONFIG_ROOT).update('view.userTypes', undefined, target);
    }
}

/**
 * True when ONE (node, key) cell held in a bag diverges: the Workspace entry is set AND differs from
 * the User entry (or the built-in generic default, when no User entry exists either). A cell the
 * Workspace scope holds nothing for is never diverged: its effective value falls through to an ancestor
 * or the node's built-in bag value, which is a different cell's divergence (or no divergence at all).
 */
function cellDiverged(workspace_value: unknown, user_value: unknown, key: string): boolean {
    if (workspace_value === undefined) { return false; }
    const baseline = user_value !== undefined ? user_value : (CASCADE_KEY_DEFAULTS as Record<string, unknown>)[key];
    return !settingValuesEqual(workspace_value, baseline);
}

/**
 * Diverged cells of one bag, one synthetic key per (node, key) pair the Workspace scope holds that
 * differs from the User scope - `views:<node_id>:<key>` / `cards:<node_id>:<key>`. Drives the M pill on
 * a row whose effective value comes from a node's own bag entry rather than the flat home.
 */
function bagDivergedKeys(bag: SettingsBag): string[] {
    const workspace = bagAt(bag, 'workspaceValue');
    const user = bagAt(bag, 'globalValue');
    const diverged: string[] = [];
    for (const node_id of new Set([...Object.keys(workspace), ...Object.keys(user)])) {
        const node_keys = new Set([...Object.keys(workspace[node_id] ?? {}), ...Object.keys(user[node_id] ?? {})]);
        for (const key of node_keys) {
            if (cellDiverged(workspace[node_id]?.[key], user[node_id]?.[key], key)) {
                diverged.push(`${bag}:${node_id}:${key}`);
            }
        }
    }
    return diverged;
}

/** true when either bag has anything at all at one scope */
function hasBagOverrideAt(scope: 'workspaceValue' | 'globalValue'): boolean {
    return Object.keys(bagAt('views', scope)).length > 0 || Object.keys(bagAt('cards', scope)).length > 0;
}

/**
 * Build the settings payload the webview renders from: the two bags, merged per node per key across
 * scopes, the five flat settings, and the three divergence aggregates - the flat keys' own divergence
 * plus every diverged bag cell (`viewregistryops.ts`'s `resolvedSettingsFromCascade` is where the
 * webview unpacks this back into one field per setting).
 */
export function buildSettingsCascadePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        views: mergedBag('views'),
        cards: mergedBag('cards'),
    };
    let has_workspace_overrides = hasBagOverrideAt('workspaceValue');
    let has_any_overrides = has_workspace_overrides || hasBagOverrideAt('globalValue');
    for (const key of flatSettingKeys()) {
        payload[key] = readFlatSetting(key);
        if (hasFlatWorkspaceOverride(key)) { has_workspace_overrides = true; }
        if (hasFlatOverride(key)) { has_any_overrides = true; }
    }
    payload.diverged = [...flatDivergedKeys(), ...bagDivergedKeys('views'), ...bagDivergedKeys('cards')];
    payload.hasWorkspaceOverrides = has_workspace_overrides;
    payload.hasAnyOverrides = has_any_overrides;
    return payload;
}

/**
 * Promote every resolved setting to the user scope: snapshot each bag's merged (Workspace-over-User)
 * result and every flat key's resolved value, write the snapshot to Global, then clear Workspace - so
 * the user scope is the value's only home rather than one of two agreeing copies.
 */
export async function promoteSettingsToUser(): Promise<void> {
    for (const bag of ['views', 'cards'] as const) {
        const merged = mergedBag(bag);
        await writeBagAt(bag, merged, vscode.ConfigurationTarget.Global);
        if (Object.keys(bagAt(bag, 'workspaceValue')).length > 0) { await clearBagAt(bag, vscode.ConfigurationTarget.Workspace); }
    }
    for (const key of flatSettingKeys()) {
        await writeFlatSetting(key, readFlatSetting(key), vscode.ConfigurationTarget.Global);
        if (hasFlatWorkspaceOverride(key)) { await writeFlatSetting(key, undefined, vscode.ConfigurationTarget.Workspace); }
    }
}

/** clear every Workspace-scope override so each setting falls back to User then built-in */
export async function resetSettingsToDefault(): Promise<void> {
    for (const bag of ['views', 'cards'] as const) {
        if (Object.keys(bagAt(bag, 'workspaceValue')).length > 0) { await clearBagAt(bag, vscode.ConfigurationTarget.Workspace); }
    }
    for (const key of flatSettingKeys()) {
        if (hasFlatWorkspaceOverride(key)) { await writeFlatSetting(key, undefined, vscode.ConfigurationTarget.Workspace); }
    }
}

/**
 * Clear both the Workspace- and the User-scope override of every setting, so everything falls back to
 * the built-in default declared in package.json. The recovery path for a user default that has itself
 * been edited away - a wiped exclude filter, say - where "Revert to defaults" can no longer help.
 */
export async function restoreBuiltinDefaults(): Promise<void> {
    for (const bag of ['views', 'cards'] as const) {
        if (Object.keys(bagAt(bag, 'workspaceValue')).length > 0) { await clearBagAt(bag, vscode.ConfigurationTarget.Workspace); }
        if (Object.keys(bagAt(bag, 'globalValue')).length > 0) { await clearBagAt(bag, vscode.ConfigurationTarget.Global); }
    }
    for (const key of flatSettingKeys()) {
        if (!hasFlatOverride(key)) { continue; }
        await writeFlatSetting(key, undefined, vscode.ConfigurationTarget.Workspace);
        await writeFlatSetting(key, undefined, vscode.ConfigurationTarget.Global);
    }
}

interface DeclaredSettingContribution {
    type: string;
    scope: 'window';
    enum?: string[];
    minimum?: number;
    maximum?: number;
    items?: Record<string, unknown>;
    default?: unknown;
    description: string;
}

/**
 * Every `notethink.settings.*` property `package.json` must declare, built from `VIEW_NODE_KEYS`,
 * `CARD_NODE_KEYS`, `CASCADE_KEY_HOME`, `CASCADE_KEY_SCHEMA` and `FLAT_SETTINGS` - the single source of
 * truth this module reads and writes against. A node's own key carries a `default` only when that node is
 * the key's home (`CASCADE_KEY_HOME`); every other node's copy carries none, so unset means inherit. The
 * drift test compares this output against `package.json` directly, and every description is a
 * `%config.settings.<path>.description%` token the l10n drift test checks against all five nls files.
 */
export function buildDeclaredSettingsContributions(): Record<string, DeclaredSettingContribution> {
    const contributions: Record<string, DeclaredSettingContribution> = {};
    for (const [tree, node_keys] of [['view', VIEW_NODE_KEYS], ['card', CARD_NODE_KEYS]] as const) {
        for (const [node_id, keys] of Object.entries(node_keys)) {
            for (const key of keys) {
                const path = cascadeKeyPath(tree, node_id, key);
                contributions[`${CONFIG_ROOT}.${path}`] = {
                    ...CASCADE_KEY_SCHEMA[key],
                    scope: 'window',
                    ...(CASCADE_KEY_HOME[key] === node_id ? { default: CASCADE_KEY_DEFAULTS[key] } : {}),
                    description: `%config.settings.${path}.description%`,
                };
            }
        }
    }
    contributions[`${CONFIG_ROOT}.view.userTypes`] = {
        type: 'array',
        scope: 'window',
        items: { type: 'object' },
        default: [],
        description: '%config.settings.view.userTypes.description%',
    };
    for (const key of flatSettingKeys()) {
        const def = FLAT_SETTINGS[key];
        contributions[`${CONFIG_ROOT}.${def.path}`] = {
            ...def.schema,
            scope: 'window',
            default: def.default,
            description: `%config.settings.${def.path}.description%`,
        };
    }
    return contributions;
}

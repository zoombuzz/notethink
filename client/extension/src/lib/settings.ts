import * as vscode from 'vscode';
import { DEFAULT_GROUP_DISPLAY, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER } from '../constants';

/**
 * Settings module: one canonical place to read, write and inspect every notethink setting. Each entry
 * binds the TS identifier (camelCase; doubles as the wire setting ID and payload field name, a
 * deliberate exception to the snake_case wire convention since settings need one cross-boundary name),
 * its `notethink.settings.*` config path, its built-in default, and its owning registry node.
 *
 * Every setting has exactly ONE write path (workspace scope, or Global in a folderless window) and ONE
 * comparison: "diverged" means differs from the saved default, where the saved default is the
 * user-scope value if one exists, else the built-in default. Both default actions drive diverged to zero.
 *
 * Adding a setting is one entry here plus a matching package.json contribution (`"scope": "window"`,
 * since every read here passes no resource).
 */

/*
 * Owning-node sentinels, for settings that belong to no view type.
 * - NODE_GLOBAL: renders under the settings drawer's "Global settings" heading, with no owning-type pill
 * - NODE_FILES: belongs to the Files drawer
 * - NODE_INTERNAL: persisted state rather than a control, so no drawer lists it
 */
export const NODE_GLOBAL = 'global';
export const NODE_FILES = 'files';
export const NODE_INTERNAL = 'internal';

/**
 * A view type the user minted by saving a change to a setting an ancestor owns, e.g. changing Kanban's
 * group-by to assignee and naming the result "Kanban by Assignee".
 * - id: the registry node id, generated from the label and frozen once written
 * - label: what the tree shows
 * - parent: the built-in node it was saved from, which it inherits every other setting from
 * - overrides: the setting keys and values that make it different from that parent
 *
 * Mirrored as UserViewType in the webview's Messages.ts - the two bundles share no module graph, and
 * this shape is the wire contract between them.
 */
export interface UserViewTypeDef {
    id: string;
    label: string;
    parent: string;
    overrides: Record<string, unknown>;
}

/*
 * The view type a board renders as. Deliberately a bare string rather than a union of the built-in ids:
 * a user can mint their own view type ("Kanban by Assignee") from the settings drawer, and its id is as
 * legal a value here as `kanban` is. The registry, not the type, is what decides whether an id resolves -
 * see registryWithUserTypes and the component fallback in GenericView.
 */
export type ViewTypeSetting = string;

export interface SettingDef<T> {
    path: string;
    default: T;
    node: string;
}

/**
 * One lane of the kanban `groupDisplay` setting: its order in the array is its draw order, and `shown`
 * is whether it renders at all.
 *
 * Mirrored as GroupDisplayEntry in the webview's Messages.ts - the two bundles share no module graph, and
 * this shape is the wire contract between them.
 * - value: the raw lane slug the data groups by (e.g. 'code-review')
 * - shown: whether the lane is rendered
 */
export interface GroupDisplayEntry {
    value: string;
    shown: boolean;
}

export const SETTINGS = {
    viewType:                   { path: 'view.type',                               default: 'auto' as ViewTypeSetting,        node: 'root'      },
    cardType:                   { path: 'card.type',                               default: 'auto' as string,                 node: 'allcards'  },
    viewUserTypes:              { path: 'view.userTypes',                          default: [] as UserViewTypeDef[],          node: NODE_INTERNAL },
    showLinetagsInHeadlines:    { path: 'view.generic.showLinetagsInHeadlines',    default: false as boolean,                 node: 'allcards'  },
    scrollNoteIntoView:         { path: 'view.generic.scrollNoteIntoView',         default: true as boolean,                  node: 'root'      },
    autoExpandFocusedNote:      { path: 'view.generic.autoExpandFocusedNote',      default: false as boolean,                 node: 'allcards'  },
    showLineNumbers:            { path: 'view.generic.showLineNumbers',            default: false as boolean,                 node: 'allcards'  },
    groupBy:                    { path: 'view.specific.grouped.groupBy',           default: 'auto' as string,                 node: 'grouped'   },
    orientation:                { path: 'view.specific.line.orientation',          default: 'columns' as 'columns' | 'rows',  node: 'line'      },
    lineBreadth:                { path: 'view.specific.line.lineBreadth',           default: 220 as number,                    node: 'line'      },
    kanbanGroupBy:              { path: 'view.specific.kanban.groupBy',            default: 'auto' as string,                 node: 'kanban'    },
    groupDisplay:               { path: 'view.specific.kanban.groupDisplay',       default: DEFAULT_GROUP_DISPLAY as GroupDisplayEntry[], node: 'kanban' },
    kanbanCardRatio:            { path: 'view.specific.kanban.cardRatio',           default: 1.4 as number,                    node: 'kanban'    },
    kanbanAnimateTransitions:   { path: 'view.specific.kanban.animateTransitions', default: true as boolean,                  node: 'kanban'    },
    kanbanDefaultCardType:      { path: 'view.specific.kanban.defaultCardType',    default: 'card' as string,                 node: 'kanban'    },
    watchUnopenedFilesInViewer: { path: 'view.generic.watchUnopenedFilesInViewer', default: true as boolean,                  node: NODE_GLOBAL },
    openNewEditorIfNoneOpen:    { path: 'view.generic.openNewEditorIfNoneOpen',    default: false as boolean,                 node: NODE_GLOBAL },
    includeFilter:              { path: 'files.includeFilter',                     default: DEFAULT_INCLUDE_FILTER as string, node: NODE_FILES  },
    excludeFilter:              { path: 'files.excludeFilter',                     default: DEFAULT_EXCLUDE_FILTER as string, node: NODE_FILES  },
    maxNotesPerFile:            { path: 'files.maxNotesPerFile',                   default: 10 as number,                     node: NODE_FILES  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
type SettingValue<K extends SettingKey> = typeof SETTINGS[K]['default'];

const CONFIG_ROOT = 'notethink.settings';

interface LegacySettingDef {
    path: string;
    convert: (value: unknown) => unknown;
}

/*
 * A setting that used to live at a different config path, under a different shape. groupDisplay
 * replaced columnOrder (string[]) with an array of {value, shown} entries; a non-string item is
 * dropped and a non-array legacy value counts as absent, same as a key with nothing set at all.
 */
const LEGACY_SETTINGS: Partial<Record<SettingKey, LegacySettingDef>> = {
    groupDisplay: {
        path: 'view.specific.kanban.columnOrder',
        convert: (value: unknown): GroupDisplayEntry[] | undefined => {
            if (!Array.isArray(value)) { return undefined; }
            return value.filter((item): item is string => typeof item === 'string').map(item => ({ value: item, shown: true }));
        },
    },
};

export function isSettingKey(value: unknown): value is SettingKey {
    return typeof value === 'string' && value in SETTINGS;
}

export function settingKeys(): SettingKey[] {
    return Object.keys(SETTINGS) as SettingKey[];
}

/**
 * The value a key holds at one inspect scope, falling back to its legacy path's converted value when
 * the key itself has nothing there. Backs readSetting, hasWorkspaceOverride, hasOverride and
 * savedDefaultOf, so all four agree on what counts as "set" at a scope.
 */
function resolvedAt<K extends SettingKey>(key: K, scope: 'workspaceValue' | 'globalValue'): SettingValue<K> | undefined {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(SETTINGS[key].path);
    const direct = inspected?.[scope];
    if (direct !== undefined) { return direct as SettingValue<K>; }
    const legacy = LEGACY_SETTINGS[key];
    if (!legacy) { return undefined; }
    const legacy_inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(legacy.path);
    const legacy_value = legacy_inspected?.[scope];
    if (legacy_value === undefined) { return undefined; }
    const converted = legacy.convert(legacy_value);
    return converted === undefined ? undefined : (converted as SettingValue<K>);
}

export function readSetting<K extends SettingKey>(key: K): SettingValue<K> {
    const def = SETTINGS[key];
    if (!LEGACY_SETTINGS[key]) {
        const value = vscode.workspace.getConfiguration(CONFIG_ROOT).get(def.path, def.default);
        // defensive `??` in case a host/mock returns undefined despite the default-value arg
        return (value ?? def.default) as SettingValue<K>;
    }
    const workspace_value = resolvedAt(key, 'workspaceValue');
    if (workspace_value !== undefined) { return workspace_value; }
    const global_value = resolvedAt(key, 'globalValue');
    if (global_value !== undefined) { return global_value; }
    return def.default;
}

export function hasWorkspaceOverride<K extends SettingKey>(key: K): boolean {
    return resolvedAt(key, 'workspaceValue') !== undefined;
}

/**
 * True when the key has a value at either the Workspace or the Global (User) scope, i.e. when anything at
 * all overrides the built-in default. Drives the "Restore built-in defaults" action, which clears both.
 */
export function hasOverride<K extends SettingKey>(key: K): boolean {
    return resolvedAt(key, 'workspaceValue') !== undefined || resolvedAt(key, 'globalValue') !== undefined;
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

/**
 * Writes a key's new-path value, then, for a key carrying a legacy entry, also clears the legacy path
 * at the same target. That second write runs unconditionally (including when value is undefined, which
 * is how revert and "restore built-in defaults" work), so a legacy value can never resurface after a
 * write, a revert or a "save as user default".
 */
export async function writeSetting<K extends SettingKey>(
    key: K,
    value: SettingValue<K> | undefined,
    target: vscode.ConfigurationTarget,
): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_ROOT).update(SETTINGS[key].path, value, target);
    const legacy = LEGACY_SETTINGS[key];
    if (legacy) {
        await vscode.workspace.getConfiguration(CONFIG_ROOT).update(legacy.path, undefined, target);
    }
}

/**
 * The value this setting falls back to when the workspace has no opinion: the user-scope value when one
 * is set, else the built-in default. This is the baseline divergence is measured against, which is what
 * makes "Save as default" (promote every value to the user scope) drive the diverged count to zero.
 */
export function savedDefaultOf<K extends SettingKey>(key: K): SettingValue<K> {
    const global_value = resolvedAt(key, 'globalValue');
    return global_value === undefined ? SETTINGS[key].default : global_value;
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

export function isDivergedFromDefault<K extends SettingKey>(key: K): boolean {
    return !settingValuesEqual(readSetting(key), savedDefaultOf(key));
}

export function divergedKeys(): SettingKey[] {
    return settingKeys().filter(key => isDivergedFromDefault(key));
}

/**
 * Build the settings payload the webview renders from. Field names match the SettingKey (camelCase
 * end-to-end), and three aggregates ride alongside: the keys whose resolved value differs from their
 * saved default (the drawer's M markers and its diverged count), whether anything sits at the Workspace
 * scope (enables "Revert to defaults"), and whether anything sits at either scope (enables the Files
 * drawer's built-in restore).
 */
export function buildSettingsCascadePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    let has_workspace_overrides = false;
    let has_any_overrides = false;
    for (const key of settingKeys()) {
        payload[key] = readSetting(key);
        if (hasWorkspaceOverride(key)) { has_workspace_overrides = true; }
        if (hasOverride(key)) { has_any_overrides = true; }
    }
    payload.diverged = divergedKeys();
    payload.hasWorkspaceOverrides = has_workspace_overrides;
    payload.hasAnyOverrides = has_any_overrides;
    return payload;
}

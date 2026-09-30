import * as vscode from 'vscode';
import { DEFAULT_COLUMN_ORDER, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER } from '../constants';

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
    columnOrder:                { path: 'view.specific.kanban.columnOrder',        default: DEFAULT_COLUMN_ORDER as string[], node: 'kanban'    },
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

export function isSettingKey(value: unknown): value is SettingKey {
    return typeof value === 'string' && value in SETTINGS;
}

export function settingKeys(): SettingKey[] {
    return Object.keys(SETTINGS) as SettingKey[];
}

export function readSetting<K extends SettingKey>(key: K): SettingValue<K> {
    const def = SETTINGS[key];
    const value = vscode.workspace.getConfiguration(CONFIG_ROOT).get(def.path, def.default);
    // defensive `??` in case a host/mock returns undefined despite the default-value arg
    return (value ?? def.default) as SettingValue<K>;
}

export function hasWorkspaceOverride<K extends SettingKey>(key: K): boolean {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(SETTINGS[key].path);
    return inspected?.workspaceValue !== undefined;
}

/**
 * True when the key has a value at either the Workspace or the Global (User) scope, i.e. when anything at
 * all overrides the built-in default. Drives the "Restore built-in defaults" action, which clears both.
 */
export function hasOverride<K extends SettingKey>(key: K): boolean {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(SETTINGS[key].path);
    return inspected?.workspaceValue !== undefined || inspected?.globalValue !== undefined;
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

export async function writeSetting<K extends SettingKey>(
    key: K,
    value: SettingValue<K> | undefined,
    target: vscode.ConfigurationTarget,
): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_ROOT).update(SETTINGS[key].path, value, target);
}

/**
 * The value this setting falls back to when the workspace has no opinion: the user-scope value when one
 * is set, else the built-in default. This is the baseline divergence is measured against, which is what
 * makes "Save as default" (promote every value to the user scope) drive the diverged count to zero.
 */
export function savedDefaultOf<K extends SettingKey>(key: K): SettingValue<K> {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(SETTINGS[key].path);
    const global_value = inspected?.globalValue;
    return (global_value === undefined ? SETTINGS[key].default : global_value) as SettingValue<K>;
}

// structural, because columnOrder is an array and a fresh literal is never `===` a stored one
function settingValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) { return true; }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, index) => item === b[index]);
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

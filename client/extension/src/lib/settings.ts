import * as vscode from 'vscode';
import { DEFAULT_COLUMN_ORDER, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER } from '../constants';

/*
 * settings module. One canonical place to read, write, and inspect every notethink setting.
 *
 * Each entry binds: the TS identifier (camelCase, used in code as a SettingKey AND as the wire setting ID AND as the payload field name), the dotted config path under `notethink.settings.*` (matches package.json contributes), the built-in default, whether the setting is part of the cascade subset (true) or a global toggle (false), and the owning view-registry node (the tree node whose settings this belongs to - `root` for generic/all-view settings, `kanban` for kanban-specific ones). The `node` is metadata linking each config key to its home in the view registry (client/webview/.../lib/viewregistryops.ts); it does not affect read/write/cascade behaviour. Settings identifiers are camelCase end-to-end - this is a deliberate, scoped exception to the project-wide snake_case-for-wire-data-fields convention; settings have a unique cross-boundary identity (TS code, wire IDs, payload field names, VS Code config keys), and bridging conventions would mean every setting carries two names.
 *
 * Adding a setting = one entry here. The read/write helpers stay one-liners; the cascade payload, the workspace-overrides flag, and the promote/reset handlers all iterate this map.
 */

export interface SettingDef<T> {
    path: string;
    default: T;
    inCascade: boolean;
    node: string;
}

export const SETTINGS = {
    viewType:                   { path: 'view.type',                                default: 'auto' as 'auto' | 'document' | 'kanban', inCascade: true,  node: 'root'   },
    columnOrder:                { path: 'view.specific.kanban.columnOrder',         default: DEFAULT_COLUMN_ORDER as string[],         inCascade: true,  node: 'kanban' },
    showContextBars:            { path: 'view.generic.showContextBars',             default: true,                                     inCascade: true,  node: 'root'   },
    includeFilter:              { path: 'files.includeFilter',                      default: DEFAULT_INCLUDE_FILTER as string,         inCascade: true,  node: 'root'   },
    excludeFilter:              { path: 'files.excludeFilter',                      default: DEFAULT_EXCLUDE_FILTER as string,         inCascade: true,  node: 'root'   },
    maxNotesPerFile:            { path: 'files.maxNotesPerFile',                    default: 10 as number,                             inCascade: true,  node: 'root'   },
    showLineNumbers:            { path: 'view.generic.showLineNumbers',             default: false,                                    inCascade: false, node: 'root'   },
    watchUnopenedFilesInViewer: { path: 'view.generic.watchUnopenedFilesInViewer',  default: true,                                     inCascade: false, node: 'root'   },
    kanbanAnimateTransitions:   { path: 'view.specific.kanban.animateTransitions',  default: true,                                     inCascade: false, node: 'kanban' },
    openNewEditorIfNoneOpen:    { path: 'view.generic.openNewEditorIfNoneOpen',     default: false,                                    inCascade: false, node: 'root'   },
} as const;

export type SettingKey = keyof typeof SETTINGS;
type SettingValue<K extends SettingKey> = typeof SETTINGS[K]['default'];

const CONFIG_ROOT = 'notethink.settings';

export function isSettingKey(value: unknown): value is SettingKey {
    return typeof value === 'string' && value in SETTINGS;
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

// true when the key has a value at either the Workspace or the Global (User) scope - i.e. anything overrides the built-in default. Drives the "Reset to built-in default" button, which clears both scopes
export function hasOverride<K extends SettingKey>(key: K): boolean {
    const inspected = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(SETTINGS[key].path);
    return inspected?.workspaceValue !== undefined || inspected?.globalValue !== undefined;
}

export async function writeSetting<K extends SettingKey>(
    key: K,
    value: SettingValue<K> | undefined,
    target: vscode.ConfigurationTarget,
): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_ROOT).update(SETTINGS[key].path, value, target);
}

export function cascadeKeys(): SettingKey[] {
    return (Object.keys(SETTINGS) as SettingKey[]).filter(k => SETTINGS[k].inCascade);
}

// build the cascade payload from every cascade-tier setting. Field names match the SettingKey (camelCase end-to-end). Also reports whether any cascade key has a Workspace-scope override (drives "Reset to user default") and whether any has a Workspace-or-User override (drives "Reset to built-in default")
export function buildSettingsCascadePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    let hasWorkspaceOverrides = false;
    let hasAnyOverrides = false;
    for (const key of cascadeKeys()) {
        payload[key] = readSetting(key);
        if (hasWorkspaceOverride(key)) { hasWorkspaceOverrides = true; }
        if (hasOverride(key)) { hasAnyOverrides = true; }
    }
    payload.hasWorkspaceOverrides = hasWorkspaceOverrides;
    payload.hasAnyOverrides = hasAnyOverrides;
    return payload;
}

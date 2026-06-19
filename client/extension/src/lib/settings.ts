import * as vscode from 'vscode';
import { DEFAULT_COLUMN_ORDER, DEFAULT_INCLUDE_FILTER, DEFAULT_EXCLUDE_FILTER } from '../constants';

/*
 * settings module. One canonical place to read, write, and inspect every notethink setting.
 *
 * Each entry binds: the TS identifier (camelCase, used in code as a SettingKey AND as the wire setting ID AND as the payload field name), the dotted config path under `notethink.settings.*` (matches package.json contributes), the built-in default, and whether the setting is part of the cascade subset (true) or a global toggle (false). Settings identifiers are camelCase end-to-end - this is a deliberate, scoped exception to the project-wide snake_case-for-wire-data-fields convention; settings have a unique cross-boundary identity (TS code, wire IDs, payload field names, VS Code config keys), and bridging conventions would mean every setting carries two names.
 *
 * Adding a setting = one entry here. The read/write helpers stay one-liners; the cascade payload, the workspace-overrides flag, and the promote/reset handlers all iterate this map.
 */

export interface SettingDef<T> {
    path: string;
    default: T;
    inCascade: boolean;
}

export const SETTINGS = {
    viewType:                   { path: 'view.type',                                default: 'auto' as 'auto' | 'document' | 'kanban', inCascade: true  },
    columnOrder:                { path: 'view.specific.kanban.columnOrder',         default: DEFAULT_COLUMN_ORDER as string[],         inCascade: true  },
    showContextBars:            { path: 'view.generic.showContextBars',             default: true,                                     inCascade: true  },
    includeFilter:              { path: 'files.includeFilter',                      default: DEFAULT_INCLUDE_FILTER as string,         inCascade: true  },
    excludeFilter:              { path: 'files.excludeFilter',                      default: DEFAULT_EXCLUDE_FILTER as string,         inCascade: true  },
    maxNotesPerFile:            { path: 'files.maxNotesPerFile',                    default: 10 as number,                             inCascade: true  },
    showLineNumbers:            { path: 'view.generic.showLineNumbers',             default: false,                                    inCascade: false },
    watchUnopenedFilesInViewer: { path: 'view.generic.watchUnopenedFilesInViewer',  default: true,                                     inCascade: false },
    kanbanAnimateTransitions:   { path: 'view.specific.kanban.animateTransitions',  default: true,                                     inCascade: false },
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

// build the cascade payload from every cascade-tier setting. Field names match the SettingKey (camelCase end-to-end). Also reports whether any cascade key has a Workspace-scope override (drives the Reset button's enabled state)
export function buildSettingsCascadePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    let hasWorkspaceOverrides = false;
    for (const key of cascadeKeys()) {
        payload[key] = readSetting(key);
        if (hasWorkspaceOverride(key)) { hasWorkspaceOverrides = true; }
    }
    payload.hasWorkspaceOverrides = hasWorkspaceOverrides;
    return payload;
}

import * as vscode from 'vscode';
import { SETTINGS, hasOverride, hasWorkspaceOverride, buildSettingsCascadePayload } from './settings';

interface FakeConfigEntry {
    workspaceValue?: unknown;
    globalValue?: unknown;
}

// drive vscode.workspace.getConfiguration() off a path-keyed store so inspect() reports per-scope overrides; keys are the SETTINGS[*].path values (e.g. 'files.excludeFilter') since the module inspects each def.path under the notethink.settings root
function mockConfigStore(store: Record<string, FakeConfigEntry>): void {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: (path: string, default_value: unknown) => {
            const entry = store[path];
            return entry?.workspaceValue ?? entry?.globalValue ?? default_value;
        },
        inspect: (path: string) => ({
            workspaceValue: store[path]?.workspaceValue,
            globalValue: store[path]?.globalValue,
        }),
        update: jest.fn(async () => {}),
    });
}

const EXCLUDE_PATH = SETTINGS.excludeFilter.path;

describe('settings map is byte-identical after the view-registry node annotation', () => {
    // the view-registry node annotation must not disturb any existing path / default / cascade membership
    it('keeps every setting path, default, and cascade flag unchanged', () => {
        expect(SETTINGS.viewType.path).toBe('view.type');
        expect(SETTINGS.viewType.default).toBe('auto');
        expect(SETTINGS.viewType.inCascade).toBe(true);
        expect(SETTINGS.columnOrder.path).toBe('view.specific.kanban.columnOrder');
        expect(SETTINGS.columnOrder.default).toEqual(['untagged', 'doing', 'code-review', 'testing', 'done']);
        expect(SETTINGS.columnOrder.inCascade).toBe(true);
        expect(SETTINGS.kanbanAnimateTransitions.path).toBe('view.specific.kanban.animateTransitions');
        expect(SETTINGS.kanbanAnimateTransitions.inCascade).toBe(false);
        expect(SETTINGS.showContextBars.path).toBe('view.generic.showContextBars');
    });

    it('every setting declares an owning node, kanban ones under kanban and generic ones under root', () => {
        for (const key of Object.keys(SETTINGS) as Array<keyof typeof SETTINGS>) {
            expect(typeof SETTINGS[key].node).toBe('string');
        }
        expect(SETTINGS.columnOrder.node).toBe('kanban');
        expect(SETTINGS.kanbanAnimateTransitions.node).toBe('kanban');
        expect(SETTINGS.viewType.node).toBe('root');
        expect(SETTINGS.showContextBars.node).toBe('root');
    });
});

describe('settings override helpers', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('hasWorkspaceOverride is true only for a Workspace-scope value, not a User-scope one', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{x}/**' } });
        expect(hasWorkspaceOverride('excludeFilter')).toBe(false);
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '**/{x}/**' } });
        expect(hasWorkspaceOverride('excludeFilter')).toBe(true);
    });

    it('hasOverride is true for a Workspace OR a User value, false when neither is set', () => {
        mockConfigStore({});
        expect(hasOverride('excludeFilter')).toBe(false);
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{x}/**' } });
        expect(hasOverride('excludeFilter')).toBe(true);
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '' } });
        expect(hasOverride('excludeFilter')).toBe(true);
    });

    // an empty-string Workspace value still counts as an override (the wiped-filter case): undefined is the only "no override"
    it('hasOverride treats an empty-string value as a real override', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '' } });
        expect(hasOverride('excludeFilter')).toBe(true);
    });
});

describe('buildSettingsCascadePayload override flags', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reports no overrides when every cascade key is at its built-in default', () => {
        mockConfigStore({});
        const payload = buildSettingsCascadePayload();
        expect(payload.hasWorkspaceOverrides).toBe(false);
        expect(payload.hasAnyOverrides).toBe(false);
    });

    // the recovery case: a User-scope override means "Reset to built-in default" must be enabled (hasAnyOverrides) even though "Reset to user default" stays disabled (no Workspace override)
    it('a User-only override sets hasAnyOverrides without setting hasWorkspaceOverrides', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{node_modules}/**' } });
        const payload = buildSettingsCascadePayload();
        expect(payload.hasWorkspaceOverrides).toBe(false);
        expect(payload.hasAnyOverrides).toBe(true);
    });

    it('a Workspace override sets both flags', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '**/{node_modules}/**' } });
        const payload = buildSettingsCascadePayload();
        expect(payload.hasWorkspaceOverrides).toBe(true);
        expect(payload.hasAnyOverrides).toBe(true);
    });
});

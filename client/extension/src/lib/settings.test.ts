import * as vscode from 'vscode';
import {
    SETTINGS,
    NODE_FILES,
    NODE_GLOBAL,
    buildSettingsCascadePayload,
    divergedKeys,
    editTarget,
    hasOverride,
    hasWorkspaceOverride,
    isDivergedFromDefault,
    readSetting,
    savedDefaultOf,
    settingKeys,
    writeSetting,
    type SettingKey,
} from './settings';

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

// point the mocked workspace at the given roots; undefined is the folderless case, a loose .md
function setWorkspaceRoots(roots: string[] | undefined): void {
    (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = roots
        ? roots.map((root, index) => ({ uri: vscode.Uri.file(root), name: root, index }))
        : undefined;
}

const EXCLUDE_PATH = SETTINGS.excludeFilter.path;
const VIEW_TYPE_PATH = SETTINGS.viewType.path;
const COLUMN_ORDER_PATH = SETTINGS.columnOrder.path;
const LINETAGS_PATH = SETTINGS.showLinetagsInHeadlines.path;

describe('SETTINGS is complete enough for the drawer to render and promote every key', () => {

    it('every key declares a default, a config path, and a non-empty owning node', () => {
        for (const key of settingKeys()) {
            expect(SETTINGS[key].default).not.toBeUndefined();
            expect(typeof SETTINGS[key].path).toBe('string');
            expect(SETTINGS[key].path.length).toBeGreaterThan(0);
            expect(typeof SETTINGS[key].node).toBe('string');
            expect(SETTINGS[key].node.length).toBeGreaterThan(0);
        }
    });

    // promote, reset and restore all iterate settingKeys(), so a filter here would strand what it drops
    it('settingKeys() excludes nothing, so promote and reset reach every setting', () => {
        expect(settingKeys()).toEqual(Object.keys(SETTINGS) as SettingKey[]);
    });

    it('homes each key on the node that owns it', () => {
        expect(SETTINGS.viewType.node).toBe('root');
        expect(SETTINGS.scrollNoteIntoView.node).toBe('root');
        expect(SETTINGS.orientation.node).toBe('line');
        expect(SETTINGS.groupBy.node).toBe('grouped');
        expect(SETTINGS.columnOrder.node).toBe('kanban');
        expect(SETTINGS.kanbanAnimateTransitions.node).toBe('kanban');
        expect(SETTINGS.watchUnopenedFilesInViewer.node).toBe(NODE_GLOBAL);
        expect(SETTINGS.excludeFilter.node).toBe(NODE_FILES);
    });

    it('homes the card-drawn settings on the card tree, which is the pane that shows them', () => {
        // how a note is drawn, not how a view lays notes out, so these three moved onto the card tab
        expect(SETTINGS.cardType.node).toBe('allcards');
        expect(SETTINGS.showLinetagsInHeadlines.node).toBe('allcards');
        expect(SETTINGS.autoExpandFocusedNote.node).toBe('allcards');
        expect(SETTINGS.showLineNumbers.node).toBe('allcards');
    });

    it('keeps every config path where it already was, since a path is a permanent name on disk', () => {
        expect(SETTINGS.showLinetagsInHeadlines.path).toBe('view.generic.showLinetagsInHeadlines');
        expect(SETTINGS.autoExpandFocusedNote.path).toBe('view.generic.autoExpandFocusedNote');
        expect(SETTINGS.showLineNumbers.path).toBe('view.generic.showLineNumbers');
    });

    it('gives every key a distinct config path', () => {
        const paths = settingKeys().map(key => SETTINGS[key].path);
        expect(new Set(paths).size).toBe(paths.length);
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

describe('editTarget picks the scope an ordinary edit writes to', () => {

    afterEach(() => {
        setWorkspaceRoots(undefined);
    });

    it('writes to the workspace scope when a folder is open, so a change stays local until promoted', () => {
        setWorkspaceRoots(['/workspace']);
        expect(editTarget()).toBe(vscode.ConfigurationTarget.Workspace);
    });

    it('falls back to the user scope in a folderless window, where a workspace write would throw', () => {
        setWorkspaceRoots(undefined);
        expect(editTarget()).toBe(vscode.ConfigurationTarget.Global);
    });

    it('treats an empty workspaceFolders array as folderless', () => {
        setWorkspaceRoots([]);
        expect(editTarget()).toBe(vscode.ConfigurationTarget.Global);
    });
});

describe('writeSetting is the one write path', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('updates the key config path at the target it is handed', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (_path: string, default_value: unknown) => default_value,
            inspect: () => undefined,
            update,
        });

        await writeSetting('showLinetagsInHeadlines', true, vscode.ConfigurationTarget.Workspace);
        await writeSetting('viewType', 'kanban', vscode.ConfigurationTarget.Global);

        expect(update).toHaveBeenNthCalledWith(1, LINETAGS_PATH, true, vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenNthCalledWith(2, VIEW_TYPE_PATH, 'kanban', vscode.ConfigurationTarget.Global);
    });

    it('clears a scope by writing undefined, which is how reset and restore work', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (_path: string, default_value: unknown) => default_value,
            inspect: () => undefined,
            update,
        });

        await writeSetting('columnOrder', undefined, vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(COLUMN_ORDER_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });
});

describe('savedDefaultOf is the baseline divergence is measured against', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is the built-in default when the user scope holds no value', () => {
        mockConfigStore({});
        expect(savedDefaultOf('excludeFilter')).toBe(SETTINGS.excludeFilter.default);
        expect(savedDefaultOf('columnOrder')).toEqual(SETTINGS.columnOrder.default);
        expect(savedDefaultOf('scrollNoteIntoView')).toBe(true);
    });

    it('is the user-scope value once one is set, whatever the workspace says', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**', workspaceValue: '**/{tmp}/**' } });
        expect(savedDefaultOf('excludeFilter')).toBe('**/{vendor}/**');
    });

    // a user-scope false has to beat a truthy built-in, so the check is against undefined not falsiness
    it('honours a falsy user-scope value over a true built-in default', () => {
        mockConfigStore({ [SETTINGS.scrollNoteIntoView.path]: { globalValue: false } });
        expect(savedDefaultOf('scrollNoteIntoView')).toBe(false);
    });
});

describe('isDivergedFromDefault', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is false for a key sitting at its saved default', () => {
        mockConfigStore({});
        expect(isDivergedFromDefault('viewType')).toBe(false);
        expect(isDivergedFromDefault('excludeFilter')).toBe(false);
        expect(isDivergedFromDefault('columnOrder')).toBe(false);
    });

    it('is true for a workspace override that differs from the saved default', () => {
        mockConfigStore({ [VIEW_TYPE_PATH]: { workspaceValue: 'kanban' } });
        expect(isDivergedFromDefault('viewType')).toBe(true);
    });

    it('is false when the workspace value matches the user-scope value', () => {
        mockConfigStore({ [VIEW_TYPE_PATH]: { globalValue: 'kanban', workspaceValue: 'kanban' } });
        expect(isDivergedFromDefault('viewType')).toBe(false);
    });

    it('is false for a workspace override that just restates the built-in default', () => {
        mockConfigStore({ [VIEW_TYPE_PATH]: { workspaceValue: SETTINGS.viewType.default } });
        expect(isDivergedFromDefault('viewType')).toBe(false);
    });

    // columnOrder is array-valued, and a stored array is never === a fresh one
    it('compares an array-valued key structurally, not by reference', () => {
        mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: [...SETTINGS.columnOrder.default] } });
        expect(isDivergedFromDefault('columnOrder')).toBe(false);
    });

    it('is true for an array-valued key whose members are reordered', () => {
        mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: [...SETTINGS.columnOrder.default].reverse() } });
        expect(isDivergedFromDefault('columnOrder')).toBe(true);
    });

    it('is true for an array-valued key of a different length', () => {
        mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: ['doing'] } });
        expect(isDivergedFromDefault('columnOrder')).toBe(true);
    });

    it('is true for a boolean override that flips the built-in default', () => {
        mockConfigStore({ [LINETAGS_PATH]: { workspaceValue: true } });
        expect(isDivergedFromDefault('showLinetagsInHeadlines')).toBe(true);
    });
});

describe('divergedKeys and the cascade payload it rides in', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is empty when every key sits at its built-in default', () => {
        mockConfigStore({});
        expect(divergedKeys()).toEqual([]);
        expect(buildSettingsCascadePayload().diverged).toEqual([]);
    });

    // excludeFilter is the control: a user-only value moves the default with it
    it('reports exactly the keys whose resolved value differs from their saved default', () => {
        mockConfigStore({
            [VIEW_TYPE_PATH]: { workspaceValue: 'kanban' },
            [COLUMN_ORDER_PATH]: { workspaceValue: ['done'] },
            [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**' },
        });
        expect(divergedKeys().sort()).toEqual(['columnOrder', 'viewType']);
    });

    it('carries the same set into the cascade payload the webview renders', () => {
        mockConfigStore({ [LINETAGS_PATH]: { workspaceValue: true } });
        expect(buildSettingsCascadePayload().diverged).toEqual(['showLinetagsInHeadlines']);
    });

    it('sends a resolved value for every key alongside the aggregates', () => {
        mockConfigStore({});
        const payload = buildSettingsCascadePayload();
        for (const key of settingKeys()) {
            expect(payload[key]).toEqual(SETTINGS[key].default);
        }
    });

    /*
     * The promote handler snapshots every resolved value into the user scope and then clears the workspace scope.
     * Replaying that against the store is what backs the story's claim that "Save as default" drives the diverged
     * count to zero: once the user scope holds what the workspace held, the saved default and the resolved value agree.
     */
    it('a simulated promote drives the diverged count to zero', () => {
        mockConfigStore({
            [VIEW_TYPE_PATH]: { workspaceValue: 'kanban' },
            [COLUMN_ORDER_PATH]: { workspaceValue: ['done', 'doing'] },
            [EXCLUDE_PATH]: { workspaceValue: '**/{vendor}/**' },
        });
        expect(divergedKeys().sort()).toEqual(['columnOrder', 'excludeFilter', 'viewType']);

        const promoted: Record<string, FakeConfigEntry> = {};
        for (const key of settingKeys()) {
            promoted[SETTINGS[key].path] = { globalValue: readSetting(key) };
        }
        mockConfigStore(promoted);

        expect(divergedKeys()).toEqual([]);
        expect(buildSettingsCascadePayload().diverged).toEqual([]);
    });

    // "Revert to defaults" clears the workspace scope, leaving the user scope as the resolved value
    it('a simulated revert drives the diverged count to zero without losing the user default', () => {
        mockConfigStore({ [VIEW_TYPE_PATH]: { globalValue: 'document', workspaceValue: 'kanban' } });
        expect(divergedKeys()).toEqual(['viewType']);

        mockConfigStore({ [VIEW_TYPE_PATH]: { globalValue: 'document' } });

        expect(divergedKeys()).toEqual([]);
        expect(readSetting('viewType')).toBe('document');
    });
});

describe('buildSettingsCascadePayload override flags', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reports no overrides when every key is at its built-in default', () => {
        mockConfigStore({});
        const payload = buildSettingsCascadePayload();
        expect(payload.hasWorkspaceOverrides).toBe(false);
        expect(payload.hasAnyOverrides).toBe(false);
    });

    // the recovery case: a User override enables the built-in reset, not Revert
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

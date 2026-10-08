import fs from 'fs';
import path from 'path';
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

const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', '..', '..', 'package.json');
// readSetting passes no resource, so a key scoped per resource would silently ignore a folder's value
const RESOURCE_SCOPES = ['resource', 'language-overridable'];

interface ManifestSetting {
    scope?: string;
}

interface FakeConfigEntry {
    workspaceValue?: unknown;
    globalValue?: unknown;
}

// backs getConfiguration() with a store keyed by each SETTINGS[*].path, so inspect() reports per-scope overrides
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
const GROUP_DISPLAY_PATH = SETTINGS.groupDisplay.path;
// groupDisplay's predecessor: a plain string[] at a different config path, still read as a fallback
const LEGACY_COLUMN_ORDER_PATH = 'view.specific.kanban.columnOrder';
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
        expect(SETTINGS.groupDisplay.node).toBe('kanban');
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

    // a resource-scoped contribution would promise per-folder values that no read here honours
    it('contributes every key at a scope that needs no resource to read', () => {
        const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { contributes: { configuration: Array<{ properties: Record<string, ManifestSetting> }> } };
        const properties: Record<string, ManifestSetting> = Object.assign({}, ...manifest.contributes.configuration.map(section => section.properties));
        for (const key of settingKeys()) {
            const contribution = properties[`notethink.settings.${SETTINGS[key].path}`];
            expect(contribution).toBeDefined();
            expect(RESOURCE_SCOPES).not.toContain(contribution.scope ?? 'window');
        }
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

        await writeSetting('excludeFilter', undefined, vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(EXCLUDE_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });

    // groupDisplay carries a legacy entry (its predecessor columnOrder); every other key does not
    it('also clears the legacy path at the same target for a key that carries one', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (_path: string, default_value: unknown) => default_value,
            inspect: () => undefined,
            update,
        });

        await writeSetting('groupDisplay', [{ value: 'done', shown: true }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenNthCalledWith(1, GROUP_DISPLAY_PATH, [{ value: 'done', shown: true }], vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenNthCalledWith(2, LEGACY_COLUMN_ORDER_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });

    // undefined is how revert and "restore built-in defaults" work, and the legacy clear runs then too
    it('clears the legacy path even when the write itself is a clear (undefined)', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (_path: string, default_value: unknown) => default_value,
            inspect: () => undefined,
            update,
        });

        await writeSetting('groupDisplay', undefined, vscode.ConfigurationTarget.Global);

        expect(update).toHaveBeenNthCalledWith(1, GROUP_DISPLAY_PATH, undefined, vscode.ConfigurationTarget.Global);
        expect(update).toHaveBeenNthCalledWith(2, LEGACY_COLUMN_ORDER_PATH, undefined, vscode.ConfigurationTarget.Global);
    });

    it('writes only the key path for a key with no legacy entry', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (_path: string, default_value: unknown) => default_value,
            inspect: () => undefined,
            update,
        });

        await writeSetting('viewType', 'kanban', vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(VIEW_TYPE_PATH, 'kanban', vscode.ConfigurationTarget.Workspace);
    });
});

describe('savedDefaultOf is the baseline divergence is measured against', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is the built-in default when the user scope holds no value', () => {
        mockConfigStore({});
        expect(savedDefaultOf('excludeFilter')).toBe(SETTINGS.excludeFilter.default);
        expect(savedDefaultOf('groupDisplay')).toEqual(SETTINGS.groupDisplay.default);
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
        expect(isDivergedFromDefault('groupDisplay')).toBe(false);
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

    // groupDisplay is array-valued, and a stored array is never === a fresh one
    it('compares an array-valued key structurally, not by reference', () => {
        mockConfigStore({ [GROUP_DISPLAY_PATH]: { workspaceValue: [...SETTINGS.groupDisplay.default] } });
        expect(isDivergedFromDefault('groupDisplay')).toBe(false);
    });

    it('is true for an array-valued key whose members are reordered', () => {
        mockConfigStore({ [GROUP_DISPLAY_PATH]: { workspaceValue: [...SETTINGS.groupDisplay.default].reverse() } });
        expect(isDivergedFromDefault('groupDisplay')).toBe(true);
    });

    it('is true for an array-valued key of a different length', () => {
        mockConfigStore({ [GROUP_DISPLAY_PATH]: { workspaceValue: [SETTINGS.groupDisplay.default[0]] } });
        expect(isDivergedFromDefault('groupDisplay')).toBe(true);
    });

    // the entries are {value, shown} objects, so a changed `shown` with the same `value` order must register too
    it('is true for an array of objects whose members are structurally different but same length', () => {
        mockConfigStore({
            [GROUP_DISPLAY_PATH]: {
                workspaceValue: SETTINGS.groupDisplay.default.map((entry, index) => (index === 0 ? { ...entry, shown: false } : entry)),
            },
        });
        expect(isDivergedFromDefault('groupDisplay')).toBe(true);
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
            [GROUP_DISPLAY_PATH]: { workspaceValue: [{ value: 'done', shown: true }] },
            [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**' },
        });
        expect(divergedKeys().sort()).toEqual(['groupDisplay', 'viewType']);
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
            [GROUP_DISPLAY_PATH]: { workspaceValue: [{ value: 'done', shown: true }, { value: 'doing', shown: true }] },
            [EXCLUDE_PATH]: { workspaceValue: '**/{vendor}/**' },
        });
        expect(divergedKeys().sort()).toEqual(['excludeFilter', 'groupDisplay', 'viewType']);

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

describe('groupDisplay falls back to its legacy columnOrder path', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reads the legacy Workspace value, converted, when the new key has no Workspace value', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['done', 'doing'] } });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'done', shown: true }, { value: 'doing', shown: true }]);
    });

    it('reads the legacy Global (User) value, converted, when the new key has no Global value', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { globalValue: ['done'] } });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'done', shown: true }]);
    });

    it('prefers a new-key Workspace value over a legacy value at either scope', () => {
        mockConfigStore({
            [GROUP_DISPLAY_PATH]: { workspaceValue: [{ value: 'testing', shown: false }] },
            [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['done'], globalValue: ['doing'] },
        });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'testing', shown: false }]);
    });

    it('prefers a new-key Global value over a legacy Global value, per scope, before falling to the built-in default', () => {
        mockConfigStore({
            [GROUP_DISPLAY_PATH]: { globalValue: [{ value: 'testing', shown: true }] },
            [LEGACY_COLUMN_ORDER_PATH]: { globalValue: ['doing'] },
        });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'testing', shown: true }]);
    });

    it('prefers a legacy Workspace value over a new-key Global value, since Workspace always wins at read time', () => {
        mockConfigStore({
            [GROUP_DISPLAY_PATH]: { globalValue: [{ value: 'testing', shown: true }] },
            [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['doing'] },
        });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'doing', shown: true }]);
    });

    it('drops a non-string item from the legacy array rather than failing the whole read', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['done', 42, 'doing'] } });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'done', shown: true }, { value: 'doing', shown: true }]);
    });

    it('treats a non-array legacy value as absent, falling through to the built-in default', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: 'not-an-array' } });
        expect(readSetting('groupDisplay')).toEqual(SETTINGS.groupDisplay.default);
    });

    it('counts a legacy-only Workspace value as a Workspace override', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['done'] } });
        expect(hasWorkspaceOverride('groupDisplay')).toBe(true);
        expect(hasOverride('groupDisplay')).toBe(true);
    });

    it('counts a legacy-only Global value as an override, without it being a Workspace override', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { globalValue: ['done'] } });
        expect(hasWorkspaceOverride('groupDisplay')).toBe(false);
        expect(hasOverride('groupDisplay')).toBe(true);
    });

    it('reports no override when the only legacy value present is not an array', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: 'not-an-array' } });
        expect(hasOverride('groupDisplay')).toBe(false);
    });

    it('resolves savedDefaultOf from the legacy Global value when the new key has none there', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { globalValue: ['done'] } });
        expect(savedDefaultOf('groupDisplay')).toEqual([{ value: 'done', shown: true }]);
    });

    it('carries the converted value into the cascade payload under groupDisplay, never columnOrder', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['done'] } });
        const payload = buildSettingsCascadePayload();
        expect(payload.groupDisplay).toEqual([{ value: 'done', shown: true }]);
        expect(payload).not.toHaveProperty('columnOrder');
        expect(payload.diverged).toContain('groupDisplay');
        expect(payload.diverged as SettingKey[]).not.toContain('columnOrder');
    });

    // a revert clears the Workspace scope only; writeSetting's unconditional legacy clear is exercised separately above
    it('a simulated revert that clears the Workspace scope stops honouring the legacy Workspace value too', () => {
        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { workspaceValue: ['done'], globalValue: ['doing'] } });
        expect(readSetting('groupDisplay')).toEqual([{ value: 'done', shown: true }]);

        mockConfigStore({ [LEGACY_COLUMN_ORDER_PATH]: { globalValue: ['doing'] } });

        expect(readSetting('groupDisplay')).toEqual([{ value: 'doing', shown: true }]);
    });
});

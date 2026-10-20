import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import {
    CASCADE_KEY_DEFAULTS,
    FLAT_SETTINGS,
    applyBagDelta,
    buildDeclaredSettingsContributions,
    buildSettingsCascadePayload,
    editTarget,
    flatSettingKeys,
    hasFlatOverride,
    hasFlatWorkspaceOverride,
    isFlatDivergedFromDefault,
    promoteSettingsToUser,
    readBagCell,
    readFlatSetting,
    resetSettingsToDefault,
    restoreBuiltinDefaults,
    savedFlatDefaultOf,
    writeFlatSetting,
} from './settings';

const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', '..', '..', 'package.json');
const PACKAGE_NLS_PATHS = ['', '.de', '.es', '.fr', '.it'].map(suffix => path.join(__dirname, '..', '..', '..', '..', `package.nls${suffix}.json`));
// readFlatSetting passes no resource, so a key scoped per resource would silently ignore a folder's value
const RESOURCE_SCOPES = ['resource', 'language-overridable'];

interface ManifestSetting {
    scope?: string;
    description?: string;
}

interface FakeConfigEntry {
    workspaceValue?: unknown;
    globalValue?: unknown;
}

/** backs getConfiguration() with a store keyed by each declared setting's own config path; pass `update` to assert on writes */
function mockConfigStore(store: Record<string, FakeConfigEntry>, update: jest.Mock = jest.fn(async () => {})): jest.Mock {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: (config_path: string, default_value: unknown) => {
            const entry = store[config_path];
            return entry?.workspaceValue ?? entry?.globalValue ?? default_value;
        },
        inspect: (config_path: string) => ({
            workspaceValue: store[config_path]?.workspaceValue,
            globalValue: store[config_path]?.globalValue,
        }),
        update,
    });
    return update;
}

// point the mocked workspace at the given roots; undefined is the folderless case, a loose .md
function setWorkspaceRoots(roots: string[] | undefined): void {
    (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = roots
        ? roots.map((root, index) => ({ uri: vscode.Uri.file(root), name: root, index }))
        : undefined;
}

const EXCLUDE_PATH = FLAT_SETTINGS.excludeFilter.path;
const WATCH_PATH = FLAT_SETTINGS.watchUnopenedFilesInViewer.path;
const KANBAN_GROUP_BY_PATH = 'view.specific.kanban.groupBy';
const KANBAN_CARD_RATIO_PATH = 'view.specific.kanban.cardRatio';
const LINE_ORIENTATION_PATH = 'view.specific.line.orientation';
const ALLCARDS_SHOW_LINE_NUMBERS_PATH = 'card.generic.showLineNumbers';
const USER_TYPES_PATH = 'view.userTypes';

describe('FLAT_SETTINGS declares the five settings that belong to no tree', () => {

    it('every key declares a default, a config path, and a non-empty owning node', () => {
        for (const key of flatSettingKeys()) {
            expect(FLAT_SETTINGS[key].default).not.toBeUndefined();
            expect(typeof FLAT_SETTINGS[key].path).toBe('string');
            expect(FLAT_SETTINGS[key].path.length).toBeGreaterThan(0);
            expect(typeof FLAT_SETTINGS[key].node).toBe('string');
            expect(FLAT_SETTINGS[key].node.length).toBeGreaterThan(0);
        }
    });

    it('gives every key a distinct config path', () => {
        const paths = flatSettingKeys().map(key => FLAT_SETTINGS[key].path);
        expect(new Set(paths).size).toBe(paths.length);
    });

    // a resource-scoped contribution would promise per-folder values that no read here honours
    it('contributes every flat key, and every declared view/card key, at a scope that needs no resource to read', () => {
        const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { contributes: { configuration: Array<{ properties: Record<string, ManifestSetting> }> } };
        const properties: Record<string, ManifestSetting> = Object.assign({}, ...manifest.contributes.configuration.map(section => section.properties));
        for (const key of flatSettingKeys()) {
            const contribution = properties[`notethink.settings.${FLAT_SETTINGS[key].path}`];
            expect(contribution).toBeDefined();
            expect(RESOURCE_SCOPES).not.toContain(contribution.scope ?? 'window');
        }
        for (const declared_path of Object.keys(buildDeclaredSettingsContributions())) {
            expect(properties[declared_path]).toBeDefined();
            expect(RESOURCE_SCOPES).not.toContain(properties[declared_path].scope ?? 'window');
        }
    });
});

describe('buildDeclaredSettingsContributions - the single source of truth for package.json', () => {

    it('deep-equals package.json\'s notethink.settings.* properties', () => {
        const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { contributes: { configuration: Array<{ properties: Record<string, unknown> }> } };
        const all_properties: Record<string, unknown> = Object.assign({}, ...manifest.contributes.configuration.map(section => section.properties));
        const declared_properties: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(all_properties)) {
            if (key.startsWith('notethink.settings.')) { declared_properties[key] = value; }
        }
        expect(declared_properties).toEqual(buildDeclaredSettingsContributions());
    });

    it('declares a default only at a key\'s home node, never at a copy', () => {
        const contributions = buildDeclaredSettingsContributions();
        expect(contributions['notethink.settings.view.specific.grouped.groupBy'].default).toBe('auto');
        expect(contributions[KANBAN_GROUP_BY_PATH.replace(/^/, 'notethink.settings.')].default).toBeUndefined();
        expect(contributions['notethink.settings.view.specific.line.orientation'].default).toBe('columns');
        expect(contributions['notethink.settings.view.specific.kanban.orientation'].default).toBeUndefined();
    });

    it('names every description as a %config.settings.<path>.description% token present in all five nls files', () => {
        const contributions = buildDeclaredSettingsContributions();
        const nls_bundles = PACKAGE_NLS_PATHS.map(p => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>);
        for (const [declared_path, contribution] of Object.entries(contributions)) {
            const token_match = contribution.description.match(/^%(.+)%$/);
            expect(token_match).not.toBeNull();
            const nls_key = token_match![1];
            for (const bundle of nls_bundles) {
                expect(bundle[nls_key]).toBeDefined();
            }
            // the token's own path, modulo the leading "notethink.settings." the config key carries and the nls key doesn't
            expect(nls_key).toBe(`config.settings.${declared_path.slice('notethink.settings.'.length)}.description`);
        }
    });

    it('leaves no config.settings.* nls key that nothing in the table names', () => {
        const contributions = buildDeclaredSettingsContributions();
        const named_tokens = new Set(Object.values(contributions).flatMap(c => [c.description, c.markdownDeprecationMessage]).filter((t): t is string => t !== undefined).map(t => t.slice(1, -1)));
        const en_nls = JSON.parse(fs.readFileSync(PACKAGE_NLS_PATHS[0], 'utf-8')) as Record<string, string>;
        const unused = Object.keys(en_nls).filter(key => key.startsWith('config.settings.') && !named_tokens.has(key));
        expect(unused).toEqual([]);
    });
});

describe('flat setting override helpers', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('hasFlatWorkspaceOverride is true only for a Workspace-scope value, not a User-scope one', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{x}/**' } });
        expect(hasFlatWorkspaceOverride('excludeFilter')).toBe(false);
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '**/{x}/**' } });
        expect(hasFlatWorkspaceOverride('excludeFilter')).toBe(true);
    });

    it('hasFlatOverride is true for a Workspace OR a User value, false when neither is set', () => {
        mockConfigStore({});
        expect(hasFlatOverride('excludeFilter')).toBe(false);
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{x}/**' } });
        expect(hasFlatOverride('excludeFilter')).toBe(true);
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '' } });
        expect(hasFlatOverride('excludeFilter')).toBe(true);
    });

    // an empty-string Workspace value still counts as an override (the wiped-filter case): undefined is the only "no override"
    it('hasFlatOverride treats an empty-string value as a real override', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '' } });
        expect(hasFlatOverride('excludeFilter')).toBe(true);
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

describe('writeFlatSetting / readFlatSetting', () => {

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

        await writeFlatSetting('watchUnopenedFilesInViewer', false, vscode.ConfigurationTarget.Workspace);
        await writeFlatSetting('excludeFilter', '**/{x}/**', vscode.ConfigurationTarget.Global);

        expect(update).toHaveBeenNthCalledWith(1, WATCH_PATH, false, vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenNthCalledWith(2, EXCLUDE_PATH, '**/{x}/**', vscode.ConfigurationTarget.Global);
    });

    it('clears a scope by writing undefined, which is how reset and restore work', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (_path: string, default_value: unknown) => default_value,
            inspect: () => undefined,
            update,
        });

        await writeFlatSetting('excludeFilter', undefined, vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(EXCLUDE_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });

    it('reads the resolved value back, workspace over user over built-in default', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**', workspaceValue: '**/{tmp}/**' } });
        expect(readFlatSetting('excludeFilter')).toBe('**/{tmp}/**');
        mockConfigStore({});
        expect(readFlatSetting('excludeFilter')).toBe(FLAT_SETTINGS.excludeFilter.default);
    });
});

describe('savedFlatDefaultOf is the baseline a flat key\'s divergence is measured against', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is the built-in default when the user scope holds no value', () => {
        mockConfigStore({});
        expect(savedFlatDefaultOf('excludeFilter')).toBe(FLAT_SETTINGS.excludeFilter.default);
        expect(savedFlatDefaultOf('watchUnopenedFilesInViewer')).toBe(true);
    });

    it('is the user-scope value once one is set, whatever the workspace says', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**', workspaceValue: '**/{tmp}/**' } });
        expect(savedFlatDefaultOf('excludeFilter')).toBe('**/{vendor}/**');
    });

    // a user-scope false has to beat a truthy built-in, so the check is against undefined not falsiness
    it('honours a falsy user-scope value over a true built-in default', () => {
        mockConfigStore({ [WATCH_PATH]: { globalValue: false } });
        expect(savedFlatDefaultOf('watchUnopenedFilesInViewer')).toBe(false);
    });
});

describe('isFlatDivergedFromDefault', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('is false for a key sitting at its saved default', () => {
        mockConfigStore({});
        expect(isFlatDivergedFromDefault('excludeFilter')).toBe(false);
        expect(isFlatDivergedFromDefault('watchUnopenedFilesInViewer')).toBe(false);
    });

    it('is true for a workspace override that differs from the saved default', () => {
        mockConfigStore({ [WATCH_PATH]: { workspaceValue: false } });
        expect(isFlatDivergedFromDefault('watchUnopenedFilesInViewer')).toBe(true);
    });

    it('is false when the workspace value matches the user-scope value', () => {
        mockConfigStore({ [WATCH_PATH]: { globalValue: false, workspaceValue: false } });
        expect(isFlatDivergedFromDefault('watchUnopenedFilesInViewer')).toBe(false);
    });

    it('is false for a workspace override that just restates the built-in default', () => {
        mockConfigStore({ [WATCH_PATH]: { workspaceValue: FLAT_SETTINGS.watchUnopenedFilesInViewer.default } });
        expect(isFlatDivergedFromDefault('watchUnopenedFilesInViewer')).toBe(false);
    });
});

describe('buildSettingsCascadePayload assembles the views/cards bags from declared keys', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sends empty bags and every flat key at its built-in default with nothing stored', () => {
        mockConfigStore({});
        const payload = buildSettingsCascadePayload();
        expect(payload.views).toEqual({});
        expect(payload.cards).toEqual({});
        for (const key of flatSettingKeys()) {
            expect(payload[key]).toEqual(FLAT_SETTINGS[key].default);
        }
        expect(payload.diverged).toEqual([]);
        expect(payload.hasWorkspaceOverrides).toBe(false);
        expect(payload.hasAnyOverrides).toBe(false);
    });

    it('assembles one node\'s entry from its several declared keys at one scope', () => {
        mockConfigStore({
            [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' },
            [KANBAN_CARD_RATIO_PATH]: { workspaceValue: 2 },
        });
        expect(buildSettingsCascadePayload().views).toEqual({ kanban: { groupBy: 'assignee', cardRatio: 2 } });
    });

    it('merges per node per key across scopes, a Workspace cell winning without hiding a User-only sibling', () => {
        mockConfigStore({
            [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee', globalValue: 'owner' },
            [KANBAN_CARD_RATIO_PATH]: { globalValue: 2 },
            [LINE_ORIENTATION_PATH]: { globalValue: 'rows' },
        });
        const payload = buildSettingsCascadePayload();
        expect(payload.views).toEqual({
            kanban: { groupBy: 'assignee', cardRatio: 2 },
            line: { orientation: 'rows' },
        });
    });

    it('reports a flat key\'s divergence by its own name', () => {
        mockConfigStore({ [WATCH_PATH]: { workspaceValue: false } });
        expect(buildSettingsCascadePayload().diverged).toEqual(['watchUnopenedFilesInViewer']);
    });

    it('reports a diverged bag cell as bag:node:key, against the generic default when the User scope holds nothing', () => {
        mockConfigStore({ [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' } });
        // 'assignee' differs from groupBy's generic default ('auto'); the baseline is the key's default, not kanban's own
        expect(buildSettingsCascadePayload().diverged).toContain('views:kanban:groupBy');
    });

    it('reports nothing for a cell the Workspace and User scopes agree on', () => {
        mockConfigStore({ [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee', globalValue: 'assignee' } });
        expect(buildSettingsCascadePayload().diverged).not.toContain('views:kanban:groupBy');
    });

    it('reports nothing for a cell the Workspace scope holds nothing for, even when the User scope diverges from the default', () => {
        mockConfigStore({ [KANBAN_GROUP_BY_PATH]: { globalValue: 'assignee' } });
        expect(buildSettingsCascadePayload().diverged.some(key => key.startsWith('views:'))).toBe(false);
    });

    it('reports a cards bag cell the same way', () => {
        mockConfigStore({ [ALLCARDS_SHOW_LINE_NUMBERS_PATH]: { workspaceValue: true, globalValue: false } });
        expect(buildSettingsCascadePayload().diverged).toContain('cards:allcards:showLineNumbers');
    });

    it('a Workspace-only flat override sets both flags; a User-only one sets hasAnyOverrides alone', () => {
        mockConfigStore({ [EXCLUDE_PATH]: { globalValue: '**/{node_modules}/**' } });
        expect(buildSettingsCascadePayload().hasWorkspaceOverrides).toBe(false);
        expect(buildSettingsCascadePayload().hasAnyOverrides).toBe(true);
        mockConfigStore({ [EXCLUDE_PATH]: { workspaceValue: '**/{node_modules}/**' } });
        expect(buildSettingsCascadePayload().hasWorkspaceOverrides).toBe(true);
        expect(buildSettingsCascadePayload().hasAnyOverrides).toBe(true);
    });

    it('a Workspace bag entry alone sets both flags too', () => {
        mockConfigStore({ [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' } });
        const payload = buildSettingsCascadePayload();
        expect(payload.hasWorkspaceOverrides).toBe(true);
        expect(payload.hasAnyOverrides).toBe(true);
    });
});

describe('saved view types, read through view.userTypes', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reads a saved type\'s entry into the views bag, carrying parent and label alongside its overrides', () => {
        mockConfigStore({
            [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }] },
        });
        expect(buildSettingsCascadePayload().views).toEqual({ 'user-a': { parent: 'kanban', label: 'A', groupBy: 'assignee' } });
    });

    it('translates every 0.4.7 kanban-prefixed override name to its current short name', () => {
        mockConfigStore({
            [USER_TYPES_PATH]: {
                workspaceValue: [{
                    id: 'user-a', label: 'A', parent: 'kanban',
                    overrides: { kanbanGroupBy: 'assignee', kanbanCardRatio: 2, kanbanAnimateTransitions: false, kanbanDefaultCardType: 'sticky' },
                }],
            },
        });
        expect(buildSettingsCascadePayload().views['user-a']).toEqual({
            parent: 'kanban', label: 'A', groupBy: 'assignee', cardRatio: 2, animateTransitions: false, defaultCardType: 'sticky',
        });
    });

    it('keeps the short name when both the legacy and the short name are present', () => {
        mockConfigStore({
            [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee', groupBy: 'owner' } }] },
        });
        expect(buildSettingsCascadePayload().views['user-a']).toEqual({ parent: 'kanban', label: 'A', groupBy: 'owner' });
    });

    it('merges a saved type across User and Workspace scopes by id, key by key, like a built-in node', () => {
        mockConfigStore({
            [USER_TYPES_PATH]: {
                workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }],
                globalValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'owner', cardRatio: 2 } }],
            },
        });
        expect(buildSettingsCascadePayload().views['user-a']).toEqual({ parent: 'kanban', label: 'A', groupBy: 'assignee', cardRatio: 2 });
    });
});

describe('0.4.7 keys are read as a fallback for the cells that replaced them', () => {

    const CARD_KEYS = ['showLineNumbers', 'showLinetagsInHeadlines', 'autoExpandFocusedNote'] as const;
    const legacyCardPath = (key: string): string => `view.generic.${key}`;
    const newCardPath = (key: string): string => `card.generic.${key}`;
    const COLUMN_ORDER_PATH = 'view.specific.kanban.columnOrder';
    const GROUP_DISPLAY_PATH = 'view.specific.kanban.groupDisplay';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe.each(CARD_KEYS)('card key %s, formerly view.generic.%s', (key) => {

        it('reads the old Workspace value when the new key has no Workspace value', () => {
            mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: true } });
            expect(buildSettingsCascadePayload().cards).toEqual({ allcards: { [key]: true } });
        });

        it('reads the old User value when the new key has no User value', () => {
            mockConfigStore({ [legacyCardPath(key)]: { globalValue: true } });
            expect(readBagCell('cards', 'allcards', key)).toBe(true);
        });

        it('prefers the new key when both are set at the same scope', () => {
            mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: true }, [newCardPath(key)]: { workspaceValue: false } });
            expect(readBagCell('cards', 'allcards', key)).toBe(false);
        });

        it('gives nothing (so the built-in default applies) when neither key is set', () => {
            mockConfigStore({});
            expect(readBagCell('cards', 'allcards', key)).toBeUndefined();
            expect(buildSettingsCascadePayload().cards).toEqual({});
        });

        it('respects scope: a new Workspace value beats an old User value, an old Workspace value beats a new User value', () => {
            mockConfigStore({ [legacyCardPath(key)]: { globalValue: true }, [newCardPath(key)]: { workspaceValue: false } });
            expect(readBagCell('cards', 'allcards', key)).toBe(false);
            mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: true }, [newCardPath(key)]: { globalValue: false } });
            expect(readBagCell('cards', 'allcards', key)).toBe(true);
        });

        it('keeps the old value at its own scope: the User fallback shows beneath the Workspace one', () => {
            mockConfigStore({ [legacyCardPath(key)]: { globalValue: true }, [newCardPath(key)]: { workspaceValue: true } });
            const payload = buildSettingsCascadePayload();
            expect((payload.cards as Record<string, Record<string, unknown>>).allcards[key]).toBe(true);
            expect(payload.diverged).not.toContain(`cards:allcards:${key}`);
        });

        it('ignores an old value that is not a boolean', () => {
            mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: 'yes' } });
            expect(readBagCell('cards', 'allcards', key)).toBeUndefined();
        });

        it('counts an old Workspace value that differs from the default as diverged, like a new one', () => {
            mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: true } });
            expect(buildSettingsCascadePayload().diverged).toContain(`cards:allcards:${key}`);
        });

        it('does not count an old Workspace value that matches the old User value as diverged', () => {
            mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: true, globalValue: true } });
            expect(buildSettingsCascadePayload().diverged).not.toContain(`cards:allcards:${key}`);
        });

        it('does not count an old User value alone as diverged, though it sets hasAnyOverrides', () => {
            mockConfigStore({ [legacyCardPath(key)]: { globalValue: true } });
            const payload = buildSettingsCascadePayload();
            expect(payload.diverged).not.toContain(`cards:allcards:${key}`);
            expect(payload.hasWorkspaceOverrides).toBe(false);
            expect(payload.hasAnyOverrides).toBe(true);
        });

        it('never writes or clears the old key while reading it', () => {
            const update = mockConfigStore({ [legacyCardPath(key)]: { workspaceValue: true } });
            buildSettingsCascadePayload();
            expect(update).not.toHaveBeenCalled();
        });
    });

    describe('writing a replacing cell clears its old key at the same scope', () => {

        it('clears the old key at the written scope only, and only when it holds a value there', async () => {
            const update = mockConfigStore({ [legacyCardPath('showLineNumbers')]: { workspaceValue: true, globalValue: true } });
            await applyBagDelta('cards', [{ node_id: 'allcards', key: 'showLineNumbers', value: false }], vscode.ConfigurationTarget.Workspace);
            expect(update).toHaveBeenCalledTimes(2);
            expect(update).toHaveBeenNthCalledWith(1, newCardPath('showLineNumbers'), false, vscode.ConfigurationTarget.Workspace);
            expect(update).toHaveBeenNthCalledWith(2, legacyCardPath('showLineNumbers'), undefined, vscode.ConfigurationTarget.Workspace);
        });

        it('makes no extra update when the old key holds nothing at that scope', async () => {
            const update = mockConfigStore({ [legacyCardPath('showLineNumbers')]: { globalValue: true } });
            await applyBagDelta('cards', [{ node_id: 'allcards', key: 'showLineNumbers', value: false }], vscode.ConfigurationTarget.Workspace);
            expect(update).toHaveBeenCalledTimes(1);
            const absent = mockConfigStore({});
            await applyBagDelta('cards', [{ node_id: 'allcards', key: 'showLineNumbers', value: false }], vscode.ConfigurationTarget.Global);
            expect(absent).toHaveBeenCalledTimes(1);
        });

        it('clears the old columnOrder when groupDisplay is written', async () => {
            const update = mockConfigStore({ [COLUMN_ORDER_PATH]: { globalValue: ['done'] } });
            await applyBagDelta('views', [{ node_id: 'kanban', key: 'groupDisplay', value: [{ value: 'doing', shown: true }] }], vscode.ConfigurationTarget.Global);
            expect(update).toHaveBeenCalledWith(COLUMN_ORDER_PATH, undefined, vscode.ConfigurationTarget.Global);
        });

        it('leaves nothing to resurface when the new key is reset with the old one present', async () => {
            const store: Record<string, FakeConfigEntry> = { [legacyCardPath('showLineNumbers')]: { workspaceValue: true } };
            const update = mockConfigStore(store);
            update.mockImplementation(async (config_path: string, value: unknown) => { store[config_path] = { ...store[config_path], workspaceValue: value }; });
            await applyBagDelta('cards', [{ node_id: 'allcards', key: 'showLineNumbers', value: undefined }], vscode.ConfigurationTarget.Workspace);
            expect(readBagCell('cards', 'allcards', 'showLineNumbers')).toBeUndefined();
        });

        it('clears the old keys when a whole bag is reset at the workspace scope', async () => {
            const update = mockConfigStore({ [legacyCardPath('autoExpandFocusedNote')]: { workspaceValue: true } });
            await resetSettingsToDefault();
            expect(update).toHaveBeenCalledWith(legacyCardPath('autoExpandFocusedNote'), undefined, vscode.ConfigurationTarget.Workspace);
        });
    });

    describe('kanban.columnOrder, read as kanban groupDisplay', () => {

        it('reads the old Workspace value, converted, when groupDisplay has no Workspace value', () => {
            mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: ['done', 'doing'] } });
            expect(readBagCell('views', 'kanban', 'groupDisplay')).toEqual([{ value: 'done', shown: true }, { value: 'doing', shown: true }]);
        });

        it('reads the old User value, converted, when groupDisplay has no User value', () => {
            mockConfigStore({ [COLUMN_ORDER_PATH]: { globalValue: ['done'] } });
            expect(readBagCell('views', 'kanban', 'groupDisplay')).toEqual([{ value: 'done', shown: true }]);
        });

        it('stores no axis on a converted entry, so it reads as the status axis', () => {
            mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: ['done'] } });
            const entries = readBagCell('views', 'kanban', 'groupDisplay') as Array<Record<string, unknown>>;
            expect(entries[0]).not.toHaveProperty('axis');
        });

        it('prefers groupDisplay when both are set at the same scope', () => {
            mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: ['done'] }, [GROUP_DISPLAY_PATH]: { workspaceValue: [{ value: 'doing', shown: false }] } });
            expect(readBagCell('views', 'kanban', 'groupDisplay')).toEqual([{ value: 'doing', shown: false }]);
        });

        it('drops a non-string item and ignores a non-array old value', () => {
            mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: ['done', 7, null] } });
            expect(readBagCell('views', 'kanban', 'groupDisplay')).toEqual([{ value: 'done', shown: true }]);
            mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: 'done' } });
            expect(readBagCell('views', 'kanban', 'groupDisplay')).toBeUndefined();
        });

        it('carries the converted value under groupDisplay in the payload, never columnOrder, and counts it diverged', () => {
            mockConfigStore({ [COLUMN_ORDER_PATH]: { workspaceValue: ['done'] } });
            const payload = buildSettingsCascadePayload();
            expect(payload.views).toEqual({ kanban: { groupDisplay: [{ value: 'done', shown: true }] } });
            expect(payload.diverged).toContain('views:kanban:groupDisplay');
        });

        it('reads nothing once the old key is gone, and never writes while reading', () => {
            const update = mockConfigStore({});
            expect(readBagCell('views', 'kanban', 'groupDisplay')).toBeUndefined();
            expect(update).not.toHaveBeenCalled();
        });
    });

    describe('a saved type\'s legacy columnOrder override', () => {

        it('migrates to groupDisplay, every group shown, dropping columnOrder and keeping its other overrides', () => {
            mockConfigStore({
                [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-legacy', label: 'Legacy', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee', columnOrder: ['done', 'doing'] } }] },
            });
            expect(buildSettingsCascadePayload().views['user-legacy']).toEqual({
                parent: 'kanban', label: 'Legacy', groupBy: 'assignee', groupDisplay: [{ value: 'done', shown: true }, { value: 'doing', shown: true }],
            });
        });

        it('leaves groupDisplay alone when it is already present beside a stale columnOrder', () => {
            mockConfigStore({
                [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-legacy', label: 'Legacy', parent: 'kanban', overrides: { columnOrder: ['done'], groupDisplay: [{ value: 'doing', shown: false }] } }] },
            });
            expect(buildSettingsCascadePayload().views['user-legacy']).toEqual({
                parent: 'kanban', label: 'Legacy', groupDisplay: [{ value: 'doing', shown: false }],
            });
        });

        it('passes a non-array columnOrder through untouched', () => {
            mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-legacy', label: 'Legacy', parent: 'kanban', overrides: { columnOrder: 'done' } }] } });
            expect(buildSettingsCascadePayload().views['user-legacy']).toEqual({ parent: 'kanban', label: 'Legacy', columnOrder: 'done' });
        });

        it('is rewritten as groupDisplay when another override of the type is edited', async () => {
            const update = jest.fn(async () => {});
            mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-legacy', label: 'Legacy', parent: 'kanban', overrides: { columnOrder: ['done'] } }] } }, update);

            await applyBagDelta('views', [{ node_id: 'user-legacy', key: 'cardRatio', value: 2 }], vscode.ConfigurationTarget.Workspace);

            expect(update).toHaveBeenCalledWith(
                USER_TYPES_PATH,
                [{ id: 'user-legacy', label: 'Legacy', parent: 'kanban', overrides: { groupDisplay: [{ value: 'done', shown: true }], cardRatio: 2 } }],
                vscode.ConfigurationTarget.Workspace,
            );
        });
    });

    describe('the old keys stay declared, deprecated, so VS Code still returns their values', () => {

        it('declares each with a deprecation message token present in all five nls files', () => {
            const nls_bundles = PACKAGE_NLS_PATHS.map(p => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>);
            const contributions = buildDeclaredSettingsContributions();
            const old_paths = [...CARD_KEYS.map(legacyCardPath), COLUMN_ORDER_PATH];
            for (const old_path of old_paths) {
                const contribution = contributions[`notethink.settings.${old_path}`];
                expect(contribution.markdownDeprecationMessage).toBe(`%config.settings.${old_path}.deprecationMessage%`);
                expect(contribution.default).toBeUndefined();
                for (const bundle of nls_bundles) {
                    expect(bundle[`config.settings.${old_path}.deprecationMessage`]).toBeDefined();
                }
            }
        });
    });
});

describe('applyBagDelta - built-in node cells and saved-type entries', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('writes a built-in node\'s own declared key directly', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        await applyBagDelta('views', [{ node_id: 'kanban', key: 'groupBy', value: 'assignee' }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, 'assignee', vscode.ConfigurationTarget.Workspace);
    });

    it('clears a built-in node\'s own declared key by writing undefined', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        await applyBagDelta('views', [{ node_id: 'kanban', key: 'groupBy', value: undefined }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });

    it('logs and skips an op naming a key the node does not declare', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        await applyBagDelta('views', [{ node_id: 'document', key: 'groupBy', value: 'assignee' }], vscode.ConfigurationTarget.Workspace);

        expect(update).not.toHaveBeenCalled();
    });

    it('a null key with an object clears every other declared key of a built-in node, writing only what the replacement carries', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        await applyBagDelta('views', [{ node_id: 'kanban', key: null, value: { groupBy: 'assignee' } }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith('view.specific.kanban.scrollNoteIntoView', undefined, vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, 'assignee', vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenCalledWith('view.specific.kanban.cardRatio', undefined, vscode.ConfigurationTarget.Workspace);
    });

    it('mints a saved type via a null-key op, writing one view.userTypes entry', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: null, value: { parent: 'kanban', label: 'A', groupBy: 'assignee' } }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }], vscode.ConfigurationTarget.Workspace);
    });

    it('deletes a saved type via a null key with an undefined value, unsetting the list once it empties', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: {} }] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: null, value: undefined }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });

    it('edits a User-scope saved type from a workspace by writing a complete Workspace entry', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { globalValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: 'cardRatio', value: 2 }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { cardRatio: 2 } }], vscode.ConfigurationTarget.Workspace);
    });

    it('renames a saved type by setting its label, never storing the label as an override', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: 'label', value: 'Renamed' }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'Renamed', parent: 'kanban', overrides: { groupBy: 'assignee' } }], vscode.ConfigurationTarget.Workspace);
    });

    it('rewrites a 0.4.7 entry\'s overrides under their short names when one of them is edited', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { kanbanGroupBy: 'assignee', kanbanCardRatio: 2 } }] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: 'cardRatio', value: 3 }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee', cardRatio: 3 } }], vscode.ConfigurationTarget.Workspace);
    });

    it('sets one override field of an existing saved type, leaving its others alone', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: 'cardRatio', value: 2 }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee', cardRatio: 2 } }], vscode.ConfigurationTarget.Workspace);
    });

    it('clears one override field of a saved type by writing undefined', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee', cardRatio: 2 } }] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-a', key: 'cardRatio', value: undefined }], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }], vscode.ConfigurationTarget.Workspace);
    });

    it('logs and skips a per-key op naming a saved type neither scope holds', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [] } }, update);

        await applyBagDelta('views', [{ node_id: 'user-missing', key: 'groupBy', value: 'assignee' }], vscode.ConfigurationTarget.Workspace);

        expect(update).not.toHaveBeenCalled();
    });

    it('logs and skips an op naming an unknown node on the cards tree, which has no saved types', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        await applyBagDelta('cards', [{ node_id: 'user-made-up', key: 'showLineNumbers', value: true }], vscode.ConfigurationTarget.Workspace);

        expect(update).not.toHaveBeenCalled();
    });

    it('ignores a malformed op rather than throwing', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the malformed-input guard deliberately
        await applyBagDelta('views', [{ node_id: undefined, key: 'groupBy', value: 'x' } as any], vscode.ConfigurationTarget.Workspace);

        expect(update).not.toHaveBeenCalled();
    });

    it('applies every op in the same call, each against its own declared key', async () => {
        const update = jest.fn(async () => {});
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (_p: string, d: unknown) => d, inspect: () => ({}), update });

        await applyBagDelta('views', [
            { node_id: 'kanban', key: 'groupBy', value: 'assignee' },
            { node_id: 'kanban', key: 'cardRatio', value: 2 },
        ], vscode.ConfigurationTarget.Workspace);

        expect(update).toHaveBeenCalledTimes(2);
        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, 'assignee', vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenCalledWith(KANBAN_CARD_RATIO_PATH, 2, vscode.ConfigurationTarget.Workspace);
    });
});

describe('readBagCell', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reads the merged (Workspace-over-User) value for one node and key', () => {
        mockConfigStore({
            [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' },
            [KANBAN_CARD_RATIO_PATH]: { globalValue: 2 },
        });
        expect(readBagCell('views', 'kanban', 'groupBy')).toBe('assignee');
        expect(readBagCell('views', 'kanban', 'cardRatio')).toBe(2);
    });

    it('answers undefined for a cell nothing holds', () => {
        mockConfigStore({});
        expect(readBagCell('cards', 'allcards', 'showLineNumbers')).toBeUndefined();
    });
});

describe('promoteSettingsToUser / resetSettingsToDefault / restoreBuiltinDefaults', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('promote writes the merged value of every declared key to Global, and clears a Workspace override', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' } }, update);

        await promoteSettingsToUser();

        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, 'assignee', vscode.ConfigurationTarget.Global);
        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, undefined, vscode.ConfigurationTarget.Workspace);
        // every flat key is promoted unconditionally too
        for (const key of flatSettingKeys()) {
            expect(update).toHaveBeenCalledWith(FLAT_SETTINGS[key].path, FLAT_SETTINGS[key].default, vscode.ConfigurationTarget.Global);
        }
    });

    it('promote writes the merged saved-type list to Global, carrying parent and label', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({ [USER_TYPES_PATH]: { workspaceValue: [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }] } }, update);

        await promoteSettingsToUser();

        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, [{ id: 'user-a', label: 'A', parent: 'kanban', overrides: { groupBy: 'assignee' } }], vscode.ConfigurationTarget.Global);
        expect(update).toHaveBeenCalledWith(USER_TYPES_PATH, undefined, vscode.ConfigurationTarget.Workspace);
    });

    it('reset clears only a declared key or flat key actually holding a Workspace override', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({
            [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' },
            [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**' },
        }, update);

        await resetSettingsToDefault();

        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, undefined, vscode.ConfigurationTarget.Workspace);
        for (const other_key of Object.values(FLAT_SETTINGS)) {
            expect(update).not.toHaveBeenCalledWith(other_key.path, undefined, vscode.ConfigurationTarget.Workspace);
        }
    });

    it('restore clears both scopes for a declared key or flat key carrying an override at either one', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({
            [KANBAN_GROUP_BY_PATH]: { workspaceValue: 'assignee' },
            [EXCLUDE_PATH]: { globalValue: '**/{vendor}/**' },
        }, update);

        await restoreBuiltinDefaults();

        expect(update).toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, undefined, vscode.ConfigurationTarget.Workspace);
        // the mock holds no Global-scope views value at all, so there is nothing there to clear
        expect(update).not.toHaveBeenCalledWith(KANBAN_GROUP_BY_PATH, undefined, vscode.ConfigurationTarget.Global);
        expect(update).toHaveBeenCalledWith(EXCLUDE_PATH, undefined, vscode.ConfigurationTarget.Workspace);
        expect(update).toHaveBeenCalledWith(EXCLUDE_PATH, undefined, vscode.ConfigurationTarget.Global);
    });

    it('writes nothing on restore when nothing carries an override', async () => {
        const update = jest.fn(async () => {});
        mockConfigStore({}, update);

        await restoreBuiltinDefaults();

        expect(update).not.toHaveBeenCalled();
    });
});

describe('CASCADE_KEY_DEFAULTS mirrors the webview\'s per-key generic defaults', () => {
    it('declares a default for every cascade key the declared-key tables and the flat keys carry', () => {
        const bag_keys = [
            'viewType', 'cardType', 'showLinetagsInHeadlines', 'scrollNoteIntoView', 'autoExpandFocusedNote',
            'showLineNumbers', 'groupBy', 'orientation', 'lineBreadth', 'groupDisplay', 'groupOrder',
            'cardRatio', 'animateTransitions', 'defaultCardType', 'clockMode',
        ];
        for (const key of bag_keys) {
            expect((CASCADE_KEY_DEFAULTS as Record<string, unknown>)[key]).not.toBeUndefined();
        }
    });

    it('carries no entry for the five flat settings, which are declared in FLAT_SETTINGS instead', () => {
        for (const key of flatSettingKeys()) {
            expect((CASCADE_KEY_DEFAULTS as Record<string, unknown>)[key]).toBeUndefined();
        }
    });
});

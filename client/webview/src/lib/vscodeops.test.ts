import { getVscodeApi, migrateSavedState, postMessageToExtension, persistVscodeState, type VSCodeState } from "./vscodeops";

type VscodeApiMock = {
    getState: jest.Mock;
    setState: jest.Mock;
    postMessage: jest.Mock;
};

function buildApiMock(): VscodeApiMock {
    return {
        getState: jest.fn(() => undefined),
        setState: jest.fn(),
        postMessage: jest.fn(),
    };
}

describe('vscodeops', () => {

    // each test installs its own acquireVsCodeApi stub so we can observe singleton caching
    let acquire_spy: jest.Mock;

    beforeEach(() => {
        // clear the cached api on window between tests so getVscodeApi re-resolves
        delete (window as unknown as { __notethinkVscodeApi?: unknown }).__notethinkVscodeApi;
        acquire_spy = jest.fn(() => buildApiMock());
        (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = acquire_spy;
    });

    describe('getVscodeApi', () => {

        it('calls acquireVsCodeApi once and caches the result on window.__notethinkVscodeApi', () => {
            const first = getVscodeApi();
            const second = getVscodeApi();
            expect(acquire_spy).toHaveBeenCalledTimes(1);
            expect(first).toBe(second);
            expect((window as unknown as { __notethinkVscodeApi: unknown }).__notethinkVscodeApi).toBe(first);
        });

        it('reuses an api already cached on window.__notethinkVscodeApi without calling acquireVsCodeApi', () => {
            const pre_cached = buildApiMock();
            (window as unknown as { __notethinkVscodeApi: unknown }).__notethinkVscodeApi = pre_cached;
            const result = getVscodeApi();
            expect(result).toBe(pre_cached);
            expect(acquire_spy).not.toHaveBeenCalled();
        });

    });

    describe('postMessageToExtension', () => {

        it('forwards the message to the cached api.postMessage', () => {
            const api = buildApiMock();
            (window as unknown as { __notethinkVscodeApi: unknown }).__notethinkVscodeApi = api;
            const message = { type: 'updateSetting', setting: 'viewType', value: 'kanban' };
            postMessageToExtension(message);
            expect(api.postMessage).toHaveBeenCalledWith(message);
        });

    });

    describe('persistVscodeState', () => {

        it('forwards the state object to the cached api.setState', () => {
            const api = buildApiMock();
            (window as unknown as { __notethinkVscodeApi: unknown }).__notethinkVscodeApi = api;
            const state = { docs: {}, viewStates: { '__default': { type: 'document' } } };
            persistVscodeState(state);
            expect(api.setState).toHaveBeenCalledWith(state);
        });

    });

    describe('migrateSavedState', () => {

        it('returns undefined for undefined input', () => {
            expect(migrateSavedState(undefined)).toBeUndefined();
        });

        it('returns the input unchanged when viewStates is missing', () => {
            const input: VSCodeState = { docs: {} };
            const result = migrateSavedState(input);
            expect(result).toBe(input);
        });

        it('returns the input unchanged when viewStates is empty', () => {
            const input: VSCodeState = { viewStates: {} };
            const result = migrateSavedState(input);
            expect(result?.viewStates).toEqual({});
        });

        it('renames legacy folder-mode viewState key __aggregate__ → __folder__', () => {
            const input: VSCodeState = {
                viewStates: {
                    '__aggregate__': { type: 'kanban', display_options: { integration_mode: 'folder' } },
                },
            };
            const result = migrateSavedState(input);
            expect(result?.viewStates).toHaveProperty('__folder__');
            expect(result?.viewStates).not.toHaveProperty('__aggregate__');
            expect(result?.viewStates?.['__folder__'].type).toBe('kanban');
        });

        it('does not overwrite an existing __folder__ when __aggregate__ also present', () => {
            const input: VSCodeState = {
                viewStates: {
                    '__aggregate__': { type: 'kanban' },
                    '__folder__': { type: 'document' },
                },
            };
            const result = migrateSavedState(input);
            expect(result?.viewStates?.['__folder__'].type).toBe('document');
            // __aggregate__ key stays intact because the migration is gated on __folder__ being absent
            expect(result?.viewStates).toHaveProperty('__aggregate__');
        });

        it('migrates integration_mode "directory" → "folder"', () => {
            const input: VSCodeState = {
                viewStates: {
                    'v1': { display_options: { integration_mode: 'directory' } },
                },
            };
            const result = migrateSavedState(input);
            expect(result?.viewStates?.['v1'].display_options?.integration_mode).toBe('folder');
        });

        it('renames aggregate_include → includeFilter', () => {
            const input: VSCodeState = {
                viewStates: {
                    'v1': { display_options: { aggregate_include: '**/*.md' } as Record<string, unknown> },
                },
            };
            const result = migrateSavedState(input);
            const dopts = result?.viewStates?.['v1'].display_options as Record<string, unknown>;
            expect(dopts.includeFilter).toBe('**/*.md');
            expect(dopts).not.toHaveProperty('aggregate_include');
        });

        it('renames aggregate_exclude → excludeFilter', () => {
            const input: VSCodeState = {
                viewStates: {
                    'v1': { display_options: { aggregate_exclude: '**/node_modules/**' } as Record<string, unknown> },
                },
            };
            const result = migrateSavedState(input);
            const dopts = result?.viewStates?.['v1'].display_options as Record<string, unknown>;
            expect(dopts.excludeFilter).toBe('**/node_modules/**');
            expect(dopts).not.toHaveProperty('aggregate_exclude');
        });

        it('renames aggregate_max_notes_per_file → maxNotesPerFile', () => {
            const input: VSCodeState = {
                viewStates: {
                    'v1': { display_options: { aggregate_max_notes_per_file: 7 } as Record<string, unknown> },
                },
            };
            const result = migrateSavedState(input);
            const dopts = result?.viewStates?.['v1'].display_options as Record<string, unknown>;
            expect(dopts.maxNotesPerFile).toBe(7);
            expect(dopts).not.toHaveProperty('aggregate_max_notes_per_file');
        });

        it('migrates every viewState entry with display_options in one pass', () => {
            const input: VSCodeState = {
                viewStates: {
                    '__aggregate__': {
                        display_options: {
                            integration_mode: 'directory',
                            aggregate_include: '**/*.md',
                            aggregate_exclude: '',
                            aggregate_max_notes_per_file: 5,
                        } as Record<string, unknown>,
                    },
                    'doc-1': { display_options: { integration_mode: 'current_file' } },
                    'no-display-options': {},
                },
            };
            const result = migrateSavedState(input);
            expect(result?.viewStates).toHaveProperty('__folder__');
            const folder_opts = result?.viewStates?.['__folder__'].display_options as Record<string, unknown>;
            expect(folder_opts.integration_mode).toBe('folder');
            expect(folder_opts.includeFilter).toBe('**/*.md');
            expect(folder_opts.excludeFilter).toBe('');
            expect(folder_opts.maxNotesPerFile).toBe(5);
            // entries that don't need migration stay intact
            expect(result?.viewStates?.['doc-1'].display_options?.integration_mode).toBe('current_file');
            expect(result?.viewStates?.['no-display-options']).toEqual({});
        });

    });

});

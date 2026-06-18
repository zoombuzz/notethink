import { buildViewDisplayOptions } from "./composerops";
import { FOLDER_VIEW_STATE_ID } from "../notethink-views/src/lib/viewstateops";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from "../notethink-views/src/types/IntegrationMode";
import type { NoteRendererProps } from "../components/NoteRenderer";
import type { ViewState } from "../hooks/usePersistedViewStates";

function buildProps(overrides: Partial<NoteRendererProps> = {}): NoteRendererProps {
    return {
        notes: {},
        ...overrides,
    };
}

describe('composerops.buildViewDisplayOptions', () => {

    describe('current_file mode', () => {

        it('stamps integration_mode=current_file and integration_path=undefined when path is omitted', () => {
            const result = buildViewDisplayOptions(buildProps(), undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.integration_mode).toBe('current_file');
            expect(result.view_display_options.integration_path).toBeUndefined();
        });

        it('falls back to viewType=auto when neither viewState nor cascade has one', () => {
            const result = buildViewDisplayOptions(buildProps(), undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.viewType).toBe('auto');
        });

        it('overrides a stranded folder integration_mode on the per-doc viewState', () => {
            const view_state: ViewState = {
                display_options: { integration_mode: 'folder', integration_path: '/repo' },
            };
            const result = buildViewDisplayOptions(buildProps(), view_state, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.integration_mode).toBe('current_file');
            expect(result.view_display_options.integration_path).toBeUndefined();
        });

    });

    describe('folder mode', () => {

        it('stamps integration_mode=folder + integration_path on the rendered display_options', () => {
            const result = buildViewDisplayOptions(
                buildProps(),
                undefined,
                INTEGRATION_MODE_FOLDER,
                '/repo/notes',
            );
            expect(result.view_display_options.integration_mode).toBe('folder');
            expect(result.view_display_options.integration_path).toBe('/repo/notes');
        });

    });

    describe('cascade precedence', () => {

        it('per-session viewState type wins over the cascade viewType', () => {
            const view_state: ViewState = { type: 'document' };
            const props = buildProps({
                settingsCascade: {
                    viewType: 'kanban',
                    columnOrder: [],
                    includeFilter: '',
                    excludeFilter: '',
                    maxNotesPerFile: 10,
                    showContextBars: true,
                    hasWorkspaceOverrides: false,
                },
            });
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.viewType).toBe('document');
        });

        it('cascade viewType is used when the viewState does not set one', () => {
            const props = buildProps({
                settingsCascade: {
                    viewType: 'kanban',
                    columnOrder: [],
                    includeFilter: '',
                    excludeFilter: '',
                    maxNotesPerFile: 10,
                    showContextBars: true,
                    hasWorkspaceOverrides: false,
                },
            });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.viewType).toBe('kanban');
        });

        it('attaches cascade columnOrder to settings.columnOrder when non-empty', () => {
            const props = buildProps({
                settingsCascade: {
                    viewType: 'auto',
                    columnOrder: ['done', 'doing'],
                    includeFilter: '',
                    excludeFilter: '',
                    maxNotesPerFile: 10,
                    showContextBars: true,
                    hasWorkspaceOverrides: false,
                },
            });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.columnOrder).toEqual(['done', 'doing']);
        });

        it('does NOT attach columnOrder to settings when the cascade list is empty', () => {
            const props = buildProps({
                settingsCascade: {
                    viewType: 'auto',
                    columnOrder: [],
                    includeFilter: '',
                    excludeFilter: '',
                    maxNotesPerFile: 10,
                    showContextBars: true,
                    hasWorkspaceOverrides: false,
                },
            });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.columnOrder).toBeUndefined();
        });

        it('per-session viewState settings override cascade settings (showContextBars)', () => {
            const view_state: ViewState = {
                display_options: { settings: { showContextBars: false } },
            };
            const props = buildProps({
                settingsCascade: {
                    viewType: 'auto',
                    columnOrder: [],
                    includeFilter: '',
                    excludeFilter: '',
                    maxNotesPerFile: 10,
                    showContextBars: true,
                    hasWorkspaceOverrides: false,
                },
            });
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.showContextBars).toBe(false);
        });

        it('threads globalSettings showLineNumbers + watchUnopenedFilesInViewer through to settings', () => {
            const props = buildProps({
                globalSettings: { showLineNumbers: true, watchUnopenedFilesInViewer: false },
            });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.showLineNumbers).toBe(true);
            expect(result.view_display_options.settings?.watchUnopenedFilesInViewer).toBe(false);
        });

        it('falls back to globalSettings defaults (false / true) when no globalSettings provided', () => {
            const result = buildViewDisplayOptions(buildProps(), undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.showLineNumbers).toBe(false);
            expect(result.view_display_options.settings?.watchUnopenedFilesInViewer).toBe(true);
        });

    });

    describe('integration_mode_selection (persisted choice, always read from the canonical folder key)', () => {

        it('stamps integration_mode_selection=auto when no canonical folder state exists', () => {
            const result = buildViewDisplayOptions(buildProps(), undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.integration_mode_selection).toBe('auto');
        });

        it('carries an auto persisted selection alongside the resolved concrete integration_mode (folder)', () => {
            const props = buildProps({
                viewStates: { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'auto', integration_path: '/repo/portfolio' } } },
            });
            const view_state: ViewState = { display_options: { integration_mode: 'auto', integration_path: '/repo/portfolio' } };
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_FOLDER, '/repo/portfolio');
            // the selector shows "Auto (Folder)": selection stays auto, the resolved concrete mode is folder
            expect(result.view_display_options.integration_mode_selection).toBe('auto');
            expect(result.view_display_options.integration_mode).toBe('folder');
        });

        it('carries a concrete folder pin from the canonical key', () => {
            const props = buildProps({
                viewStates: { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder', integration_path: '/repo' } } },
            });
            const view_state: ViewState = { display_options: { integration_mode: 'folder', integration_path: '/repo' } };
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_FOLDER, '/repo');
            expect(result.view_display_options.integration_mode_selection).toBe('folder');
        });

        it('reads a current_file pin from the canonical key even though the current_file composer renders the doc-keyed view_state', () => {
            // the pin lives on FOLDER_VIEW_STATE_ID; the per-doc view_state NoteTreeComposer renders against has its mode explicitly cleared, so the selection must come from the canonical key (else the selector would mislabel a pinned "Current file" as "Auto (Current file)")
            const props = buildProps({
                viewStates: { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } } },
            });
            const doc_keyed_view_state: ViewState = { display_options: { integration_mode: undefined } };
            const result = buildViewDisplayOptions(props, doc_keyed_view_state, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.integration_mode).toBe('current_file');
            expect(result.view_display_options.integration_mode_selection).toBe('current_file');
        });

    });

    describe('viewState passthrough fields', () => {

        it('spreads viewState display_options before stamping the integration tag', () => {
            const view_state: ViewState = {
                display_options: { includeFilter: '**/*.md', maxNotesPerFile: 7 },
            };
            const result = buildViewDisplayOptions(
                buildProps(),
                view_state,
                INTEGRATION_MODE_FOLDER,
                '/repo',
            );
            // viewState fields survive
            expect(result.view_display_options.includeFilter).toBe('**/*.md');
            expect(result.view_display_options.maxNotesPerFile).toBe(7);
            // the integration tag wins over the viewState (spread-then-stamp)
            expect(result.view_display_options.integration_mode).toBe('folder');
            expect(result.view_display_options.integration_path).toBe('/repo');
        });

    });

});

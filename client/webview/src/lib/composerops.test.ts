import { buildViewDisplayOptions } from "./composerops";
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

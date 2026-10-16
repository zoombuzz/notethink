import { buildViewDisplayOptions } from "./composerops";
import { FOLDER_VIEW_STATE_ID } from "../notethink-views/src/lib/viewstateops";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from "../notethink-views/src/types/IntegrationMode";
import { DEFAULT_SETTINGS_CASCADE } from "../constants";
import type { SettingsCascadePayload } from "../notethink-views/src/types/Messages";
import type { NoteRendererProps } from "../components/NoteRenderer";
import type { ViewState } from "../hooks/usePersistedViewStates";

function buildCascade(overrides: Partial<SettingsCascadePayload> = {}): SettingsCascadePayload {
    return { ...DEFAULT_SETTINGS_CASCADE, ...overrides };
}

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
            const props = buildProps({ settingsCascade: buildCascade({ views: { root: { viewType: 'kanban' } } }) });
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.viewType).toBe('document');
        });

        it('cascade viewType is used when the viewState does not set one', () => {
            const props = buildProps({ settingsCascade: buildCascade({ views: { root: { viewType: 'kanban' } } }) });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.viewType).toBe('kanban');
        });

        it('attaches cascade groupDisplay to settings.groupDisplay when non-empty', () => {
            const entries = [{ value: 'done', shown: true }, { value: 'doing', shown: false }];
            const props = buildProps({ settingsCascade: buildCascade({ views: { grouped: { groupDisplay: entries } } }) });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.groupDisplay).toEqual(entries);
        });

        it('does NOT attach groupDisplay to settings when the cascade list is empty', () => {
            const props = buildProps({ settingsCascade: buildCascade({ views: { grouped: { groupDisplay: [] } } }) });
            const result = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.groupDisplay).toBeUndefined();
        });

        it('a stale per-session viewState settings block no longer overrides the cascade', () => {
            // the write path is gone, so a state persisted by an earlier build must not shadow config
            const view_state: ViewState = {
                display_options: { settings: { showLinetagsInHeadlines: true, showLineNumbers: true } },
            };
            const props = buildProps({
                settingsCascade: buildCascade({ cards: { allcards: { showLinetagsInHeadlines: false, showLineNumbers: false } } }),
            });
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.showLinetagsInHeadlines).toBe(false);
            expect(result.view_display_options.settings?.showLineNumbers).toBe(false);
        });

        it('threads every cascade value into settings, whichever node owns it', () => {
            const props = buildProps({
                settingsCascade: buildCascade({
                    cards: {
                        allcards: { showLineNumbers: true, autoExpandFocusedNote: true },
                    },
                    views: {
                        kanban: { animateTransitions: false },
                        line: { orientation: 'rows' },
                        grouped: { groupBy: 'project' },
                        root: { scrollNoteIntoView: false },
                    },
                    watchUnopenedFilesInViewer: false,
                    openNewEditorIfNoneOpen: true,
                    maxNotesPerFile: 4,
                }),
            });
            const settings = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE).view_display_options.settings;
            expect(settings?.showLineNumbers).toBe(true);
            expect(settings?.watchUnopenedFilesInViewer).toBe(false);
            expect(settings?.animateTransitions).toBe(false);
            expect(settings?.openNewEditorIfNoneOpen).toBe(true);
            expect(settings?.scrollNoteIntoView).toBe(false);
            expect(settings?.autoExpandFocusedNote).toBe(true);
            expect(settings?.orientation).toBe('rows');
            // read off the cascade's own flat home (grouped): that fold happens downstream in resolvedSettingsForView
            expect(settings?.groupBy).toBe('project');
            expect(settings?.maxNotesPerFile).toBe(4);
        });

        it('keeps the payload aggregates out of the settings block', () => {
            const props = buildProps({
                settingsCascade: buildCascade({ diverged: ['views:allcards:showLineNumbers'], hasWorkspaceOverrides: true, hasAnyOverrides: true }),
            });
            const settings = buildViewDisplayOptions(props, undefined, INTEGRATION_MODE_CURRENT_FILE).view_display_options.settings as Record<string, unknown>;
            expect(settings.diverged).toBeUndefined();
            expect(settings.hasWorkspaceOverrides).toBeUndefined();
            expect(settings.hasAnyOverrides).toBeUndefined();
        });

        it('falls back to the built-in cascade defaults when no cascade has arrived yet', () => {
            const result = buildViewDisplayOptions(buildProps(), undefined, INTEGRATION_MODE_CURRENT_FILE);
            expect(result.view_display_options.settings?.showLineNumbers).toBe(false);
            expect(result.view_display_options.settings?.watchUnopenedFilesInViewer).toBe(true);
            expect(result.view_display_options.settings?.scrollNoteIntoView).toBe(true);
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
            // the pin lives on FOLDER_VIEW_STATE_ID; the per-doc view_state has its mode explicitly cleared
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

    /*
     * Folding a saved type's own overrides (or a built-in view's own bag entry) onto the settings block
     * moved out of here entirely, into `resolvedSettingsForView` in viewregistryops.ts - called once per
     * rendered view by GenericView.tsx, and per row by the settings drawer for whichever node is selected
     * there. Composerops.buildViewDisplayOptions now always passes the RAW flat values through
     * `resolvedSettingsFromCascade` (one field per home node) and no further: folding a type's overrides
     * in here, ahead of that one resolver, would give the drawer no way to tell a flat home value from a
     * view's own, which is the bug ("selecting an ancestor shows the wrong value") the split avoids.
     * Coverage of the fold itself lives in viewregistryops.test.ts (`resolvedSettingsForView`) and
     * GenericView.test.tsx.
     */
    describe('minted view types are not folded here any more', () => {

        it('passes the home value through even when the rendered type is a saved type that overrides it', () => {
            const props = buildProps({
                settingsCascade: buildCascade({
                    views: {
                        grouped: { groupBy: 'status' },
                        'user-kanban-by-assignee': { parent: 'kanban', label: 'Kanban by Assignee', groupBy: 'assignee' },
                    },
                }),
            });
            const view_state: ViewState = { type: 'user-kanban-by-assignee' };
            const result = buildViewDisplayOptions(props, view_state, INTEGRATION_MODE_CURRENT_FILE);
            const settings = result.view_display_options.settings!;
            // the flat (home) value survives unresolved - GenericView.tsx resolves it for the rendered view
            expect(settings.groupBy).toBe('status');
            // the saved type is still recovered from the views bag, for the drawer and GenericView to resolve against
            expect(settings.viewUserTypes).toEqual([{ id: 'user-kanban-by-assignee', parent: 'kanban', label: 'Kanban by Assignee', overrides: { groupBy: 'assignee' } }]);
        });

    });

});

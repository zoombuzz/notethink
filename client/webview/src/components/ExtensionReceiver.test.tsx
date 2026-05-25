import React from 'react';
import { render, screen, act } from '@testing-library/react';
import Debug from 'debug';
import ExtensionReceiver from './ExtensionReceiver';

// mock the debug library so message-validation logging can be asserted (validation logs via the debug
// instance, not console). the spy is created inside the factory so it exists when the hooks' module-load
// `Debug(namespace)` calls run; every namespace returns the same shared spy
jest.mock('debug', () => {
    const mock_log = jest.fn();
    return { __esModule: true, default: () => mock_log };
});
// the shared spy the hooks log through (the mocked Debug ignores the namespace and returns the same fn)
const mockDebugLog = (Debug('test') as unknown) as jest.Mock;

// mock NoteRenderer to isolate ExtensionReceiver
const mockNoteRendererProps = jest.fn();
jest.mock('./NoteRenderer', () => {
    return {
        __esModule: true,
        default: (props: { notes: Record<string, unknown>; selections?: Record<string, unknown>; postMessage?: unknown; viewStates?: Record<string, unknown>; setViewManagedState?: unknown; onNavigationCommand?: unknown; globalSettings?: Record<string, unknown>; folderViewSettings?: Record<string, unknown> }) => {
            mockNoteRendererProps(props);
            return <div
                data-testid="NoteRenderer"
                data-note-count={Object.keys(props.notes).length}
                data-has-selections={props.selections ? 'true' : 'false'}
                data-view-states={JSON.stringify(props.viewStates || {})}
                data-global-settings={JSON.stringify(props.globalSettings || {})}
                data-folder-view-settings={JSON.stringify(props.folderViewSettings || {})}
            />;
        },
    };
});

describe('ExtensionReceiver', () => {
    let post_message_spy: jest.SpyInstance;

    beforeEach(() => {
        mockNoteRendererProps.mockClear();
        post_message_spy = jest.spyOn(
            acquireVsCodeApi(), 'postMessage'
        );
    });

    afterEach(() => {
        post_message_spy?.mockRestore();
    });

    it('renders NoteRenderer with initial empty docs', () => {
        render(<ExtensionReceiver />);
        const renderer = screen.getByTestId('NoteRenderer');
        expect(renderer).toBeInTheDocument();
        expect(renderer).toHaveAttribute('data-note-count', '0');
    });

    it('adds message event listener on mount', () => {
        const add_spy = jest.spyOn(window, 'addEventListener');
        render(<ExtensionReceiver />);
        expect(add_spy).toHaveBeenCalledWith('message', expect.any(Function));
        add_spy.mockRestore();
    });

    it('removes message event listener on unmount', () => {
        const remove_spy = jest.spyOn(window, 'removeEventListener');
        const { unmount } = render(<ExtensionReceiver />);
        unmount();
        expect(remove_spy).toHaveBeenCalledWith('message', expect.any(Function));
        remove_spy.mockRestore();
    });

    it('updates docs when receiving an update message', () => {
        render(<ExtensionReceiver />);
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: {
                        docs: {
                            'doc-1': { id: 'doc-1', path: '/test.md' },
                        },
                    },
                },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        expect(renderer).toHaveAttribute('data-note-count', '1');
    });

    it('replaces docs on each update (single-file view)', () => {
        render(<ExtensionReceiver />);
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: { docs: { 'a': { id: 'a', path: '/a.md' } } },
                },
            }));
        });
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: { docs: { 'b': { id: 'b', path: '/b.md' } } },
                },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        // second update replaces the first - only one doc at a time
        expect(renderer).toHaveAttribute('data-note-count', '1');
    });

    it('ignores messages with unknown type', () => {
        render(<ExtensionReceiver />);
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'unknown_type' },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        expect(renderer).toHaveAttribute('data-note-count', '0');
    });

    it('skips setState when doc hash_sha256 is unchanged', () => {
        const { rerender } = render(<ExtensionReceiver />);
        // send initial doc with hash
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: {
                        docs: {
                            'doc-1': { id: 'doc-1', path: '/test.md', hash_sha256: 'abc123' },
                        },
                    },
                },
            }));
        });
        expect(screen.getByTestId('NoteRenderer')).toHaveAttribute('data-note-count', '1');

        // send same doc with same hash - should not cause re-render issues
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: {
                        docs: {
                            'doc-1': { id: 'doc-1', path: '/test.md', hash_sha256: 'abc123' },
                        },
                    },
                },
            }));
        });
        expect(screen.getByTestId('NoteRenderer')).toHaveAttribute('data-note-count', '1');
    });

    it('updates state when doc hash_sha256 changes', () => {
        render(<ExtensionReceiver />);
        // send initial doc
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: {
                        docs: {
                            'doc-1': { id: 'doc-1', path: '/test.md', text: 'hello', hash_sha256: 'hash1' },
                        },
                    },
                },
            }));
        });
        expect(screen.getByTestId('NoteRenderer')).toHaveAttribute('data-note-count', '1');

        // send same doc with different hash - should update
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: {
                        docs: {
                            'doc-1': { id: 'doc-1', path: '/test.md', text: 'changed', hash_sha256: 'hash2' },
                        },
                    },
                },
            }));
        });
        expect(screen.getByTestId('NoteRenderer')).toHaveAttribute('data-note-count', '1');
    });

    it('passes viewStates and setViewManagedState to NoteRenderer', () => {
        render(<ExtensionReceiver />);
        const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];
        expect(last_call.viewStates).toEqual({});
        expect(typeof last_call.setViewManagedState).toBe('function');
        expect(last_call.onNavigationCommand).toBeDefined();
    });

    it('setViewType command creates default view state', () => {
        render(<ExtensionReceiver />);
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'command',
                    command: 'setViewType',
                    viewType: 'kanban',
                },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        const view_states = JSON.parse(renderer.getAttribute('data-view-states') || '{}');
        expect(view_states['__default']?.type).toBe('kanban');
    });

    it('setViewType command updates existing view states', () => {
        render(<ExtensionReceiver />);
        // first set a view state via setViewManagedState
        const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];
        act(() => {
            last_call.setViewManagedState([{ id: 'view-1', type: 'document' }]);
        });
        // then change via command
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'command',
                    command: 'setViewType',
                    viewType: 'kanban',
                },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        const view_states = JSON.parse(renderer.getAttribute('data-view-states') || '{}');
        expect(view_states['view-1']?.type).toBe('kanban');
    });

    it('globalSettings message updates globalSettings state', () => {
        render(<ExtensionReceiver />);
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'globalSettings',
                    settings: { show_line_numbers: true },
                },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        const global_settings = JSON.parse(renderer.getAttribute('data-global-settings') || '{}');
        expect(global_settings.show_line_numbers).toBe(true);
    });

    it('navigate command invokes callback ref', () => {
        render(<ExtensionReceiver />);
        const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];
        const mock_handler = jest.fn();
        last_call.onNavigationCommand.current = mock_handler;

        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'command',
                    command: 'navigate',
                    direction: 'down',
                },
            }));
        });

        expect(mock_handler).toHaveBeenCalledWith('down');
    });

    // --- Runtime validation tests ---

    describe('message validation', () => {

        beforeEach(() => {
            mockDebugLog.mockClear();
        });

        it('discards message with missing type (no state change)', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { partial: { docs: { 'x': { id: 'x' } } } },
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            expect(renderer).toHaveAttribute('data-note-count', '0');
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('missing or invalid type'),
                expect.anything(),
            );
        });

        it('discards message with non-string type', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 42 },
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            expect(renderer).toHaveAttribute('data-note-count', '0');
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('missing or invalid type'),
                expect.anything(),
            );
        });

        it('discards null message data', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: null,
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            expect(renderer).toHaveAttribute('data-note-count', '0');
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('missing or invalid type'),
                null,
            );
        });

        it('discards update message with missing partial.docs', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'update', partial: {} },
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            expect(renderer).toHaveAttribute('data-note-count', '0');
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('invalid partial.docs'),
                expect.anything(),
            );
        });

        it('discards update message with missing partial entirely', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'update' },
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            expect(renderer).toHaveAttribute('data-note-count', '0');
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('invalid partial.docs'),
                expect.anything(),
            );
        });

        it('discards selectionChanged message with missing selection', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'selectionChanged', docPath: '/test.md' },
                }));
            });
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('invalid selection'),
                expect.anything(),
            );
        });

        it('discards selectionChanged message with non-numeric head', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: {
                        type: 'selectionChanged',
                        docPath: '/test.md',
                        selection: { head: 'not-a-number', anchor: 0 },
                    },
                }));
            });
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('invalid selection'),
                expect.anything(),
            );
        });

        it('discards command message with missing command string', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'command' },
                }));
            });
            expect(mockDebugLog).toHaveBeenCalledWith(
                expect.stringContaining('invalid command'),
                expect.anything(),
            );
        });

        it('valid update message still works after validation', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: {
                        type: 'update',
                        partial: {
                            docs: { 'doc-v': { id: 'doc-v', path: '/v.md' } },
                        },
                    },
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            expect(renderer).toHaveAttribute('data-note-count', '1');
            expect(mockDebugLog).not.toHaveBeenCalledWith(expect.stringContaining('discarding'), expect.anything());
        });

        it('valid selectionChanged message still works after validation', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: {
                        type: 'selectionChanged',
                        docPath: '/test.md',
                        selection: { head: 5, anchor: 10 },
                    },
                }));
            });
            expect(mockDebugLog).not.toHaveBeenCalledWith(expect.stringContaining('discarding'), expect.anything());
        });

        it('valid command message still works after validation', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: {
                        type: 'command',
                        command: 'setViewType',
                        viewType: 'document',
                    },
                }));
            });
            expect(mockDebugLog).not.toHaveBeenCalledWith(expect.stringContaining('discarding'), expect.anything());
        });
    });

    describe('folder view cascade', () => {
        const FOLDER_KEY = '__folder__';

        it('threads folderViewSettings from the message into NoteRenderer props', () => {
            render(<ExtensionReceiver />);
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: {
                        type: 'folderViewSettings',
                        settings: {
                            view_type: 'kanban',
                            column_order: ['done', 'doing'],
                            include_filter: '**/notes/**',
                            exclude_filter: '',
                            max_notes_per_file: 5,
                            show_context_bars: false,
                            has_workspace_overrides: true,
                        },
                    },
                }));
            });
            const renderer = screen.getByTestId('NoteRenderer');
            const settings = JSON.parse(renderer.getAttribute('data-folder-view-settings') || '{}');
            expect(settings.view_type).toBe('kanban');
            expect(settings.column_order).toEqual(['done', 'doing']);
            expect(settings.max_notes_per_file).toBe(5);
            expect(settings.has_workspace_overrides).toBe(true);
        });

        it('setViewType command in folder mode round-trips to updateFolderViewSetting', () => {
            render(<ExtensionReceiver />);
            const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];
            // establish folder mode by writing the canonical viewState's integration_mode tag
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    display_options: { integration_mode: 'folder', integration_path: '/repo' },
                }]);
            });
            post_message_spy.mockClear();
            // fire the setViewType command (mirrors the keybinding / command palette path)
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'command', command: 'setViewType', viewType: 'kanban' },
                }));
            });
            // expect the cascade write (the only postMessage caused by this command in folder mode)
            const cascade_call = post_message_spy.mock.calls.find(
                c => c[0]?.type === 'updateFolderViewSetting' && c[0]?.setting === 'view_type'
            );
            expect(cascade_call).toBeDefined();
            expect(cascade_call![0]).toEqual({
                type: 'updateFolderViewSetting',
                setting: 'view_type',
                value: 'kanban',
            });
        });

        it('setViewType command in single-file mode does NOT round-trip to updateFolderViewSetting', () => {
            render(<ExtensionReceiver />);
            // no folder-tagged viewState exists; firing setViewType should not cascade
            post_message_spy.mockClear();
            act(() => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: { type: 'command', command: 'setViewType', viewType: 'document' },
                }));
            });
            const cascade_call = post_message_spy.mock.calls.find(
                c => c[0]?.type === 'updateFolderViewSetting'
            );
            expect(cascade_call).toBeUndefined();
        });
    });

    // when the integration_mode tag is dispatched to the canonical folder key, the folder viewState's other settings (column_order, filters, ...) must survive a flip to current_file and back
    describe('folder viewState survives integration_mode flip', () => {
        const FOLDER_KEY = '__folder__';

        it('flipping folder → current_file → folder preserves column_order and filters', () => {
            render(<ExtensionReceiver />);
            const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];

            // initial folder setup: user enters folder mode (dispatch matches GenericView.handleIntegrationChange)
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    display_options: {
                        integration_mode: 'folder',
                        integration_path: '/repo/notes',
                    },
                }]);
            });

            // user customises folder view: column reorder + custom include/exclude
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    type: 'kanban',
                    display_options: {
                        settings: { column_order: ['done', 'doing', 'todo'] },
                        include_filter: '**/todo.md',
                        exclude_filter: '',
                        max_notes_per_file: 5,
                    },
                }]);
            });

            // flip to current_file (handleIntegrationChange dispatches with id = FOLDER_KEY)
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    display_options: {
                        integration_mode: 'current_file',
                        integration_path: undefined,
                    },
                }]);
            });

            // flip back to folder
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    display_options: {
                        integration_mode: 'folder',
                        integration_path: '/repo/notes',
                    },
                }]);
            });

            const renderer = screen.getByTestId('NoteRenderer');
            const view_states = JSON.parse(renderer.getAttribute('data-view-states') || '{}');
            const folder_state = view_states[FOLDER_KEY];
            expect(folder_state).toBeDefined();
            expect(folder_state.type).toBe('kanban');
            expect(folder_state.display_options.integration_mode).toBe('folder');
            expect(folder_state.display_options.integration_path).toBe('/repo/notes');
            expect(folder_state.display_options.settings.column_order).toEqual(['done', 'doing', 'todo']);
            expect(folder_state.display_options.include_filter).toBe('**/todo.md');
            expect(folder_state.display_options.exclude_filter).toBe('');
            expect(folder_state.display_options.max_notes_per_file).toBe(5);
        });

        it('current_file flip writes the mode tag to the canonical key without stranding a doc-path orphan', () => {
            render(<ExtensionReceiver />);
            const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];

            // start in folder mode with settings
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    display_options: {
                        integration_mode: 'folder',
                        integration_path: '/repo',
                        settings: { column_order: ['a', 'b'] },
                    },
                }]);
            });

            // flip to current_file — dispatch targets canonical key, not any doc path
            act(() => {
                last_call.setViewManagedState([{
                    id: FOLDER_KEY,
                    display_options: {
                        integration_mode: 'current_file',
                        integration_path: undefined,
                    },
                }]);
            });

            const renderer = screen.getByTestId('NoteRenderer');
            const view_states = JSON.parse(renderer.getAttribute('data-view-states') || '{}');
            // no doc-path entry should have been created by the mode flip
            const keys = Object.keys(view_states);
            expect(keys).toEqual([FOLDER_KEY]);
            // settings preserved under the canonical key by the shallow merge in display_options
            expect(view_states[FOLDER_KEY].display_options.settings.column_order).toEqual(['a', 'b']);
            // tag flipped
            expect(view_states[FOLDER_KEY].display_options.integration_mode).toBe('current_file');
        });
    });
});

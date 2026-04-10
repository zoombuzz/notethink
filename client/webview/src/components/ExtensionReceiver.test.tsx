import React from 'react';
import { render, screen, act } from '@testing-library/react';
import ExtensionReceiver from './ExtensionReceiver';

// mock NoteRenderer to isolate ExtensionReceiver
const mockNoteRendererProps = jest.fn();
jest.mock('./NoteRenderer', () => {
    return {
        __esModule: true,
        default: (props: { notes: Record<string, unknown>; selections?: Record<string, unknown>; postMessage?: unknown; viewStates?: Record<string, unknown>; setViewManagedState?: unknown; onNavigationCommand?: unknown; globalSettings?: Record<string, unknown> }) => {
            mockNoteRendererProps(props);
            return <div
                data-testid="NoteRenderer"
                data-note-count={Object.keys(props.notes).length}
                data-has-selections={props.selections ? 'true' : 'false'}
                data-view-states={JSON.stringify(props.viewStates || {})}
                data-global-settings={JSON.stringify(props.globalSettings || {})}
            />;
        },
    };
});

describe('ExtensionReceiver', () => {
    let post_message_spy: jest.SpyInstance;

    beforeEach(() => {
        mockNoteRendererProps.mockClear();
        post_message_spy = jest.spyOn(
            (globalThis as any).acquireVsCodeApi(), 'postMessage'
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
        let warn_spy: jest.SpyInstance;

        beforeEach(() => {
            warn_spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            warn_spy.mockRestore();
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).toHaveBeenCalledWith(
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
            expect(warn_spy).not.toHaveBeenCalled();
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
            expect(warn_spy).not.toHaveBeenCalled();
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
            expect(warn_spy).not.toHaveBeenCalled();
        });
    });
});

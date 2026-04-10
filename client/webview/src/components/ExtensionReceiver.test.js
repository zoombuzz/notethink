import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, act } from '@testing-library/react';
import ExtensionReceiver from './ExtensionReceiver';
// mock NoteRenderer to isolate ExtensionReceiver
const mockNoteRendererProps = jest.fn();
jest.mock('./NoteRenderer', () => {
    return {
        __esModule: true,
        default: (props) => {
            mockNoteRendererProps(props);
            return _jsx("div", { "data-testid": "NoteRenderer", "data-note-count": Object.keys(props.notes).length, "data-has-selections": props.selections ? 'true' : 'false', "data-view-states": JSON.stringify(props.viewStates || {}) });
        },
    };
});
describe('ExtensionReceiver', () => {
    let post_message_spy;
    beforeEach(() => {
        mockNoteRendererProps.mockClear();
        post_message_spy = jest.spyOn(globalThis.acquireVsCodeApi(), 'postMessage');
    });
    afterEach(() => {
        post_message_spy?.mockRestore();
    });
    it('renders NoteRenderer with initial empty docs', () => {
        render(_jsx(ExtensionReceiver, {}));
        const renderer = screen.getByTestId('NoteRenderer');
        expect(renderer).toBeInTheDocument();
        expect(renderer).toHaveAttribute('data-note-count', '0');
    });
    it('adds message event listener on mount', () => {
        const add_spy = jest.spyOn(window, 'addEventListener');
        render(_jsx(ExtensionReceiver, {}));
        expect(add_spy).toHaveBeenCalledWith('message', expect.any(Function));
        add_spy.mockRestore();
    });
    it('removes message event listener on unmount', () => {
        const remove_spy = jest.spyOn(window, 'removeEventListener');
        const { unmount } = render(_jsx(ExtensionReceiver, {}));
        unmount();
        expect(remove_spy).toHaveBeenCalledWith('message', expect.any(Function));
        remove_spy.mockRestore();
    });
    it('updates docs when receiving an update message', () => {
        render(_jsx(ExtensionReceiver, {}));
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
    it('merges multiple update messages', () => {
        render(_jsx(ExtensionReceiver, {}));
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
        expect(renderer).toHaveAttribute('data-note-count', '2');
    });
    it('ignores messages with unknown type', () => {
        render(_jsx(ExtensionReceiver, {}));
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'unknown_type' },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        expect(renderer).toHaveAttribute('data-note-count', '0');
    });
    it('skips setState when doc hash_sha256 is unchanged', () => {
        const { rerender } = render(_jsx(ExtensionReceiver, {}));
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
        render(_jsx(ExtensionReceiver, {}));
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
        render(_jsx(ExtensionReceiver, {}));
        const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];
        expect(last_call.viewStates).toEqual({});
        expect(typeof last_call.setViewManagedState).toBe('function');
        expect(last_call.onNavigationCommand).toBeDefined();
    });
    it('setViewType command creates default view state', () => {
        render(_jsx(ExtensionReceiver, {}));
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
        render(_jsx(ExtensionReceiver, {}));
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
    it('toggleSetting command toggles show_line_numbers', () => {
        render(_jsx(ExtensionReceiver, {}));
        // create a view state first
        const last_call = mockNoteRendererProps.mock.calls[mockNoteRendererProps.mock.calls.length - 1][0];
        act(() => {
            last_call.setViewManagedState([{ id: 'view-1', type: 'document' }]);
        });
        // toggle line numbers
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'command',
                    command: 'toggleSetting',
                    setting: 'lineNumbers',
                },
            }));
        });
        const renderer = screen.getByTestId('NoteRenderer');
        const view_states = JSON.parse(renderer.getAttribute('data-view-states') || '{}');
        expect(view_states['view-1']?.display_options?.settings?.show_line_numbers).toBe(true);
    });
    it('navigate command invokes callback ref', () => {
        render(_jsx(ExtensionReceiver, {}));
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
});

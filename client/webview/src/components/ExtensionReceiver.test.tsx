import React from 'react';
import { render, screen, act } from '@testing-library/react';
import ExtensionReceiver from './ExtensionReceiver';

// mock NoteRenderer to isolate ExtensionReceiver
jest.mock('./NoteRenderer', () => {
    return {
        __esModule: true,
        default: (props: { notes: Record<string, unknown> }) => (
            <div data-testid="NoteRenderer" data-note-count={Object.keys(props.notes).length} />
        ),
    };
});

describe('ExtensionReceiver', () => {
    let post_message_spy: jest.SpyInstance;

    beforeEach(() => {
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

    it('merges multiple update messages', () => {
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
        expect(renderer).toHaveAttribute('data-note-count', '2');
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
});

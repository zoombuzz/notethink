import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Root as MdastRoot } from 'mdast';
import type { HashMapOf, Doc } from '../types/general';

// mock ESM-only dependencies that the webview jest config can't transform
jest.mock('hast-util-sanitize', () => ({ sanitize: (x: unknown) => x }));
jest.mock('mdast-util-to-hast', () => ({ toHast: (x: unknown) => x }));
jest.mock('hast-util-to-jsx-runtime', () => ({ toJsxRuntime: () => null }));

// mock convertMdastToNoteHierarchy to isolate NoteRenderer logic
jest.mock('../notethink-views/src/lib/convertMdastToNoteHierarchy', () => ({
    convertMdastToNoteHierarchy: jest.fn(() => ({
        seq: 0,
        level: 0,
        type: 'root',
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 2 } },
        children: [],
        children_body: [],
        headline_raw: '',
        body_raw: 'test',
    })),
}));

// mock GenericView (now the entry point instead of DocumentView)
jest.mock('../notethink-views/src/components', () => ({
    DocumentView: (props: { id: string }) => <div data-testid={`docview-${props.id}`}>DocumentView</div>,
    GenericView: (props: { id: string }) => <div data-testid={`docview-${props.id}`}>GenericView</div>,
    AutoView: (props: { id: string }) => <div data-testid={`autoview-${props.id}`}>AutoView</div>,
    BreadcrumbTrail: () => <div>BreadcrumbTrail</div>,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// import after mocks are set up
import NoteRenderer from './NoteRenderer';

describe('NoteRenderer', () => {
    it('renders container with testid', () => {
        render(<NoteRenderer notes={{}} />);
        expect(screen.getByTestId('NoteRenderer')).toBeInTheDocument();
    });

    it('skips notes without content', () => {
        const notes: HashMapOf<Doc> = {
            'abc': { id: 'abc', path: '/test.md' },
        };
        render(<NoteRenderer notes={notes} />);
        const container = screen.getByTestId('NoteRenderer');
        expect(container.children).toHaveLength(0);
    });

    it('renders GenericView when note has both content and text', () => {
        const notes: HashMapOf<Doc> = {
            'abc': {
                id: 'abc',
                path: '/test.md',
                content: { type: 'root', children: [] } as MdastRoot,
                text: '# Hello',
            },
        };
        render(<NoteRenderer notes={notes} />);
        expect(screen.getByTestId('docview-abc')).toBeInTheDocument();
    });

    it('renders fallback for notes with content but no text', () => {
        const notes: HashMapOf<Doc> = {
            'def': {
                id: 'def',
                path: '/test2.md',
                content: {
                    type: 'root',
                    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'hello' }] }],
                } as MdastRoot,
            },
        };
        const { container } = render(<NoteRenderer notes={notes} />);
        const fallback = container.querySelector('.note-renderer');
        expect(fallback).toBeInTheDocument();
    });

    it('current_file mode: renders only the most-recently-sent doc when the map has multiple entries', () => {
        // current_file mode by definition shows exactly one file - stale entries (folder→current_file transition state, message races) must not stack as extra single-file views; the most recent updateSentAt is the active doc by construction
        const notes: HashMapOf<Doc> = {
            'a': {
                id: 'a', path: '/a.md',
                content: { type: 'root', children: [] } as MdastRoot,
                text: '# A',
                updateSentAt: '2026-05-26T12:00:00.000Z',
            },
            'b': {
                id: 'b', path: '/b.md',
                content: { type: 'root', children: [] } as MdastRoot,
                text: '# B',
                updateSentAt: '2026-05-26T13:00:00.000Z',
            },
        };
        render(<NoteRenderer notes={notes} />);
        expect(screen.queryByTestId('docview-a')).not.toBeInTheDocument();
        expect(screen.getByTestId('docview-b')).toBeInTheDocument();
    });

    it('current_file mode: when no updateSentAt timestamps are present, deterministically picks the first entry', () => {
        const notes: HashMapOf<Doc> = {
            'a': {
                id: 'a', path: '/a.md',
                content: { type: 'root', children: [] } as MdastRoot,
                text: '# A',
            },
            'b': {
                id: 'b', path: '/b.md',
                content: { type: 'root', children: [] } as MdastRoot,
                text: '# B',
            },
        };
        render(<NoteRenderer notes={notes} />);
        expect(screen.getByTestId('docview-a')).toBeInTheDocument();
        expect(screen.queryByTestId('docview-b')).not.toBeInTheDocument();
    });
});

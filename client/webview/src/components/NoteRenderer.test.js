import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
// mock ESM-only dependencies that the webview jest config can't transform
jest.mock('hast-util-sanitize', () => ({ sanitize: (x) => x }));
jest.mock('mdast-util-to-hast', () => ({ toHast: (x) => x }));
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
    DocumentView: (props) => _jsx("div", { "data-testid": `docview-${props.id}`, children: "DocumentView" }),
    GenericView: (props) => _jsx("div", { "data-testid": `docview-${props.id}`, children: "GenericView" }),
    AutoView: (props) => _jsx("div", { "data-testid": `autoview-${props.id}`, children: "AutoView" }),
    BreadcrumbTrail: () => _jsx("div", { children: "BreadcrumbTrail" }),
}));
// import after mocks are set up
import NoteRenderer from './NoteRenderer';
describe('NoteRenderer', () => {
    it('renders container with testid', () => {
        render(_jsx(NoteRenderer, { notes: {} }));
        expect(screen.getByTestId('NoteRenderer')).toBeInTheDocument();
    });
    it('skips notes without content', () => {
        const notes = {
            'abc': { id: 'abc', path: '/test.md' },
        };
        render(_jsx(NoteRenderer, { notes: notes }));
        const container = screen.getByTestId('NoteRenderer');
        expect(container.children).toHaveLength(0);
    });
    it('renders GenericView when note has both content and text', () => {
        const notes = {
            'abc': {
                id: 'abc',
                path: '/test.md',
                content: { type: 'root', children: [] },
                text: '# Hello',
            },
        };
        render(_jsx(NoteRenderer, { notes: notes }));
        expect(screen.getByTestId('docview-abc')).toBeInTheDocument();
    });
    it('renders fallback for notes with content but no text', () => {
        const notes = {
            'def': {
                id: 'def',
                path: '/test2.md',
                content: {
                    type: 'root',
                    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'hello' }] }],
                },
            },
        };
        const { container } = render(_jsx(NoteRenderer, { notes: notes }));
        const fallback = container.querySelector('.note-renderer');
        expect(fallback).toBeInTheDocument();
    });
    it('renders multiple notes', () => {
        const notes = {
            'a': {
                id: 'a', path: '/a.md',
                content: { type: 'root', children: [] },
                text: '# A',
            },
            'b': {
                id: 'b', path: '/b.md',
                content: { type: 'root', children: [] },
                text: '# B',
            },
        };
        render(_jsx(NoteRenderer, { notes: notes }));
        expect(screen.getByTestId('docview-a')).toBeInTheDocument();
        expect(screen.getByTestId('docview-b')).toBeInTheDocument();
    });
});

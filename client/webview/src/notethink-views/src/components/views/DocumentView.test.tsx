import React from 'react';
import { render, screen } from '@testing-library/react';
import DocumentView from './DocumentView';
import GenericNoteAttributes from '../notes/GenericNoteAttributes';
import type { ViewProps } from '../../types/ViewProps';
import type { NoteProps } from '../../types/NoteProps';

// mock GenericNote so the document-strip tests render with a parent_context without pulling in the lazy MarkdownNote/CodeNote renderers; GenericNoteAttributes stays real (under test)
jest.mock('../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => (
        <div data-testid={`note-${props.seq}`} role="row" data-seq={props.seq}>{props.headline_raw}</div>
    ),
}));

// mock IntersectionObserver
beforeEach(() => {
    (global as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
        return {
            observe: (target: Element) => {
                callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver);
            },
            disconnect: jest.fn(),
            unobserve: jest.fn(),
        };
    });
    // mock getBoundingClientRect so elements appear visible in jsdom
    Element.prototype.getBoundingClientRect = jest.fn(() => ({
        top: 100, bottom: 200, left: 0, right: 600, width: 600, height: 100, x: 0, y: 100, toJSON() {},
    }));
});

describe('DocumentView', () => {
    const default_props: ViewProps = {
        id: 'test-doc',
        type: 'document',
        display_options: {},
    };

    it('renders document container with correct test id', () => {
        render(<DocumentView {...default_props} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toBeInTheDocument();
    });

    it('does not render a menubar element (native VS Code controls used instead)', () => {
        const { container } = render(<DocumentView {...default_props} />);
        const menubar = container.querySelector('[class*="menubar"]');
        expect(menubar).not.toBeInTheDocument();
    });

    it('applies correct id attribute to container', () => {
        render(<DocumentView {...default_props} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toHaveAttribute('id', 'vtest-doc-inner');
    });

    it('renders with display_options level data attribute', () => {
        const props_with_level: ViewProps = {
            ...default_props,
            display_options: { level: 2 },
        };
        render(<DocumentView {...props_with_level} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toHaveAttribute('data-level', '2');
    });

    it('renders context bar when setting enabled', () => {
        const props_with_context_bar: ViewProps = {
            ...default_props,
            display_options: {
                settings: { showContextBars: true },
            },
        };
        render(<DocumentView {...props_with_context_bar} />);
        const container = screen.getByTestId('document-test-doc-inner');
        expect(container).toBeInTheDocument();
    });
});

describe('DocumentView caret indicator', () => {
    let note_el: HTMLDivElement;
    let body_item_1: HTMLDivElement;
    let body_item_2: HTMLDivElement;

    let headline_el: HTMLDivElement;

    beforeEach(() => {
        note_el = document.createElement('div');
        note_el.id = 'vtest-doc-n5';

        headline_el = document.createElement('div');
        headline_el.setAttribute('role', 'rowheader');
        headline_el.dataset.offsetStart = '0';
        headline_el.dataset.offsetEnd = '9';
        note_el.appendChild(headline_el);

        body_item_1 = document.createElement('div');
        body_item_1.dataset.offsetStart = '10';
        body_item_1.dataset.offsetEnd = '50';
        note_el.appendChild(body_item_1);

        body_item_2 = document.createElement('div');
        body_item_2.dataset.offsetStart = '55';
        body_item_2.dataset.offsetEnd = '120';
        note_el.appendChild(body_item_2);

        document.body.appendChild(note_el);
    });

    afterEach(() => {
        document.body.removeChild(note_el);
    });

    function make_props(caret_offset: number): ViewProps {
        return {
            id: 'test-doc',
            type: 'document',
            display_options: {
                focused_seqs: [5],
            },
            selection: { main: { head: caret_offset, anchor: caret_offset } },
        };
    }

    it('adds caretTarget class to body item containing caret', () => {
        render(<DocumentView {...make_props(30)} />);
        expect(body_item_1.className).toMatch(/caretTarget/);
        expect(body_item_2.className).not.toMatch(/caretTarget/);
    });

    it('moves caretTarget when caret offset changes', () => {
        const { rerender } = render(<DocumentView {...make_props(30)} />);
        expect(body_item_1.className).toMatch(/caretTarget/);

        rerender(<DocumentView {...make_props(80)} />);
        expect(body_item_1.className).not.toMatch(/caretTarget/);
        expect(body_item_2.className).toMatch(/caretTarget/);
    });

    it('flashes headline when caret is outside body items', () => {
        render(<DocumentView {...make_props(5)} />);
        expect(headline_el.className).toMatch(/caretTarget/);
        expect(body_item_1.className).not.toMatch(/caretTarget/);
    });

    it('flashes headline when caret is within headline offset range', () => {
        render(<DocumentView {...make_props(5)} />);
        expect(headline_el.className).toMatch(/caretTarget/);
        expect(body_item_1.className).not.toMatch(/caretTarget/);
        expect(body_item_2.className).not.toMatch(/caretTarget/);
    });

    it('does not re-flash when caret moves within the same body item', () => {
        const { rerender } = render(<DocumentView {...make_props(30)} />);
        expect(body_item_1.className).toMatch(/caretTarget/);

        // remove class manually to detect whether a new flash is triggered
        body_item_1.classList.remove(...Array.from(body_item_1.classList));

        // move caret within the same body item (30 → 40, both in [10..50])
        rerender(<DocumentView {...make_props(40)} />);
        expect(body_item_1.className).not.toMatch(/caretTarget/);
    });

    it('does not flash anything when caret is in gap between content items', () => {
        // offset 52 is between body_item_1 (ends at 50) and body_item_2 (starts at 55)
        render(<DocumentView {...make_props(52)} />);
        expect(headline_el.className).not.toMatch(/caretTarget/);
        expect(body_item_1.className).not.toMatch(/caretTarget/);
        expect(body_item_2.className).not.toMatch(/caretTarget/);
    });

    it('removes caretTarget when focused_seqs is cleared', () => {
        const { rerender } = render(<DocumentView {...make_props(30)} />);
        expect(body_item_1.className).toMatch(/caretTarget/);

        rerender(<DocumentView
            id="test-doc"
            type="document"
            display_options={{}}
        />);
        expect(body_item_1.className).not.toMatch(/caretTarget/);
    });
});

describe('DocumentView document-level linetag strip', () => {
    const status_tag = { key: 'status', value: 'active', note_seq: 0, key_offset: 0, value_offset: 8, linktext_offset: 0 };
    const internal_tag = { key: 'nt_view', value: 'kanban', note_seq: 0, key_offset: 0, value_offset: 9, linktext_offset: 0 };
    const owner_tag = { key: 'owner', value: 'bob', note_seq: 3, key_offset: 0, value_offset: 7, linktext_offset: 0 };

    function makeRoot(linetags: NoteProps['linetags']): NoteProps {
        return {
            seq: 0,
            level: 0,
            type: 'root',
            children: [],
            children_body: [],
            position: { start: { offset: 0, line: 1 }, end: { offset: 200, line: 20 } },
            headline_raw: '',
            body_raw: '',
            linetags,
            linetags_from: 0,
        };
    }

    function makeDescended(linetags: NoteProps['linetags']): NoteProps {
        return {
            seq: 3,
            level: 2,
            type: 'markdown',
            children: [],
            children_body: [],
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            headline_raw: '## Descended',
            body_raw: '',
            linetags,
            linetags_from: 60,
        };
    }

    // mirror what GenericView hands down in single-file mode with front matter: the document root + its prebuilt strip element
    function docStrip(root: NoteProps): { document_strip: React.ReactElement; document_root: NoteProps } {
        return { document_strip: <GenericNoteAttributes {...root} />, document_root: root };
    }

    it('renders the document_strip handed down by GenericView at the single-file top level', () => {
        const root = makeRoot({ status: status_tag });
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: root, ...docStrip(root) }} />);
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.getByText('Status:')).toBeInTheDocument();
    });

    it('renders the front-matter pill exactly once at the top level (descended-context strip suppressed)', () => {
        const root = makeRoot({ status: status_tag });
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: root, ...docStrip(root) }} />);
        expect(screen.getAllByText('active')).toHaveLength(1);
        expect(screen.getAllByRole('list')).toHaveLength(1);
    });

    it('dedups by seq when parent_context is a CLONE of the root (the pipeline hands the view a clone)', () => {
        // useViewContext spreads notes[0] into parent_context, so the descended-strip dedup gates on seq (the root is seq 0), not object identity — otherwise the pills double
        const root = makeRoot({ status: status_tag });
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: { ...root }, ...docStrip(root) }} />);
        expect(screen.getAllByText('active')).toHaveLength(1);
        expect(screen.getAllByRole('list')).toHaveLength(1);
    });

    it('does not render an nt_-prefixed root linetag as a pill (internal-attribute hiding)', () => {
        const root = makeRoot({ status: status_tag, nt_view: internal_tag });
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: root, ...docStrip(root) }} />);
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.queryByText('kanban')).not.toBeInTheDocument();
    });

    it('keeps the document-scope pill and the descended note attribute when the user descends below the root', () => {
        const root = makeRoot({ status: status_tag });
        const descended = makeDescended({ owner: owner_tag });
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: descended, ...docStrip(root) }} />);
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getAllByText('active')).toHaveLength(1);
    });

    it('renders only the descended note attribute when GenericView hands down no document_strip (folder mode)', () => {
        const descended = makeDescended({ owner: owner_tag });
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: descended }} />);
        expect(screen.queryByText('active')).not.toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
    });

    it('renders no strip when there is no document_strip and the context note has no linetags', () => {
        const root = makeRoot(undefined);
        render(<DocumentView id="test-doc" type="document" nested={{ parent_context: root }} />);
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
});

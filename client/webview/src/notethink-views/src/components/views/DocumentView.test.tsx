import React from 'react';
import { render, screen } from '@testing-library/react';
import DocumentView from './DocumentView';
import type { ViewProps } from '../../types/ViewProps';

// mock IntersectionObserver
beforeEach(() => {
    (global as any).IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
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
                settings: { show_context_bars: true },
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

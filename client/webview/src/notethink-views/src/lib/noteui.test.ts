import type { MouseEvent } from 'react';
import type { NoteProps, ClickPositionInfo } from '../types/NoteProps';
import { extractOffsetFromClickTarget, countTextCharsUpTo, findCharAtPoint, refineOffsetWithSelection, createNoteClickHandler, bodyClickPosition, headlineClickPosition } from './noteui';

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 1,
        children_body: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 200, line: 20 },
        },
        children: [],
        headline_raw: '# Test',
        body_raw: 'body text',
        ...overrides,
    };
}

function makeMouseEvent(target: HTMLElement, currentTarget: HTMLElement, clientX = 0, clientY = 0): MouseEvent<HTMLElement> {
    return { target, currentTarget, clientX, clientY } as unknown as MouseEvent<HTMLElement>;
}

describe('extractOffsetFromClickTarget', () => {
    it('returns offset from the target element itself', () => {
        const el = document.createElement('div');
        el.dataset.offsetStart = '150';
        const container = document.createElement('div');
        container.appendChild(el);
        const event = makeMouseEvent(el, container);
        expect(extractOffsetFromClickTarget(event)).toBe(150);
    });

    it('walks up to find ancestor with data-offset-start', () => {
        const container = document.createElement('div');
        const wrapper = document.createElement('div');
        wrapper.dataset.offsetStart = '75';
        const strong = document.createElement('strong');
        const text_span = document.createElement('span');
        strong.appendChild(text_span);
        wrapper.appendChild(strong);
        container.appendChild(wrapper);
        const event = makeMouseEvent(text_span, container);
        expect(extractOffsetFromClickTarget(event)).toBe(75);
    });

    it('returns undefined when no ancestor has data-offset-start', () => {
        const container = document.createElement('div');
        const child = document.createElement('p');
        container.appendChild(child);
        const event = makeMouseEvent(child, container);
        expect(extractOffsetFromClickTarget(event)).toBeUndefined();
    });

    it('does not search past currentTarget boundary', () => {
        const outer = document.createElement('div');
        outer.dataset.offsetStart = '999';
        const container = document.createElement('div');
        const child = document.createElement('p');
        container.appendChild(child);
        outer.appendChild(container);
        const event = makeMouseEvent(child, container);
        expect(extractOffsetFromClickTarget(event)).toBeUndefined();
    });

    it('finds data-offset-start on the currentTarget itself', () => {
        const container = document.createElement('div');
        container.dataset.offsetStart = '42';
        const child = document.createElement('p');
        container.appendChild(child);
        const event = makeMouseEvent(child, container);
        expect(extractOffsetFromClickTarget(event)).toBe(42);
    });

    it('returns the closest ancestor offset (not a further one)', () => {
        const container = document.createElement('div');
        const outer_wrapper = document.createElement('div');
        outer_wrapper.dataset.offsetStart = '50';
        const inner_wrapper = document.createElement('div');
        inner_wrapper.dataset.offsetStart = '100';
        const span = document.createElement('span');
        inner_wrapper.appendChild(span);
        outer_wrapper.appendChild(inner_wrapper);
        container.appendChild(outer_wrapper);
        const event = makeMouseEvent(span, container);
        expect(extractOffsetFromClickTarget(event)).toBe(100);
    });
});

describe('countTextCharsUpTo', () => {
    it('counts characters to target node', () => {
        const root = document.createElement('div');
        const text1 = document.createTextNode('Hello ');
        const text2 = document.createTextNode('world');
        root.appendChild(text1);
        root.appendChild(text2);
        expect(countTextCharsUpTo(root, text2, 3)).toBe(9); // "Hello " (6) + "wor" (3)
    });

    it('counts through nested elements', () => {
        const root = document.createElement('div');
        const p = document.createElement('p');
        const text1 = document.createTextNode('Some ');
        const strong = document.createElement('strong');
        const bold_text = document.createTextNode('bold');
        strong.appendChild(bold_text);
        const text2 = document.createTextNode(' text');
        p.appendChild(text1);
        p.appendChild(strong);
        p.appendChild(text2);
        root.appendChild(p);
        // click at offset 2 in " text" → 5 + 4 + 2 = 11
        expect(countTextCharsUpTo(root, text2, 2)).toBe(11);
    });

    it('returns 0 + target_offset for the first text node', () => {
        const root = document.createElement('div');
        const text = document.createTextNode('hello');
        root.appendChild(text);
        expect(countTextCharsUpTo(root, text, 3)).toBe(3);
    });

    it('returns total text length when target not found', () => {
        const root = document.createElement('div');
        root.appendChild(document.createTextNode('hello'));
        const other = document.createTextNode('other');
        expect(countTextCharsUpTo(root, other, 0)).toBe(5);
    });
});

describe('findCharAtPoint', () => {
    const orig_getBCR = Range.prototype.getBoundingClientRect;

    type SingleLineLayout = { left: number, right: number, top: number, bottom: number };
    type MultiLineLayout = { lines: Array<{ start: number, end: number } & SingleLineLayout> };
    let layout_map: Map<Text, SingleLineLayout | MultiLineLayout>;

    function makeRect(r: SingleLineLayout): DOMRect {
        return { ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect;
    }

    function charRect(entry: SingleLineLayout | MultiLineLayout, node: Text, char_index: number): DOMRect {
        if ('lines' in entry) {
            for (const line of entry.lines) {
                if (char_index >= line.start && char_index < line.end) {
                    const char_width = (line.right - line.left) / (line.end - line.start);
                    const char_left = line.left + (char_index - line.start) * char_width;
                    return makeRect({ left: char_left, right: char_left + char_width, top: line.top, bottom: line.bottom });
                }
            }
            return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
        }
        const char_width = (entry.right - entry.left) / node.length;
        const char_left = entry.left + char_index * char_width;
        return makeRect({ left: char_left, right: char_left + char_width, top: entry.top, bottom: entry.bottom });
    }

    function fullRect(entry: SingleLineLayout | MultiLineLayout): DOMRect {
        if ('lines' in entry) {
            return makeRect({
                left: Math.min(...entry.lines.map(l => l.left)),
                right: Math.max(...entry.lines.map(l => l.right)),
                top: entry.lines[0].top,
                bottom: entry.lines[entry.lines.length - 1].bottom,
            });
        }
        return makeRect(entry);
    }

    beforeEach(() => {
        layout_map = new Map();
        Range.prototype.getBoundingClientRect = function () {
            for (const [node, entry] of layout_map) {
                if (this.startContainer === node || this.endContainer === node) {
                    if (this.startOffset === 0 && this.endOffset === node.length) {
                        return fullRect(entry);
                    }
                    return charRect(entry, node, this.startOffset);
                }
            }
            return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
        };
    });

    afterEach(() => {
        Range.prototype.getBoundingClientRect = orig_getBCR;
    });

    it('finds the character at the click point', () => {
        const wrapper = document.createElement('div');
        const text = document.createTextNode('Hello world');
        wrapper.appendChild(text);
        document.body.appendChild(wrapper);
        layout_map.set(text, { left: 0, right: 110, top: 0, bottom: 16 });

        // 10px per char; click at x=55 → char 5 center=55, past center → char 6
        expect(findCharAtPoint(wrapper, 55, 8)).toBe(6);
        // click at x=5 → char 0 center=5, at center → char 1
        expect(findCharAtPoint(wrapper, 5, 8)).toBe(1);
        document.body.removeChild(wrapper);
    });

    it('returns undefined when click is outside all text nodes', () => {
        const wrapper = document.createElement('div');
        const text = document.createTextNode('hello');
        wrapper.appendChild(text);
        document.body.appendChild(wrapper);
        layout_map.set(text, { left: 0, right: 50, top: 0, bottom: 16 });

        // click Y below the text node
        expect(findCharAtPoint(wrapper, 25, 20)).toBeUndefined();
        document.body.removeChild(wrapper);
    });

    it('counts across inline elements', () => {
        const wrapper = document.createElement('div');
        const text1 = document.createTextNode('AB');
        const strong = document.createElement('strong');
        const text2 = document.createTextNode('CD');
        strong.appendChild(text2);
        wrapper.appendChild(text1);
        wrapper.appendChild(strong);
        document.body.appendChild(wrapper);
        layout_map.set(text1, { left: 0, right: 20, top: 0, bottom: 16 });
        layout_map.set(text2, { left: 20, right: 40, top: 0, bottom: 16 });

        // click at x=25 → in text2, char 0 center=25, past center → char_count(2) + 1 = 3
        expect(findCharAtPoint(wrapper, 25, 8)).toBe(3);
        document.body.removeChild(wrapper);
    });

    it('handles multiline text - clicks on correct line', () => {
        const wrapper = document.createElement('div');
        // "Hello " (6 chars, line 1) + "world" (5 chars, line 2) = 11 chars
        const text = document.createTextNode('Hello world');
        wrapper.appendChild(text);
        document.body.appendChild(wrapper);
        layout_map.set(text, {
            lines: [
                { start: 0, end: 6, left: 0, right: 60, top: 0, bottom: 16 },
                { start: 6, end: 11, left: 0, right: 50, top: 16, bottom: 32 },
            ],
        });

        // click on line 1 at x=25, y=8 → char 2 (center of char 2 = 25) → past center → 3
        expect(findCharAtPoint(wrapper, 25, 8)).toBe(3);
        // click on line 2 at x=25, y=24 → char offset 6 + 2 (center=25) → past center → 9
        expect(findCharAtPoint(wrapper, 25, 24)).toBe(9);
        // click past end of line 2 at x=55, y=24 → last char on line 2 is index 10, return 11
        expect(findCharAtPoint(wrapper, 55, 24)).toBe(11);
        document.body.removeChild(wrapper);
    });
});

describe('refineOffsetWithSelection', () => {
    it('falls back to base_offset when no wrapper found', () => {
        const container = document.createElement('div');
        const child = document.createElement('p');
        container.appendChild(child);
        const event = makeMouseEvent(child, container, 50, 10);
        expect(refineOffsetWithSelection(event, 100)).toBe(100);
    });

    it('falls back when findCharAtPoint returns undefined (no layout)', () => {
        const container = document.createElement('div');
        const wrapper = document.createElement('div');
        wrapper.dataset.offsetStart = '100';
        wrapper.appendChild(document.createTextNode('hello'));
        container.appendChild(wrapper);
        // jsdom returns zero-rects - findCharAtPoint returns undefined
        const event = makeMouseEvent(wrapper, container, 50, 10);
        expect(refineOffsetWithSelection(event, 100)).toBe(100);
    });
});

describe('createNoteClickHandler - offset-aware clicks', () => {
    it('overrides from with data-offset-start for body clicks', () => {
        const note = makeNote();
        let captured_position: ClickPositionInfo | undefined;
        note.handlers = {
            click: (_event, _note, position) => { captured_position = position; },
        };
        const position = bodyClickPosition(note);
        const handler = createNoteClickHandler(note, position);

        // simulate clicking a body item with data-offset-start=150
        const container = document.createElement('div');
        const body_item = document.createElement('div');
        body_item.dataset.offsetStart = '150';
        body_item.dataset.offsetEnd = '180';
        container.appendChild(body_item);
        const event = makeMouseEvent(body_item, container) as unknown as MouseEvent<HTMLElement> & { stopPropagation?: () => void };

        handler(event as MouseEvent<HTMLElement>);
        expect(captured_position?.from).toBe(150);
        expect(captured_position?.type).toBe('note_body');
    });

    it('falls back to original position when no data-offset-start found', () => {
        const note = makeNote();
        let captured_position: ClickPositionInfo | undefined;
        note.handlers = {
            click: (_event, _note, position) => { captured_position = position; },
        };
        const position = bodyClickPosition(note);
        const handler = createNoteClickHandler(note, position);

        // simulate clicking the body container itself (no data-offset-start)
        const container = document.createElement('div');
        const event = makeMouseEvent(container, container);

        handler(event as MouseEvent<HTMLElement>);
        expect(captured_position?.from).toBe(note.position.end.offset);
    });

    it('overrides from with data-offset-start for headline clicks too', () => {
        const note = makeNote();
        let captured_position: ClickPositionInfo | undefined;
        note.handlers = {
            click: (_event, _note, position) => { captured_position = position; },
        };
        const position = headlineClickPosition(note);
        const handler = createNoteClickHandler(note, position);

        // headline element has data-offset-start=42
        const container = document.createElement('div');
        const headline = document.createElement('div');
        headline.dataset.offsetStart = '42';
        container.appendChild(headline);
        const event = makeMouseEvent(headline, container);

        handler(event as MouseEvent<HTMLElement>);
        // from is overridden by data-offset-start (42), not headlineClickPosition's from (0)
        expect(captured_position?.from).toBe(42);
        expect(captured_position?.type).toBe('note_headline');
    });

    it('preserves selection_from/selection_to when overriding from', () => {
        const selectable = makeNote({ seq: 2, position: { start: { offset: 5, line: 1 }, end: { offset: 15, line: 2 }, end_body: { offset: 100, line: 10 } } });
        const note = makeNote({
            display_options: { deepest: { selectable_note: selectable } },
        });
        let captured_position: ClickPositionInfo | undefined;
        note.handlers = {
            click: (_event, _note, position) => { captured_position = position; },
        };
        const position = bodyClickPosition(note);
        const handler = createNoteClickHandler(note, position);

        const container = document.createElement('div');
        const body_item = document.createElement('div');
        body_item.dataset.offsetStart = '60';
        container.appendChild(body_item);
        const event = makeMouseEvent(body_item, container);

        handler(event as MouseEvent<HTMLElement>);
        expect(captured_position?.from).toBe(60);
        expect(captured_position?.selection_from).toBe(selectable.position.start.offset);
        expect(captured_position?.selection_to).toBe(selectable.position.end_body?.offset);
    });
});

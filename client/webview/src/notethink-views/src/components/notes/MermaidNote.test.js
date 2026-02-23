import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import MermaidNote from './MermaidNote';
// mock MermaidDiagram
jest.mock('./MermaidDiagram', () => ({
    MermaidDiagram: (props) => (_jsx("div", { "data-testid": "mermaid-diagram", className: props.className, onClick: props.onClick, children: props.children })),
}));
// mock GenericNoteAttributes
jest.mock('./GenericNoteAttributes', () => ({
    __esModule: true,
    default: (props) => _jsx("div", { "data-testid": "note-attributes", children: "attributes" }),
}));
function makeNote(overrides = {}) {
    return {
        seq: 1,
        level: 1,
        type: 'code',
        lang: 'mermaid',
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 50, line: 5 },
        },
        headline_raw: '```mermaid',
        body_raw: 'graph TD\n    A-->B',
        ...overrides,
    };
}
describe('MermaidNote', () => {
    it('renders note container with correct id', () => {
        const note = makeNote({
            display_options: { id: 'v1-n1' },
        });
        const { container } = render(_jsx(MermaidNote, { ...note }));
        expect(container.querySelector('#v1-n1')).toBeInTheDocument();
    });
    it('renders MermaidDiagram with body_raw content', () => {
        render(_jsx(MermaidNote, { ...makeNote() }));
        expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument();
        expect(screen.getByTestId('mermaid-diagram')).toHaveTextContent('graph TD');
    });
    it('applies focused class when note is focused', () => {
        const note = makeNote({ focused: true });
        const { container } = render(_jsx(MermaidNote, { ...note }));
        const note_element = container.firstChild;
        expect(note_element.className).toContain('focused');
    });
    it('applies selected class when note is selected', () => {
        const note = makeNote({ selected: true });
        const { container } = render(_jsx(MermaidNote, { ...note }));
        const note_element = container.firstChild;
        expect(note_element.className).toContain('selected');
    });
    it('does not apply focused/selected classes when not set', () => {
        const note = makeNote();
        const { container } = render(_jsx(MermaidNote, { ...note }));
        const note_element = container.firstChild;
        expect(note_element.className).not.toContain('focused');
        expect(note_element.className).not.toContain('selected');
    });
    it('renders GenericNoteAttributes when linetags are present', () => {
        const note = makeNote({
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        render(_jsx(MermaidNote, { ...note }));
        expect(screen.getByTestId('note-attributes')).toBeInTheDocument();
    });
    it('does not render GenericNoteAttributes when no linetags', () => {
        render(_jsx(MermaidNote, { ...makeNote() }));
        expect(screen.queryByTestId('note-attributes')).not.toBeInTheDocument();
    });
    it('applies data props from note', () => {
        const note = makeNote({ seq: 5 });
        const { container } = render(_jsx(MermaidNote, { ...note }));
        const note_element = container.firstChild;
        expect(note_element).toHaveAttribute('data-seq', '5');
        expect(note_element).toHaveAttribute('data-mdast-type', 'code');
    });
    it('sets aria-current and aria-selected attributes', () => {
        const note = makeNote({ focused: true, selected: false });
        render(_jsx(MermaidNote, { ...note }));
        const row = screen.getByRole('row');
        expect(row).toHaveAttribute('aria-current', 'true');
        expect(row).toHaveAttribute('aria-selected', 'false');
    });
    it('passes draggable props when provided', () => {
        const inner_ref = jest.fn();
        const note = makeNote({
            display_options: {
                provided: {
                    draggableProps: { 'data-rfd-draggable-id': '1' },
                    dragHandleProps: { 'data-rfd-drag-handle': 'true' },
                    innerRef: inner_ref,
                },
            },
        });
        const { container } = render(_jsx(MermaidNote, { ...note }));
        const note_element = container.firstChild;
        expect(note_element).toHaveAttribute('data-rfd-draggable-id', '1');
        expect(inner_ref).toHaveBeenCalled();
    });
});

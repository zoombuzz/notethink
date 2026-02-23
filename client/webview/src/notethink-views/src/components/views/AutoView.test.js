import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import AutoView from './AutoView';
// mock GenericView since AutoView delegates to it
jest.mock('./GenericView', () => ({
    __esModule: true,
    default: (props) => (_jsxs("div", { "data-testid": "generic-view", "data-type": props.type, "data-parent-context-seq": props.display_options?.parent_context_seq, "data-level": props.display_options?.level, children: ["GenericView type=", props.type] })),
}));
function makeNote(overrides = {}) {
    return {
        seq: 0,
        level: 1,
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
        },
        headline_raw: '# Root',
        body_raw: '',
        ...overrides,
    };
}
function makeViewProps(overrides = {}) {
    return {
        id: 'test-auto',
        type: 'auto',
        display_options: {},
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
        },
        ...overrides,
    };
}
describe('AutoView', () => {
    it('renders without error', () => {
        render(_jsx(AutoView, { ...makeViewProps() }));
        expect(screen.getByTestId('generic-view')).toBeInTheDocument();
    });
    it('defaults to document view type when no linetags', () => {
        render(_jsx(AutoView, { ...makeViewProps() }));
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-type', 'document');
    });
    it('wraps in a fullheight container with data-auto-selected-viewtype', () => {
        const { container } = render(_jsx(AutoView, { ...makeViewProps() }));
        const wrapper = container.querySelector('[data-auto-selected-viewtype]');
        expect(wrapper).toBeInTheDocument();
        expect(wrapper).toHaveAttribute('data-auto-selected-viewtype', 'document');
    });
    it('derives kanban view type from focused_notes linetags', () => {
        const focused_note = makeNote({
            seq: 1,
            linetags: {
                'ng_view': { key: 'ng_view', value: 'kanban', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes: [makeNote(), focused_note],
            display_options: {
                focused_notes: [focused_note],
            },
        });
        render(_jsx(AutoView, { ...props }));
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-type', 'kanban');
    });
    it('sets parent_context_seq from the ng_view note', () => {
        const focused_note = makeNote({
            seq: 3,
            linetags: {
                'ng_view': { key: 'ng_view', value: 'kanban', note_seq: 3, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes: [makeNote(), makeNote({ seq: 1 }), makeNote({ seq: 2 }), focused_note],
            display_options: {
                focused_notes: [focused_note],
            },
        });
        render(_jsx(AutoView, { ...props }));
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-parent-context-seq', '3');
    });
    it('derives level from ng_level linetag', () => {
        const focused_note = makeNote({
            seq: 1,
            linetags: {
                'ng_level': { key: 'ng_level', value: '3', value_numeric: 3, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            display_options: {
                focused_notes: [focused_note],
            },
        });
        render(_jsx(AutoView, { ...props }));
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-level', '3');
    });
    it('updates data-auto-selected-viewtype attribute when kanban derived', () => {
        const focused_note = makeNote({
            seq: 1,
            linetags: {
                'ng_view': { key: 'ng_view', value: 'kanban', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes: [makeNote(), focused_note],
            display_options: {
                focused_notes: [focused_note],
            },
        });
        const { container } = render(_jsx(AutoView, { ...props }));
        const wrapper = container.querySelector('[data-auto-selected-viewtype]');
        expect(wrapper).toHaveAttribute('data-auto-selected-viewtype', 'kanban');
    });
});

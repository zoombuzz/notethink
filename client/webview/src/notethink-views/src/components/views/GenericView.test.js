import { jsx as _jsx } from "react/jsx-runtime";
import { Suspense, createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import GenericView from './GenericView';
// mock lazy-loaded view components — capture props for click handler testing
const mockDocViewRender = jest.fn();
const mockKanbanViewRender = jest.fn();
const mockAutoViewRender = jest.fn();
jest.mock('./AutoView', () => ({
    __esModule: true,
    default: (props) => {
        mockAutoViewRender(props);
        return _jsx("div", { "data-testid": "auto-view", "data-id": props.id, children: "AutoView" });
    },
}));
jest.mock('./DocumentView', () => ({
    __esModule: true,
    default: (props) => {
        mockDocViewRender(props);
        return _jsx("div", { "data-testid": "document-view", "data-id": props.id, children: "DocumentView" });
    },
}));
jest.mock('./KanbanView', () => ({
    __esModule: true,
    default: (props) => {
        mockKanbanViewRender(props);
        return _jsx("div", { "data-testid": "kanban-view", "data-id": props.id, children: "KanbanView" });
    },
}));
// mock BreadcrumbTrail
jest.mock('./BreadcrumbTrail', () => ({
    __esModule: true,
    default: (props) => _jsx("div", { "data-testid": "breadcrumb-trail", children: "BreadcrumbTrail" }),
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
            end_body: { offset: 50, line: 5 },
        },
        headline_raw: '# Root',
        body_raw: '',
        ...overrides,
    };
}
function makeViewProps(overrides = {}) {
    return {
        id: 'test-view',
        type: 'document',
        display_options: {},
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
            postMessage: jest.fn(),
        },
        ...overrides,
    };
}
function mockClickEvent(overrides = {}) {
    return {
        detail: 1,
        target: {},
        stopPropagation: jest.fn(),
        ...overrides,
    };
}
/** Get the handlers passed to the most recent DocumentView render */
function getDocViewHandlers() {
    const calls = mockDocViewRender.mock.calls;
    return calls[calls.length - 1][0].handlers;
}
beforeEach(() => {
    mockDocViewRender.mockClear();
    mockKanbanViewRender.mockClear();
    mockAutoViewRender.mockClear();
});
describe('GenericView', () => {
    it('renders DocumentView for type "document"', async () => {
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({ type: 'document' }) }) }));
        await waitFor(() => expect(screen.getByTestId('document-view')).toBeInTheDocument());
    });
    it('renders AutoView for type "auto"', async () => {
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({ type: 'auto' }) }) }));
        await waitFor(() => expect(screen.getByTestId('auto-view')).toBeInTheDocument());
    });
    it('renders KanbanView for type "kanban"', async () => {
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({ type: 'kanban' }) }) }));
        await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());
    });
    it('computes display_options with default settings', async () => {
        const props = makeViewProps({
            type: 'document',
            notes: [makeNote({ seq: 0, level: 1, child_notes: [makeNote({ seq: 1, level: 2 })] })],
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...props }) }));
        await waitFor(() => expect(screen.getByTestId('document-view')).toBeInTheDocument());
    });
    it('computes focused notes when selection is provided', async () => {
        const child_note = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 40, line: 4 } },
        });
        const root_note = makeNote({
            seq: 0, level: 1,
            child_notes: [child_note],
        });
        const props = makeViewProps({
            type: 'document',
            notes: [root_note, child_note],
            selection: { main: { head: 15, anchor: 15 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...props }) }));
        await waitFor(() => expect(screen.getByTestId('document-view')).toBeInTheDocument());
    });
    it('does not render any view for unknown type', async () => {
        const { container } = render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({ type: 'unknown' }) }) }));
        expect(container.querySelector('[data-testid]')).toBeNull();
    });
});
describe('GenericView click state machine', () => {
    it('first click on unfocused note sends revealRange', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const click_profile = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 50,
            type: 'note_headline',
        };
        handlers.click(mockClickEvent(), child, click_profile);
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 10,
        });
    });
    it('second click on focused note (same position) sends selectRange', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        // Render with selection.main.head === 10 (simulating response from first click)
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    selection: { main: { head: 10, anchor: 10 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const click_profile = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 50,
            type: 'note_headline',
        };
        handlers.click(mockClickEvent(), child, click_profile);
        expect(post_message).toHaveBeenCalledWith({
            type: 'selectRange',
            from: 10,
            to: 50,
        });
    });
    it('click on selected note sends revealRange (deselects)', async () => {
        const post_message = jest.fn();
        const child = makeNote({
            seq: 1, level: 2,
            selected: true,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const root = makeNote({ seq: 0, level: 1, child_notes: [child] });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    selection: { main: { head: 10, anchor: 50 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const click_profile = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 50,
            type: 'note_headline',
        };
        handlers.click(mockClickEvent(), child, click_profile);
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 10,
        });
    });
    it('click on a different unfocused note sends revealRange with new position', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child_a = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const child_b = makeNote({
            seq: 2, level: 2,
            position: { start: { offset: 60, line: 6 }, end: { offset: 80, line: 7 }, end_body: { offset: 100, line: 9 } },
        });
        // selection on child_a (head=10), click on child_b
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child_a, child_b],
                    selection: { main: { head: 10, anchor: 10 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const click_profile = {
            from: 60, to: 80,
            selection_from: 60, selection_to: 100,
            type: 'note_headline',
        };
        handlers.click(mockClickEvent(), child_b, click_profile);
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 60,
        });
    });
    it('delegates to singleClick handler when set', async () => {
        const post_message = jest.fn();
        const single_click = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            handlers: { singleClick: single_click },
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const click_profile = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 30,
            type: 'note_headline',
        };
        handlers.click(mockClickEvent({ detail: 1 }), child, click_profile);
        expect(single_click).toHaveBeenCalledWith(expect.anything(), child, click_profile);
        // should NOT send revealRange when delegating
        expect(post_message).not.toHaveBeenCalled();
    });
    it('delegates to doubleClick handler when set', async () => {
        const post_message = jest.fn();
        const double_click = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            handlers: { doubleClick: double_click },
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const click_profile = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 30,
            type: 'note_headline',
        };
        handlers.click(mockClickEvent({ detail: 2 }), child, click_profile);
        expect(double_click).toHaveBeenCalledWith(expect.anything(), child, click_profile);
        // should NOT send selectRange when delegating
        expect(post_message).not.toHaveBeenCalled();
    });
    it('checkbox click sends editText message', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            body_raw: '- [ ] do something\n',
            position: { start: { offset: 10, line: 2 }, end: { offset: 20, line: 3 }, end_body: { offset: 40, line: 4 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        // simulate checkbox element
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        const label = document.createTextNode(' do something');
        const parent = document.createElement('label');
        parent.appendChild(checkbox);
        parent.appendChild(label);
        const click_profile = {
            from: 10, to: 20,
            selection_from: 10, selection_to: 40,
            type: 'note_body',
        };
        handlers.click(mockClickEvent({ target: checkbox }), child, click_profile);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({
            type: 'editText',
        }));
    });
    it('getClearHandler sends revealRange past the focused note end', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const clear_handler = handlers.getClearHandler([child]);
        clear_handler(mockClickEvent());
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 51,
        });
    });
    it('stopPropagation is called on click events', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 } },
        });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        const handlers = getDocViewHandlers();
        const event = mockClickEvent();
        handlers.click(event, child, {
            from: 10, to: 30,
            selection_from: 10, selection_to: 30,
            type: 'note_headline',
        });
        expect(event.stopPropagation).toHaveBeenCalled();
    });
});
describe('GenericView navigation callback', () => {
    it('registers callback on onNavigationCommand ref', async () => {
        const nav_ref = createRef();
        nav_ref.current = undefined;
        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        root.child_notes = [child];
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: jest.fn(),
                        onNavigationCommand: nav_ref,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        expect(nav_ref.current).toBeInstanceOf(Function);
    });
    it('cleans up callback on unmount', async () => {
        const nav_ref = createRef();
        nav_ref.current = undefined;
        const root = makeNote({ seq: 0, level: 1 });
        const { unmount } = render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: jest.fn(),
                        onNavigationCommand: nav_ref,
                    },
                }) }) }));
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        expect(nav_ref.current).toBeInstanceOf(Function);
        unmount();
        expect(nav_ref.current).toBeUndefined();
    });
    it('navigate down sends revealRange for next sibling', async () => {
        const post_message = jest.fn();
        const nav_ref = createRef();
        nav_ref.current = undefined;
        const child1 = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const child2 = makeNote({
            seq: 2, level: 2,
            position: { start: { offset: 60, line: 6 }, end: { offset: 80, line: 7 }, end_body: { offset: 100, line: 9 } },
        });
        const root = makeNote({ seq: 0, level: 1, child_notes: [child1, child2] });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child1, child2],
                    selection: { main: { head: 10, anchor: 10 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                        onNavigationCommand: nav_ref,
                    },
                }) }) }));
        await waitFor(() => expect(nav_ref.current).toBeInstanceOf(Function));
        nav_ref.current('down');
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 60,
        });
    });
    it('navigate up sends revealRange for previous sibling', async () => {
        const post_message = jest.fn();
        const nav_ref = createRef();
        nav_ref.current = undefined;
        const child1 = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const child2 = makeNote({
            seq: 2, level: 2,
            position: { start: { offset: 60, line: 6 }, end: { offset: 80, line: 7 }, end_body: { offset: 100, line: 9 } },
        });
        const root = makeNote({ seq: 0, level: 1, child_notes: [child1, child2] });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child1, child2],
                    selection: { main: { head: 60, anchor: 60 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                        onNavigationCommand: nav_ref,
                    },
                }) }) }));
        await waitFor(() => expect(nav_ref.current).toBeInstanceOf(Function));
        nav_ref.current('up');
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 10,
        });
    });
    it('clearFocus sends revealRange past focused note', async () => {
        const post_message = jest.fn();
        const nav_ref = createRef();
        nav_ref.current = undefined;
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const root = makeNote({ seq: 0, level: 1, child_notes: [child] });
        render(_jsx(Suspense, { fallback: _jsx("div", { children: "loading" }), children: _jsx(GenericView, { ...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    selection: { main: { head: 10, anchor: 10 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                        onNavigationCommand: nav_ref,
                    },
                }) }) }));
        await waitFor(() => expect(nav_ref.current).toBeInstanceOf(Function));
        nav_ref.current('clearFocus');
        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 51,
        });
    });
});

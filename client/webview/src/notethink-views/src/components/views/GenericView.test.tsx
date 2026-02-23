import React, { Suspense, createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import GenericView from './GenericView';
import type { ViewProps, ViewApi } from '../../types/ViewProps';
import type { NoteProps, ClickPositionInfo } from '../../types/NoteProps';

// mock lazy-loaded view components — capture props for click handler testing
const mockDocViewRender = jest.fn();
const mockKanbanViewRender = jest.fn();
const mockAutoViewRender = jest.fn();

jest.mock('./AutoView', () => ({
    __esModule: true,
    default: (props: ViewProps) => {
        mockAutoViewRender(props);
        return <div data-testid="auto-view" data-id={props.id}>AutoView</div>;
    },
}));

jest.mock('./DocumentView', () => ({
    __esModule: true,
    default: (props: ViewProps) => {
        mockDocViewRender(props);
        return <div data-testid="document-view" data-id={props.id}>DocumentView</div>;
    },
}));

jest.mock('./KanbanView', () => ({
    __esModule: true,
    default: (props: ViewProps) => {
        mockKanbanViewRender(props);
        return <div data-testid="kanban-view" data-id={props.id}>KanbanView</div>;
    },
}));

// mock BreadcrumbTrail
jest.mock('./BreadcrumbTrail', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid="breadcrumb-trail">BreadcrumbTrail</div>,
}));

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
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

function makeViewProps(overrides: Partial<ViewProps> = {}): ViewProps {
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

function mockClickEvent(overrides: Record<string, unknown> = {}): import('react').MouseEvent<HTMLElement> {
    return {
        detail: 1,
        target: {},
        stopPropagation: jest.fn(),
        ...overrides,
    } as unknown as import('react').MouseEvent<HTMLElement>;
}

/** Get the handlers passed to the most recent DocumentView render */
function getDocViewHandlers(): ViewApi {
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
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document' })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('document-view')).toBeInTheDocument());
    });

    it('renders AutoView for type "auto"', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'auto' })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('auto-view')).toBeInTheDocument());
    });

    it('renders KanbanView for type "kanban"', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'kanban' })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());
    });

    it('computes display_options with default settings', async () => {
        const props = makeViewProps({
            type: 'document',
            notes: [makeNote({ seq: 0, level: 1, child_notes: [makeNote({ seq: 1, level: 2 })] })],
        });
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...props} />
            </Suspense>
        );
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
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...props} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('document-view')).toBeInTheDocument());
    });

    it('does not render any view for unknown type', async () => {
        const { container } = render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'unknown' })} />
            </Suspense>
        );
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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const click_profile: ClickPositionInfo = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 50,
            type: 'note_headline',
        };
        handlers.click!(mockClickEvent(), child, click_profile);

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
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    selection: { main: { head: 10, anchor: 10 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const click_profile: ClickPositionInfo = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 50,
            type: 'note_headline',
        };
        handlers.click!(mockClickEvent(), child, click_profile);

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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    selection: { main: { head: 10, anchor: 50 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const click_profile: ClickPositionInfo = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 50,
            type: 'note_headline',
        };
        handlers.click!(mockClickEvent(), child, click_profile);

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
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child_a, child_b],
                    selection: { main: { head: 10, anchor: 10 } },
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const click_profile: ClickPositionInfo = {
            from: 60, to: 80,
            selection_from: 60, selection_to: 100,
            type: 'note_headline',
        };
        handlers.click!(mockClickEvent(), child_b, click_profile);

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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const click_profile: ClickPositionInfo = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 30,
            type: 'note_headline',
        };
        handlers.click!(mockClickEvent({ detail: 1 }), child, click_profile);

        expect(single_click).toHaveBeenCalledWith(
            expect.anything(), child, click_profile
        );
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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const click_profile: ClickPositionInfo = {
            from: 10, to: 30,
            selection_from: 10, selection_to: 30,
            type: 'note_headline',
        };
        handlers.click!(mockClickEvent({ detail: 2 }), child, click_profile);

        expect(double_click).toHaveBeenCalledWith(
            expect.anything(), child, click_profile
        );
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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
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

        const click_profile: ClickPositionInfo = {
            from: 10, to: 20,
            selection_from: 10, selection_to: 40,
            type: 'note_body',
        };
        handlers.click!(
            mockClickEvent({ target: checkbox }),
            child,
            click_profile,
        );

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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const clear_handler = handlers.getClearHandler!([child]);
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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        const handlers = getDocViewHandlers();
        const event = mockClickEvent();
        handlers.click!(event, child, {
            from: 10, to: 30,
            selection_from: 10, selection_to: 30,
            type: 'note_headline',
        });

        expect(event.stopPropagation).toHaveBeenCalled();
    });
});

describe('GenericView navigation callback', () => {

    it('registers callback on onNavigationCommand ref', async () => {
        const nav_ref = createRef<((direction: string) => void) | undefined>() as React.MutableRefObject<((direction: string) => void) | undefined>;
        nav_ref.current = undefined;

        const root = makeNote({ seq: 0, level: 1 });
        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        root.child_notes = [child];

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, child],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: jest.fn(),
                        onNavigationCommand: nav_ref,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        expect(nav_ref.current).toBeInstanceOf(Function);
    });

    it('cleans up callback on unmount', async () => {
        const nav_ref = createRef<((direction: string) => void) | undefined>() as React.MutableRefObject<((direction: string) => void) | undefined>;
        nav_ref.current = undefined;

        const root = makeNote({ seq: 0, level: 1 });

        const { unmount } = render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root],
                    handlers: {
                        setViewManagedState: jest.fn(),
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: jest.fn(),
                        onNavigationCommand: nav_ref,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        expect(nav_ref.current).toBeInstanceOf(Function);

        unmount();
        expect(nav_ref.current).toBeUndefined();
    });

    it('navigate down sends revealRange for next sibling', async () => {
        const post_message = jest.fn();
        const nav_ref = createRef<((direction: string) => void) | undefined>() as React.MutableRefObject<((direction: string) => void) | undefined>;
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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
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
                })} />
            </Suspense>
        );
        await waitFor(() => expect(nav_ref.current).toBeInstanceOf(Function));

        nav_ref.current!('down');

        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 60,
        });
    });

    it('navigate up sends revealRange for previous sibling', async () => {
        const post_message = jest.fn();
        const nav_ref = createRef<((direction: string) => void) | undefined>() as React.MutableRefObject<((direction: string) => void) | undefined>;
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

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
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
                })} />
            </Suspense>
        );
        await waitFor(() => expect(nav_ref.current).toBeInstanceOf(Function));

        nav_ref.current!('up');

        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 10,
        });
    });

    it('clearFocus sends revealRange past focused note', async () => {
        const post_message = jest.fn();
        const nav_ref = createRef<((direction: string) => void) | undefined>() as React.MutableRefObject<((direction: string) => void) | undefined>;
        nav_ref.current = undefined;

        const child = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const root = makeNote({ seq: 0, level: 1, child_notes: [child] });

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
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
                })} />
            </Suspense>
        );
        await waitFor(() => expect(nav_ref.current).toBeInstanceOf(Function));

        nav_ref.current!('clearFocus');

        expect(post_message).toHaveBeenCalledWith({
            type: 'revealRange',
            from: 51,
        });
    });
});

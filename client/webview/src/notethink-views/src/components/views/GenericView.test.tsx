import React, { Suspense, createRef, type MouseEvent as ReactMouseEvent } from 'react';
import { render, screen, waitFor, fireEvent, act, within, type RenderResult } from '@testing-library/react';
import GenericView from './GenericView';
import type { ViewProps, ViewApi } from '../../types/ViewProps';
import type { NoteProps, ClickPositionInfo } from '../../types/NoteProps';

// mock lazy-loaded view components - capture props for click handler testing
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

/*
 * BreadcrumbTrail renders for real here: it hosts the leaf, file-count and warnings tabs, so mocking
 * it out would leave the drawer tabs below untested. Only its markdown headline renderer is mocked,
 * to keep the ESM unified stack out of this suite (BreadcrumbTrail.test.tsx does the same).
 */
jest.mock('../../lib/renderops', () => ({
    renderMarkdownNoteHeadline: (note: NoteProps) => <span>{note.headline_raw}</span>,
}));

// mock ViewTypeSelector - capture onChange for view-type testing
let capturedOnViewTypeChange: ((view_type: string) => void) | undefined;
jest.mock('./ViewTypeSelector', () => ({
    __esModule: true,
    default: (props: { currentSelection: string; resolvedType?: string; onChange?: (view_type: string) => void }) => {
        capturedOnViewTypeChange = props.onChange;
        return (
            <select data-testid="view-type-selector" data-auto-resolved={props.resolvedType || ''}>
                <option value={props.currentSelection}>{props.currentSelection}</option>
            </select>
        );
    },
}));

// mock ViewIntegrationSelector - capture onChange for integration-mode testing
let capturedOnIntegrationChange: ((mode: string) => void) | undefined;
jest.mock('./ViewIntegrationSelector', () => ({
    __esModule: true,
    default: (props: { currentSelection: string; resolvedMode: string; onChange?: (mode: string) => void }) => {
        capturedOnIntegrationChange = props.onChange;
        return (
            <select data-testid="view-integration-selector" data-resolved-mode={props.resolvedMode} value={props.currentSelection} onChange={() => {}}>
                <option value={props.currentSelection}>{props.currentSelection}</option>
            </select>
        );
    },
}));

// mock FilesDrawer - capture the seeded props + onApplyFilters for folder-filter testing
let capturedFilesDrawerProps: { include: string; exclude: string; maxNotesPerFile: number } | undefined;
let capturedOnApplyFilters: ((include: string, exclude: string, maxNotesPerFile: number) => void) | undefined;
jest.mock('./drawers/FilesDrawer', () => ({
    __esModule: true,
    default: (props: {
        include: string;
        exclude: string;
        maxNotesPerFile: number;
        onApplyFilters: (include: string, exclude: string, maxNotesPerFile: number) => void;
    }) => {
        capturedFilesDrawerProps = { include: props.include, exclude: props.exclude, maxNotesPerFile: props.maxNotesPerFile };
        capturedOnApplyFilters = props.onApplyFilters;
        return <div data-testid="files-drawer-mock" data-max-notes={props.maxNotesPerFile}>FilesDrawer</div>;
    },
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

function mockClickEvent(overrides: Record<string, unknown> = {}): ReactMouseEvent<HTMLElement> {
    return {
        detail: 1,
        target: {},
        stopPropagation: jest.fn(),
        ...overrides,
    } as unknown as ReactMouseEvent<HTMLElement>;
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
    capturedOnIntegrationChange = undefined;
    capturedOnViewTypeChange = undefined;
    capturedFilesDrawerProps = undefined;
    capturedOnApplyFilters = undefined;
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

    it('renders the view type selector inside the View settings drawer, not the toolbar', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document' })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('view-toolbar')).toBeInTheDocument());
        const selector = screen.getByTestId('view-type-selector');
        expect(within(screen.getByTestId('settings-drawer-grid')).getByTestId('view-type-selector')).toBe(selector);
        expect(within(screen.getByTestId('view-toolbar')).queryByTestId('view-type-selector')).not.toBeInTheDocument();
    });

    it('leaves no dropdown at all on the toolbar row', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document', doc_path: '/workspace/project/docs/todo.md' })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('view-toolbar')).toBeInTheDocument());
        expect(screen.getByTestId('view-toolbar').querySelectorAll('select')).toHaveLength(0);
    });

    it('hides the insert button behind its flag, leaving the InsertModal wiring in place', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document' })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('view-toolbar')).toBeInTheDocument());
        expect(screen.queryByTestId('view-insert-button')).not.toBeInTheDocument();
    });

    it('renders the view integration selector inside the Jump to drawer, not the toolbar', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document', doc_path: '/workspace/project/docs/todo.md' })} />
            </Suspense>
        );
        const selector = await screen.findByTestId('view-integration-selector');
        expect(within(screen.getByTestId('jump-drawer-grid')).getByTestId('view-integration-selector')).toBe(selector);
        expect(within(screen.getByTestId('view-toolbar')).queryByTestId('view-integration-selector')).not.toBeInTheDocument();
    });

    it('passes auto_resolved_type to view type selector when set', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'kanban',
                    nested: { auto_resolved_type: 'kanban' },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('view-type-selector')).toBeInTheDocument());
        const selector = screen.getByTestId('view-type-selector');
        expect(selector).toHaveAttribute('data-auto-resolved', 'kanban');
    });

    it('dispatches a view-type change from the selector inside the View settings drawer', async () => {
        const set_view_managed_state = jest.fn();
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    handlers: {
                        setViewManagedState: set_view_managed_state,
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: jest.fn(),
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('view-type-selector')).toBeInTheDocument());
        // the selector's onChange is the same handle_view_type_change the toolbar used to drive
        capturedOnViewTypeChange!('kanban');
        expect(set_view_managed_state).toHaveBeenCalledWith([{ id: 'test-view', type: 'kanban' }]);
    });

    it('clamps caret position that exceeds root note end offset', async () => {
        const child_note = makeNote({
            seq: 1, level: 2,
            position: { start: { offset: 10, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 50, line: 5 } },
        });
        const root_note = makeNote({
            seq: 0, level: 1,
            child_notes: [child_note],
            position: { start: { offset: 0, line: 1 }, end: { offset: 50, line: 5 }, end_body: { offset: 50, line: 5 } },
        });
        // caret at 60 exceeds root end (50) - simulates selection arriving before MDAST re-parse
        const props = makeViewProps({
            type: 'document',
            notes: [root_note, child_note],
            selection: { main: { head: 60, anchor: 60 } },
        });
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...props} />
            </Suspense>
        );
        await waitFor(() => expect(screen.getByTestId('document-view')).toBeInTheDocument());
        // clamped to root end → still finds a note (does not leave focused_seqs empty)
        const last_call = mockDocViewRender.mock.calls[mockDocViewRender.mock.calls.length - 1][0];
        expect(last_call.display_options.focused_seqs).toBeDefined();
        expect(last_call.display_options.focused_seqs.length).toBeGreaterThan(0);
    });

    it('does not render any view for unknown type but still shows toolbar', async () => {
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'unknown' })} />
            </Suspense>
        );
        // toolbar is always rendered
        expect(screen.getByTestId('view-toolbar')).toBeInTheDocument();
        // but no view component is rendered
        expect(screen.queryByTestId('document-view')).not.toBeInTheDocument();
        expect(screen.queryByTestId('auto-view')).not.toBeInTheDocument();
        expect(screen.queryByTestId('kanban-view')).not.toBeInTheDocument();
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
            forceOpen: false,
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
            forceOpen: false,
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
            forceOpen: false,
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
            forceOpen: false,
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

    it('checkbox click via selectable_note resolves to parent with body_raw', async () => {
        const post_message = jest.fn();
        const root = makeNote({ seq: 0, level: 0 });
        const heading = makeNote({
            seq: 1, level: 2,
            body_raw: '- [ ] buy milk\n- [x] buy eggs\n',
            position: { start: { offset: 0, line: 1 }, end: { offset: 15, line: 1 }, end_body: { offset: 50, line: 4 } },
        });
        const paragraph = makeNote({
            seq: 2, level: 4, type: 'paragraph',
            headline_raw: 'buy milk',
            body_raw: '',
            parent_notes: [heading],
            position: { start: { offset: 18, line: 2 }, end: { offset: 30, line: 2 } },
        });

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root, heading, paragraph],
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
        // simulate checkbox element within a paragraph rendered by MarkdownNote
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        const text = document.createTextNode(' buy milk');
        const wrapper = document.createElement('span');
        wrapper.appendChild(checkbox);
        wrapper.appendChild(text);

        // calling the handler with the PARAGRAPH note (empty body_raw) should still work because createNoteClickHandler passes selectable_note (the heading) to the handler
        const click_profile: ClickPositionInfo = {
            from: 18, to: 30,
            selection_from: 18, selection_to: 30,
            type: 'note_headline',
        };
        // simulate what createNoteClickHandler does: pass selectable_note if available
        handlers.click!(
            mockClickEvent({ target: checkbox }),
            heading,
            click_profile,
        );

        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({
            type: 'editText',
            changes: expect.arrayContaining([
                expect.objectContaining({ insert: 'X' }),
            ]),
        }));

        // verify that passing the paragraph directly (no selectable_note) returns no changes
        post_message.mockClear();
        handlers.click!(
            mockClickEvent({ target: checkbox }),
            paragraph,
            click_profile,
        );
        expect(post_message).not.toHaveBeenCalled();
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

    it('folder breadcrumb click sends setIntegration message and updates integration mode', async () => {
        const post_message = jest.fn();
        const set_view_managed_state = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root],
                    doc_path: '/workspace/project/docs/todo.md',
                    handlers: {
                        setViewManagedState: set_view_managed_state,
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        // 'docs' is an ancestor segment of the open file, so clicking it re-narrows the aggregation to that folder
        fireEvent.click(screen.getByText('docs'));

        // dispatch must land on the canonical folder key so a later flip back to folder mode doesn't lose settings stored under a doc-path key
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: '__folder__',
            display_options: {
                integration_mode: 'folder',
                integration_path: '/workspace/project/docs',
            },
        }]);
        expect(post_message).toHaveBeenCalledWith({
            type: 'setIntegration',
            mode: 'folder',
            path: '/workspace/project/docs',
        });
    });

    it('integration selector switch to current_file sends setIntegration and updates integration mode', async () => {
        const post_message = jest.fn();
        const set_view_managed_state = jest.fn();
        const root = makeNote({ seq: 0, level: 1 });

        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    notes: [root],
                    doc_path: '/workspace/project/docs/todo.md',
                    handlers: {
                        setViewManagedState: set_view_managed_state,
                        deleteViewFromManagedState: jest.fn(),
                        revertAllViewsToDefaultState: jest.fn(),
                        postMessage: post_message,
                    },
                })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());

        // ViewIntegrationSelector mock captured onChange
        expect(capturedOnIntegrationChange).toBeInstanceOf(Function);
        capturedOnIntegrationChange!('current_file');

        // dispatch must land on the canonical folder key (not props.id) so the folder viewState's other settings survive the flip
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: '__folder__',
            display_options: {
                integration_mode: 'current_file',
                integration_path: undefined,
            },
        }]);
        expect(post_message).toHaveBeenCalledWith({
            type: 'setIntegration',
            mode: 'current_file',
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

    describe('settings drawer', () => {

        function renderWithToolbar(view_overrides: Partial<ViewProps> = {}): RenderResult {
            // a non-'auto' type renders the toolbar (which holds the gear button) + the drawer
            return render(
                <Suspense fallback={<div>loading</div>}>
                    <GenericView {...makeViewProps({ type: 'document', ...view_overrides })} />
                </Suspense>
            );
        }

        it('renders the gear button with aria-expanded=false initially', async () => {
            renderWithToolbar();
            const gear = await screen.findByTestId('view-settings-button');
            expect(gear).toHaveAttribute('aria-expanded', 'false');
        });

        it('toggles aria-expanded on the gear button when clicked', async () => {
            renderWithToolbar();
            const gear = await screen.findByTestId('view-settings-button');
            fireEvent.click(gear);
            expect(gear).toHaveAttribute('aria-expanded', 'true');
            fireEvent.click(gear);
            expect(gear).toHaveAttribute('aria-expanded', 'false');
        });

        it('flips data-open on the drawer grid when the gear is clicked', async () => {
            renderWithToolbar();
            const grid = await screen.findByTestId('settings-drawer-grid');
            expect(grid).toHaveAttribute('data-open', 'false');
            fireEvent.click(await screen.findByTestId('view-settings-button'));
            expect(grid).toHaveAttribute('data-open', 'true');
        });

        it('renders SettingsDocumentDrawer when view type is document', async () => {
            renderWithToolbar({ type: 'document' });
            expect(await screen.findByTestId('settings-drawer-document')).toBeInTheDocument();
            expect(screen.queryByTestId('settings-drawer-kanban')).not.toBeInTheDocument();
        });

        it('renders SettingsKanbanDrawer when view type is kanban', async () => {
            renderWithToolbar({ type: 'kanban' });
            expect(await screen.findByTestId('settings-drawer-kanban')).toBeInTheDocument();
            expect(screen.queryByTestId('settings-drawer-document')).not.toBeInTheDocument();
        });

        it('does not render the drawer for type "auto" (toolbar suppressed)', async () => {
            renderWithToolbar({ type: 'auto' });
            await waitFor(() => expect(screen.queryByTestId('auto-view')).toBeInTheDocument());
            expect(screen.queryByTestId('view-settings-button')).not.toBeInTheDocument();
            expect(screen.queryByTestId('settings-drawer-grid')).not.toBeInTheDocument();
        });

        it('toggling a per-view checkbox dispatches setViewManagedState immediately', async () => {
            const set_state = jest.fn();
            renderWithToolbar({
                type: 'document',
                handlers: {
                    setViewManagedState: set_state,
                    deleteViewFromManagedState: jest.fn(),
                    revertAllViewsToDefaultState: jest.fn(),
                    postMessage: jest.fn(),
                },
            });
            fireEvent.click(await screen.findByTestId('view-settings-button'));
            const linetags_cb = screen.getAllByRole('checkbox').find(
                cb => cb.closest('label')?.textContent?.includes('linetag')
            )!;
            fireEvent.click(linetags_cb);
            expect(set_state).toHaveBeenCalledTimes(1);
            const update = set_state.mock.calls[0][0][0];
            expect(update.id).toBe('test-view');
            expect(update.display_options.settings.showLinetagsInHeadlines).toBe(true);
        });

        it('toggling the line-numbers checkbox dispatches postMessage updateGlobalSetting', async () => {
            const post_message = jest.fn();
            renderWithToolbar({
                type: 'document',
                handlers: {
                    setViewManagedState: jest.fn(),
                    deleteViewFromManagedState: jest.fn(),
                    revertAllViewsToDefaultState: jest.fn(),
                    postMessage: post_message,
                },
            });
            fireEvent.click(await screen.findByTestId('view-settings-button'));
            const line_cb = screen.getAllByRole('checkbox').find(
                cb => cb.closest('label')?.textContent?.includes('line numbers')
            )!;
            fireEvent.click(line_cb);
            expect(post_message).toHaveBeenCalledWith({
                type: 'updateGlobalSetting',
                setting: 'showLineNumbers',
                value: true,
            });
        });

        it('Kanban column reorder dispatches setViewManagedState with columnOrder; reset persists undefined', async () => {
            const set_state = jest.fn();
            const status_note_a = makeNote({
                seq: 1, level: 2,
                position: { start: { offset: 10, line: 2 }, end: { offset: 20, line: 2 }, end_body: { offset: 30, line: 3 } },
                linetags: { 'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 } },
            });
            const status_note_b = makeNote({
                seq: 2, level: 2,
                position: { start: { offset: 30, line: 4 }, end: { offset: 40, line: 4 }, end_body: { offset: 50, line: 5 } },
                linetags: { 'status': { key: 'status', value: 'done', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 } },
            });
            const root = makeNote({ seq: 0, level: 1, child_notes: [status_note_a, status_note_b] });
            renderWithToolbar({
                type: 'kanban',
                notes: [root, status_note_a, status_note_b],
                handlers: {
                    setViewManagedState: set_state,
                    deleteViewFromManagedState: jest.fn(),
                    revertAllViewsToDefaultState: jest.fn(),
                    postMessage: jest.fn(),
                },
            });
            fireEvent.click(await screen.findByTestId('view-settings-button'));
            /*
             * natural order is ['doing', 'done', 'untagged']; clicking move-up on 'done' produces ['done', 'doing', 'untagged']
             * labels are formatted (title-cased) - the raw slug is still what's stored
             */
            fireEvent.click(screen.getByLabelText('Move Done up'));
            expect(set_state).toHaveBeenCalledTimes(1);
            const reorder_update = set_state.mock.calls[0][0][0];
            expect(reorder_update.display_options.settings.columnOrder).toEqual(['done', 'doing', 'untagged']);
            // resetting to natural order persists undefined
            set_state.mockClear();
            fireEvent.click(screen.getByText('Reset order'));
            const reset_update = set_state.mock.calls[0][0][0];
            expect(reset_update.display_options.settings.columnOrder).toBeUndefined();
        });

        it('Escape closes the drawer and returns focus to the gear button', async () => {
            renderWithToolbar();
            const gear = await screen.findByTestId('view-settings-button');
            fireEvent.click(gear);
            expect(gear).toHaveAttribute('aria-expanded', 'true');
            act(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            });
            expect(gear).toHaveAttribute('aria-expanded', 'false');
            // focus restoration runs in a requestAnimationFrame; jsdom supports rAF
            await waitFor(() => expect(document.activeElement).toBe(gear));
        });

        it('pointerdown outside the drawer and trigger closes the drawer', async () => {
            renderWithToolbar();
            const gear = await screen.findByTestId('view-settings-button');
            fireEvent.click(gear);
            const grid = await screen.findByTestId('settings-drawer-grid');
            expect(grid).toHaveAttribute('data-open', 'true');
            // dispatch on document.body - outside both the trigger and the drawer
            act(() => {
                document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            });
            expect(grid).toHaveAttribute('data-open', 'false');
        });

        it('pointerdown inside the drawer body keeps the drawer open', async () => {
            renderWithToolbar();
            fireEvent.click(await screen.findByTestId('view-settings-button'));
            const grid = await screen.findByTestId('settings-drawer-grid');
            const inside = await screen.findByTestId('settings-drawer-document');
            act(() => {
                inside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            });
            expect(grid).toHaveAttribute('data-open', 'true');
        });

        it('pointerdown on the trigger does not double-toggle (close then re-open)', async () => {
            renderWithToolbar();
            const gear = await screen.findByTestId('view-settings-button');
            fireEvent.click(gear);
            const grid = await screen.findByTestId('settings-drawer-grid');
            expect(grid).toHaveAttribute('data-open', 'true');
            // simulate a real click: pointerdown then click both target the gear
            act(() => {
                gear.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            });
            fireEvent.click(gear);
            expect(grid).toHaveAttribute('data-open', 'false');
        });
    });
});

describe('GenericView folder files drawer', () => {

    function renderFolderView(view_overrides: Partial<ViewProps> = {}): RenderResult {
        // folder integration mode + a non-'auto' type renders the FilesDrawer
        return render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({
                    type: 'document',
                    display_options: { integration_mode: 'folder', integration_path: '/workspace/project/docs' },
                    includeFilter: '**/*.md',
                    excludeFilter: '**/node_modules/**',
                    ...view_overrides,
                })} />
            </Suspense>
        );
    }

    it('renders FilesDrawer in folder mode seeded with maxNotesPerFile from display_options', async () => {
        renderFolderView({
            display_options: {
                integration_mode: 'folder',
                integration_path: '/workspace/project/docs',
                maxNotesPerFile: 25,
            },
        });
        await waitFor(() => expect(screen.getByTestId('files-drawer-mock')).toBeInTheDocument());
        expect(capturedFilesDrawerProps?.maxNotesPerFile).toBe(25);
        expect(screen.getByTestId('files-drawer-mock')).toHaveAttribute('data-max-notes', '25');
    });

    it('defaults maxNotesPerFile to 10 when display_options has no override', async () => {
        renderFolderView();
        await waitFor(() => expect(screen.getByTestId('files-drawer-mock')).toBeInTheDocument());
        expect(capturedFilesDrawerProps?.maxNotesPerFile).toBe(10);
    });

    it('persists maxNotesPerFile via setViewManagedState and excludes it from the setIntegration postMessage', async () => {
        const post_message = jest.fn();
        const set_view_managed_state = jest.fn();
        renderFolderView({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        await waitFor(() => expect(capturedOnApplyFilters).toBeInstanceOf(Function));

        capturedOnApplyFilters!('**/users/**', '**/dist/**', 7);

        /*
         * only the webview-side merge cap is persisted to per-view state; the globs are config-tier
         * cascade settings with a single source of truth (config, echoed back) and must NOT be copied
         * into viewState, or the drawer can drift from the globs discovery used and shadow the config
         * the Reset buttons clear
         */
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: 'test-view',
            display_options: {
                maxNotesPerFile: 7,
            },
        }]);
        const managed = set_view_managed_state.mock.calls[0][0][0];
        expect(managed.display_options).not.toHaveProperty('includeFilter');
        expect(managed.display_options).not.toHaveProperty('excludeFilter');

        // the globs round-trip to the extension via setIntegration (re-discovery), but the cap does not
        expect(post_message).toHaveBeenCalledWith({
            type: 'setIntegration',
            mode: 'folder',
            path: '/workspace/project/docs',
            include: '**/users/**',
            exclude: '**/dist/**',
        });
        const set_integration_call = post_message.mock.calls.find(
            ([msg]) => msg?.type === 'setIntegration',
        );
        expect(set_integration_call).toBeDefined();
        expect(set_integration_call![0]).not.toHaveProperty('maxNotesPerFile');
    });
});

/*
 * Each drawer's trigger is one element with one testid, named for wherever that trigger has always
 * lived: the breadcrumb-* tabs render inside the trail on the state they are titled with, and
 * view-settings-button is the single tab on the right, now titled with the resolved view type.
 */
describe('GenericView drawer tabs', () => {

    const DOC_PATH = '/workspace/project/docs/todo.md';
    // the Files tab IS the file count, so folder mode alone is not enough to raise it - a count has to have arrived
    const FOLDER_PROPS: Partial<ViewProps> = {
        display_options: { integration_mode: 'folder', integration_path: '/workspace/project/docs' },
        file_count: 4,
        note_count: 12,
    };

    function makeStory(seq: number, headline: string, line: number): NoteProps {
        return makeNote({
            seq, level: 2, type: 'heading', headline_raw: headline,
            position: { start: { offset: line * 10, line }, end: { offset: line * 10 + 5, line } },
        });
    }

    function renderTabs(view_overrides: Partial<ViewProps> = {}): RenderResult {
        return render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document', doc_path: DOC_PATH, ...view_overrides })} />
            </Suspense>
        );
    }

    // two story headings sharing a headline slug, which is what findStableIdCollisions groups on
    function collidingNotes(): NoteProps[] {
        return [makeNote({ seq: 0, level: 0, type: 'root' }), makeStory(1, '### Plan release', 2), makeStory(2, '### Plan release', 6)];
    }

    it('renders a tab per available drawer, all closed with a down chevron', async () => {
        renderTabs();
        for (const test_id of ['breadcrumb-leaf', 'view-settings-button']) {
            const tab = await screen.findByTestId(test_id);
            expect(tab).toHaveAttribute('aria-expanded', 'false');
            expect(screen.getByTestId(`${test_id}-chevron`)).toHaveAttribute('data-direction', 'down');
        }
    });

    it('points each tab at the drawer it controls via aria-controls', async () => {
        renderTabs(FOLDER_PROPS);
        expect(await screen.findByTestId('view-settings-button')).toHaveAttribute('aria-controls', 'vtest-view-settings-drawer');
        expect(screen.getByTestId('breadcrumb-file-count')).toHaveAttribute('aria-controls', 'vtest-view-files-drawer');
        expect(screen.getByTestId('breadcrumb-leaf')).toHaveAttribute('aria-controls', 'vtest-view-jump-drawer');
    });

    it('flips the chevron up and aria-expanded true on the clicked tab only', async () => {
        renderTabs();
        const settings_tab = await screen.findByTestId('view-settings-button');
        fireEvent.click(settings_tab);
        expect(settings_tab).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('view-settings-button-chevron')).toHaveAttribute('data-direction', 'up');
        // the drawers are mutually exclusive, so every other tab stays closed
        expect(screen.getByTestId('breadcrumb-leaf')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('breadcrumb-leaf-chevron')).toHaveAttribute('data-direction', 'down');
    });

    it('flips the chevron back down when the open tab is clicked again', async () => {
        renderTabs();
        const settings_tab = await screen.findByTestId('view-settings-button');
        fireEvent.click(settings_tab);
        fireEvent.click(settings_tab);
        expect(settings_tab).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('view-settings-button-chevron')).toHaveAttribute('data-direction', 'down');
    });

    it('renders the Files tab in folder mode only', async () => {
        const { unmount } = renderTabs();
        await screen.findByTestId('view-settings-button');
        expect(screen.queryByTestId('breadcrumb-file-count')).not.toBeInTheDocument();
        unmount();

        renderTabs(FOLDER_PROPS);
        expect(await screen.findByTestId('breadcrumb-file-count')).toBeInTheDocument();
    });

    it('titles the Files tab with the file count itself', async () => {
        renderTabs(FOLDER_PROPS);
        expect(await screen.findByTestId('breadcrumb-file-count')).toHaveTextContent('(12 in 4 files)');
    });

    it('opens the Files drawer from the Files tab', async () => {
        renderTabs(FOLDER_PROPS);
        const grid = await screen.findByTestId('files-drawer-grid');
        expect(grid).toHaveAttribute('data-open', 'false');
        fireEvent.click(screen.getByTestId('breadcrumb-file-count'));
        expect(grid).toHaveAttribute('data-open', 'true');
        expect(screen.getByTestId('breadcrumb-file-count-chevron')).toHaveAttribute('data-direction', 'up');
    });

    it('renders the Warnings tab only when there are collisions', async () => {
        const { unmount } = renderTabs({ notes: [makeNote({ seq: 0, level: 0, type: 'root' })] });
        await screen.findByTestId('view-settings-button');
        expect(screen.queryByTestId('breadcrumb-collision-alert')).not.toBeInTheDocument();
        unmount();

        renderTabs({ notes: collidingNotes() });
        expect(await screen.findByTestId('breadcrumb-collision-alert')).toBeInTheDocument();
    });

    it('titles the Warnings tab with the word followed by the alert glyph', async () => {
        renderTabs({ notes: collidingNotes() });
        const tab = await screen.findByTestId('breadcrumb-collision-alert');
        expect(tab).toHaveTextContent('Warnings');
        expect(tab).toHaveTextContent('⚠');
    });

    it('opens the Collisions drawer from the Warnings tab', async () => {
        renderTabs({ notes: collidingNotes() });
        const grid = await screen.findByTestId('collisions-drawer-grid');
        expect(grid).toHaveAttribute('data-open', 'false');
        fireEvent.click(await screen.findByTestId('breadcrumb-collision-alert'));
        expect(grid).toHaveAttribute('data-open', 'true');
        expect(screen.getByTestId('breadcrumb-collision-alert-chevron')).toHaveAttribute('data-direction', 'up');
    });

    it('opens the Jump drawer from the leaf tab and requests targets for that leaf', async () => {
        const post_message = jest.fn();
        renderTabs({
            workspace_root: '/workspace/project',
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const grid = await screen.findByTestId('jump-drawer-grid');
        expect(grid).toHaveAttribute('data-open', 'false');
        fireEvent.click(screen.getByTestId('breadcrumb-leaf'));
        expect(grid).toHaveAttribute('data-open', 'true');
        // the leaf tab targets its own segment - the open file in current_file mode
        expect(post_message).toHaveBeenCalledWith({
            type: 'requestJumpTargets',
            mode: 'current_file',
            path: DOC_PATH,
        });
    });

    it('titles the leaf tab with the leaf and never renders the leaf twice', async () => {
        renderTabs({ workspace_root: '/workspace/project' });
        const leaf = await screen.findByTestId('breadcrumb-leaf');
        expect(leaf).toHaveTextContent('todo.md');
        expect(screen.getAllByTestId('breadcrumb-leaf')).toHaveLength(1);
        expect(screen.getAllByText('todo.md')).toHaveLength(1);
    });

    it('targets the aggregation folder from the leaf tab in folder mode', async () => {
        const post_message = jest.fn();
        renderTabs({
            ...FOLDER_PROPS,
            workspace_root: '/workspace/project',
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        fireEvent.click(await screen.findByTestId('breadcrumb-leaf'));
        expect(post_message).toHaveBeenCalledWith({
            type: 'requestJumpTargets',
            mode: 'folder',
            path: '/workspace/project/docs',
        });
    });

    it('hides the leaf tab when there is no path to jump from', async () => {
        renderTabs({ doc_path: undefined });
        await screen.findByTestId('view-settings-button');
        expect(screen.queryByTestId('breadcrumb-leaf')).not.toBeInTheDocument();
    });

    it('titles the View settings tab with the resolved view type', async () => {
        // an auto selection that AutoView resolved to kanban: the tab states what the board is actually showing
        renderTabs({ type: 'kanban', nested: { replaced_attributes: { type: 'auto' }, auto_resolved_type: 'kanban' } });
        expect(await screen.findByTestId('view-settings-button')).toHaveTextContent('Auto (Kanban)');
    });

    it('titles the View settings tab with the plain type when the selection is concrete', async () => {
        renderTabs({ type: 'kanban' });
        expect(await screen.findByTestId('view-settings-button')).toHaveTextContent('Kanban');
    });

    it('opens the View settings drawer, which is where the view-type selector now lives', async () => {
        renderTabs();
        const grid = await screen.findByTestId('settings-drawer-grid');
        fireEvent.click(screen.getByTestId('view-settings-button'));
        expect(grid).toHaveAttribute('data-open', 'true');
        expect(within(grid).getByTestId('view-type-selector')).toBeInTheDocument();
    });

    it('dispatches an integration change from the selector inside the open Jump to drawer', async () => {
        const post_message = jest.fn();
        const set_view_managed_state = jest.fn();
        renderTabs({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        fireEvent.click(await screen.findByTestId('breadcrumb-leaf'));
        const drawer = screen.getByTestId('jump-drawer-grid');
        expect(drawer).toHaveAttribute('data-open', 'true');
        expect(within(drawer).getByTestId('view-integration-selector')).toBeInTheDocument();

        // the selector's onChange is the same handle_integration_change the toolbar used to drive
        capturedOnIntegrationChange!('folder');
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: '__folder__',
            display_options: {
                integration_mode: 'folder',
                integration_path: '/workspace/project/docs',
            },
        }]);
        expect(post_message).toHaveBeenCalledWith({
            type: 'setIntegration',
            mode: 'folder',
            path: '/workspace/project/docs',
        });
    });
});

describe('GenericView document-level strip', () => {
    const status_tag = { key: 'status', value: 'active', note_seq: 0, key_offset: 0, value_offset: 8, linktext_offset: 0 };

    function rootWithFrontMatter(): NoteProps {
        return makeNote({ seq: 0, level: 0, type: 'root', headline_raw: '', linetags: { status: status_tag } });
    }

    function lastDocNested(): ViewProps['nested'] {
        return mockDocViewRender.mock.calls[mockDocViewRender.mock.calls.length - 1][0].nested;
    }

    it('builds document_strip + document_root and hands them to the document view in single-file mode', async () => {
        const root = rootWithFrontMatter();
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document', notes: [root], display_options: { integration_mode: 'current_file' } })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        expect(lastDocNested()?.document_strip).toBeDefined();
        expect(lastDocNested()?.document_root).toBe(root);
    });

    it('hands the document_strip to the kanban view too', async () => {
        const root = rootWithFrontMatter();
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'kanban', notes: [root], display_options: { integration_mode: 'current_file' } })} />
            </Suspense>
        );
        await waitFor(() => expect(mockKanbanViewRender).toHaveBeenCalled());
        const nested = mockKanbanViewRender.mock.calls[mockKanbanViewRender.mock.calls.length - 1][0].nested;
        expect(nested?.document_strip).toBeDefined();
    });

    it('does not build a document_strip in folder mode', async () => {
        const root = rootWithFrontMatter();
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document', notes: [root], display_options: { integration_mode: 'folder' } })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        expect(lastDocNested()?.document_strip).toBeUndefined();
        expect(lastDocNested()?.document_root).toBeUndefined();
    });

    it('does not build a document_strip when the root carries no front-matter linetags', async () => {
        const root = makeNote({ seq: 0, level: 0, type: 'root', headline_raw: '' });
        render(
            <Suspense fallback={<div>loading</div>}>
                <GenericView {...makeViewProps({ type: 'document', notes: [root], display_options: { integration_mode: 'current_file' } })} />
            </Suspense>
        );
        await waitFor(() => expect(mockDocViewRender).toHaveBeenCalled());
        expect(lastDocNested()?.document_strip).toBeUndefined();
    });
});

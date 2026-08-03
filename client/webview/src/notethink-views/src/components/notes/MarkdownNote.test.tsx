import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import MarkdownNote from './MarkdownNote';
import { nextExpandedIds } from '../../lib/viewstateops';
import type { NoteProps } from '../../types/NoteProps';

// mock GenericNote to avoid circular lazy-load issues
jest.mock('./GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`child-${props.seq}`} data-seq={props.seq} data-mdast-type={props.type}>{props.headline_raw}</div>,
}));

// mock GenericNoteAttributes
jest.mock('./GenericNoteAttributes', () => ({
    __esModule: true,
    default: (props: NoteProps) => props.linetags ? <div data-testid="linetags">attributes</div> : null,
}));

// ResizeObserver mock: capture callback so tests can trigger it
let resizeCallback: ResizeObserverCallback | undefined;
const mockObserve = jest.fn();
const mockDisconnect = jest.fn();

beforeEach(() => {
    resizeCallback = undefined;
    mockObserve.mockClear();
    mockDisconnect.mockClear();
    global.ResizeObserver = jest.fn((cb) => {
        resizeCallback = cb;
        return { observe: mockObserve, unobserve: jest.fn(), disconnect: mockDisconnect };
    }) as unknown as typeof ResizeObserver;
});

const PARENT_SEQ = 10;

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 2,
        type: 'heading',
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 200, line: 20 },
        },
        headline_raw: '### Story title',
        body_raw: '+ [X] done\n+ [ ] todo',
        parent_notes: [{ seq: PARENT_SEQ } as NoteProps],
        display_options: { parent_context_seq: PARENT_SEQ },
        ...overrides,
    };
}

function makeListItem(seq: number, checked: boolean): NoteProps {
    return {
        seq,
        level: 3,
        type: 'listItem',
        checked,
        children_body: [],
        children: [],
        position: { start: { offset: seq * 10, line: seq }, end: { offset: seq * 10 + 8, line: seq } },
        headline_raw: checked ? '- [X] task' : '- [ ] task',
        body_raw: '',
    };
}

function makeList(seq: number, items: NoteProps[]): NoteProps {
    return {
        seq,
        level: 3,
        type: 'list',
        children_body: items,
        children: [],
        position: { start: { offset: 20, line: 2 }, end: { offset: 100, line: 10 } },
        headline_raw: '',
        body_raw: '',
    };
}

function simulateOverflow(el: HTMLElement, scrollHeight: number, offsetWidth: number): void {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'offsetWidth', { value: offsetWidth, configurable: true });
    if (resizeCallback) {
        act(() => { resizeCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver); });
    }
}

/*
 * stand-in for a real view: owns view_expanded_ids and supplies the setNoteExpanded handler that adds
 * and removes a stable_id, so the card's expansion is driven the way DocumentView and KanbanBoard drive
 * it rather than by component-instance state. The card is keyed by identity the way the views key it, and
 * the column wrapper is the kanban lane - changing it unmounts the card and remounts it in the new lane.
 * keyBySeq keys the card by seq rather than identity, so a renumber hands it a fresh instance and
 * only a view-owned expansion list can survive; without it the identity key hides that handover.
 */
function ExpansionHost(props: { note: NoteProps; column?: string; keyBySeq?: boolean }): React.ReactElement {
    const [expanded_ids, setExpandedIds] = React.useState<string[]>([]);
    const setNoteExpanded = (stable_id: string, expanded: boolean): void => {
        setExpandedIds((prev) => nextExpandedIds(prev, stable_id, expanded));
    };
    const card_key = props.keyBySeq ? props.note.seq : (props.note.stable_id ?? props.note.seq);
    return (
        <div key={props.column ?? 'todo'}>
            <MarkdownNote
                key={card_key}
                {...props.note}
                display_options={{ ...props.note.display_options, view_expanded_ids: expanded_ids }}
                handlers={{ setNoteExpanded }}
            />
        </div>
    );
}

// query the note body and establish the overflow a freshly mounted ResizeObserver has not measured yet
function remeasuredBody(container: HTMLElement): HTMLElement {
    const body = container.querySelector('[class*="body"]') as HTMLElement;
    simulateOverflow(body, 500, 200);
    return body;
}

/*
 * render an overflowing top-level note inside the host and expand it via "Show more", returning the
 * handles a caller needs to drive the collapse rules: the body element (its inline maxHeight is the
 * clip), the container to re-query it from after a remount, the note, and rerender.
 */
function renderExpandedNote(key_by_seq = false): { body: HTMLElement; container: HTMLElement; rerender: (ui: React.ReactElement) => void; note: NoteProps } {
    const note = makeNote({
        stable_id: 'story-a',
        children_body: [makeList(2, [makeListItem(3, true), makeListItem(4, false)])],
    });
    const { container, rerender } = render(<ExpansionHost note={note} keyBySeq={key_by_seq} />);
    const body = remeasuredBody(container);
    fireEvent.click(screen.getAllByRole('button', { name: /show more/i })[0]);
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
    return { body, container, rerender, note };
}

describe('MarkdownNote', () => {
    it('renders headline outside the body container', () => {
        const note = makeNote({
            children_body: [makeList(2, [makeListItem(3, true), makeListItem(4, false)])],
        });
        const { container } = render(<MarkdownNote {...note} />);
        const headline = container.querySelector('[role="rowheader"]');
        const body = container.querySelector('[class*="body"]');
        expect(headline).toBeInTheDocument();
        expect(body).toBeInTheDocument();
        // headline should NOT be inside the body
        expect(body!.contains(headline)).toBe(false);
    });

    it('renders linetags outside the body container', () => {
        const note = makeNote({
            linetags: { status: { key: 'status', key_offset: 0, value: 'doing', value_offset: 0, linktext_offset: 0, note_seq: 1 } },
            children_body: [makeList(2, [makeListItem(3, false)])],
        });
        const { container } = render(<MarkdownNote {...note} />);
        const linetags = screen.getByTestId('linetags');
        const body = container.querySelector('[class*="body"]');
        expect(linetags).toBeInTheDocument();
        expect(body!.contains(linetags)).toBe(false);
    });

    it('does not render an inline attribute strip for the synthetic root note', () => {
        // the root's front-matter linetags surface as the view's document-level strip, not inline in the note body
        const root = makeNote({
            type: 'root',
            headline_raw: '',
            linetags: { status: { key: 'status', key_offset: 0, value: 'active', value_offset: 0, linktext_offset: 0, note_seq: 0 } },
        });
        render(<MarkdownNote {...root} />);
        expect(screen.queryByTestId('linetags')).not.toBeInTheDocument();
    });

    it('does not clip when body does not overflow', () => {
        const note = makeNote({
            children_body: [makeList(2, [makeListItem(3, false)])],
        });
        const { container } = render(<MarkdownNote {...note} />);
        const body = container.querySelector('[class*="body"]');
        // simulate body that fits within threshold
        if (body) { simulateOverflow(body as HTMLElement, 100, 400); }
        expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
    });

    it('clips body (not outer div) when overflow is detected', () => {
        const note = makeNote({
            children_body: [makeList(2, [makeListItem(3, true), makeListItem(4, false)])],
        });
        const { container } = render(<MarkdownNote {...note} />);
        const body = container.querySelector('[class*="body"]');
        // simulate overflow: scrollHeight 500 > offsetWidth 200 * HEIGHT_RATIO(1)
        if (body) { simulateOverflow(body as HTMLElement, 500, 200); }
        // body should have maxHeight style
        expect(body).toHaveStyle({ maxHeight: '200px', overflow: 'hidden' });
        // outer note div should NOT have maxHeight
        const outer = container.firstElementChild as HTMLElement;
        expect(outer.style.maxHeight).toBe('');
    });

    it('shows bottom "Show more" when clipped', () => {
        const note = makeNote({
            children_body: [makeList(2, [makeListItem(3, false)])],
        });
        const { container } = render(<MarkdownNote {...note} />);
        const body = container.querySelector('[class*="body"]');
        if (body) { simulateOverflow(body as HTMLElement, 500, 200); }
        const buttons = screen.getAllByRole('button', { name: /show more/i });
        expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows top "Show more" when scrolled to incomplete task', async () => {
        // mock offsetTop so the incomplete task appears below the fold
        const original_offset_top = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
            configurable: true,
            get() {
                const seq = this.getAttribute?.('data-seq');
                if (seq === '6') { return 200; }
                return 0;
            },
        });
        try {
            // flatten listItems as direct children so mock GenericNote renders them in DOM
            const note = makeNote({
                children_body: [
                    makeListItem(3, true),
                    makeListItem(4, true),
                    makeListItem(5, true),
                    makeListItem(6, false),
                ],
            });
            const { container } = render(<MarkdownNote {...note} />);
            const body = container.querySelector('[class*="body"]');
            if (body) { simulateOverflow(body as HTMLElement, 500, 200); }
            const buttons = screen.getAllByRole('button', { name: /show more/i });
            expect(buttons.length).toBe(2);
        } finally {
            if (original_offset_top) {
                Object.defineProperty(HTMLElement.prototype, 'offsetTop', original_offset_top);
            } else {
                delete (HTMLElement.prototype as Record<string, unknown>).offsetTop;
            }
        }
    });

    it('does not show top fade when no completed tasks above', () => {
        const note = makeNote({
            children_body: [makeList(2, [makeListItem(3, false), makeListItem(4, false)])],
        });
        const { container } = render(<MarkdownNote {...note} />);
        const body = container.querySelector('[class*="body"]');
        if (body) {
            // task at top, no scroll needed
            const task_el = body.querySelector('[data-seq="3"]');
            if (task_el) {
                Object.defineProperty(task_el, 'offsetTop', { value: 0, configurable: true });
            }
            simulateOverflow(body as HTMLElement, 500, 200);
        }
        // only bottom Show more, no top
        const buttons = screen.getAllByRole('button', { name: /show more/i });
        expect(buttons.length).toBe(1);
    });

    it('does not scroll when note has no tasks', () => {
        const paragraph: NoteProps = {
            seq: 2,
            level: 3,
            type: 'paragraph',
            children_body: [],
            children: [],
            position: { start: { offset: 20, line: 2 }, end: { offset: 100, line: 10 } },
            headline_raw: 'just text',
            body_raw: '',
        };
        const note = makeNote({ children_body: [paragraph] });
        const { container } = render(<MarkdownNote {...note} />);
        const body = container.querySelector('[class*="body"]');
        if (body) { simulateOverflow(body as HTMLElement, 500, 200); }
        // only bottom Show more (no top fade since scrollTop stays 0)
        const buttons = screen.getAllByRole('button', { name: /show more/i });
        expect(buttons.length).toBe(1);
    });

    it('stays expanded when a checkbox tick rewrites the body', () => {
        const { body, rerender, note } = renderExpandedNote();
        rerender(<ExpansionHost note={{ ...note, body_raw: '+ [X] done\n+ [X] todo' }} />);
        expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
        expect(body.style.maxHeight).toBe('');
    });

    it('collapses when the headline is edited', () => {
        /*
         * the implicit stable_id is the headline slug, so retitling mints an id nothing ever put in the
         * list and the card falls back to clipped. Document view and kanban behave alike here; carrying
         * an id across a rename is a re-parse concern, not this layer's.
         */
        const { container, rerender, note } = renderExpandedNote();
        rerender(<ExpansionHost note={{ ...note, headline_raw: '### Story title renamed', stable_id: 'story-title-renamed' }} />);
        const body = remeasuredBody(container);
        expect(screen.queryByRole('button', { name: /show less/i })).not.toBeInTheDocument();
        expect(body).toHaveStyle({ maxHeight: '200px', overflow: 'hidden' });
    });

    it('collapses when "Show less" is clicked', () => {
        const { body } = renderExpandedNote();
        fireEvent.click(screen.getByRole('button', { name: /show less/i }));
        expect(screen.queryByRole('button', { name: /show less/i })).not.toBeInTheDocument();
        expect(body).toHaveStyle({ maxHeight: '200px', overflow: 'hidden' });
    });

    it('collapses when a different note takes the slot, and re-expands when the original returns', () => {
        // expansion is per stable_id, so the flag belongs to the note the user expanded and not to the slot it sat in
        const { container, rerender, note } = renderExpandedNote();
        rerender(<ExpansionHost note={{ ...note, stable_id: 'story-b', headline_raw: '### Another story' }} />);
        expect(remeasuredBody(container)).toHaveStyle({ maxHeight: '200px', overflow: 'hidden' });
        expect(screen.queryByRole('button', { name: /show less/i })).not.toBeInTheDocument();
        rerender(<ExpansionHost note={note} />);
        expect(remeasuredBody(container).style.maxHeight).toBe('');
        expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
    });

    it('stays expanded when a story inserted above reassigns its seq', () => {
        /*
         * a global renumber moves every seq, and the card is deliberately keyed by seq here so the
         * renumber costs it its instance. The expanded list holds stable_ids and lives in the view,
         * so expansion survives the handover an identity key would have avoided in the first place.
         */
        const { container, rerender, note } = renderExpandedNote(true);
        rerender(<ExpansionHost keyBySeq note={{
            ...note,
            seq: note.seq + 4,
            parent_notes: [{ seq: PARENT_SEQ + 4 } as NoteProps],
            display_options: { parent_context_seq: PARENT_SEQ + 4 },
        }} />);
        const body = remeasuredBody(container);
        expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
        expect(body.style.maxHeight).toBe('');
    });

    it('stays expanded when it remounts under a different parent (kanban column move)', () => {
        // dragging a card to another column unmounts it and remounts it in the new lane's Droppable, killing the instance
        const { container, rerender, note } = renderExpandedNote();
        rerender(<ExpansionHost note={note} column="doing" />);
        const body = remeasuredBody(container);
        expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
        expect(body.style.maxHeight).toBe('');
    });
});

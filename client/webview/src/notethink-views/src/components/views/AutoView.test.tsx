import React from 'react';
import { render, screen } from '@testing-library/react';
import AutoView from './AutoView';
import type { ViewProps } from '../../types/ViewProps';
import type { NoteProps } from '../../types/NoteProps';

// mock GenericView since AutoView delegates to it
jest.mock('./GenericView', () => ({
    __esModule: true,
    default: (props: ViewProps) => (
        <div
            data-testid="generic-view"
            data-type={props.type}
            data-parent-context-seq={props.display_options?.parent_context_seq}
            data-level={props.display_options?.level}
            data-auto-resolved-type={props.nested?.auto_resolved_type || ''}
            data-auto-resolved-card-type={props.nested?.auto_resolved_card_type || ''}
            data-card-type={props.display_options?.settings?.cardType || ''}
            data-replaced-card-type={(props.nested?.replaced_attributes?.card_type as string) || ''}
        >
            GenericView type={props.type}
        </div>
    ),
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
        },
        headline_raw: '# Root',
        body_raw: '',
        ...overrides,
    };
}

function makeViewProps(overrides: Partial<ViewProps> = {}): ViewProps {
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
        render(<AutoView {...makeViewProps()} />);
        expect(screen.getByTestId('generic-view')).toBeInTheDocument();
    });

    it('defaults to document view type when no linetags', () => {
        render(<AutoView {...makeViewProps()} />);
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-type', 'document');
    });

    it('wraps in a fullheight container with data-auto-selected-viewtype', () => {
        const { container } = render(<AutoView {...makeViewProps()} />);
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
        render(<AutoView {...props} />);
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
        render(<AutoView {...props} />);
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
        render(<AutoView {...props} />);
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-level', '3');
    });

    it('derives kanban view type from the nt_view prefix (write-forward synonym)', () => {
        const focused_note = makeNote({
            seq: 1,
            linetags: {
                'nt_view': { key: 'nt_view', value: 'kanban', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes: [makeNote(), focused_note],
            display_options: {
                focused_notes: [focused_note],
            },
        });
        render(<AutoView {...props} />);
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-type', 'kanban');
    });

    it('derives level from the nt_level prefix (write-forward synonym)', () => {
        const focused_note = makeNote({
            seq: 1,
            linetags: {
                'nt_level': { key: 'nt_level', value: '3', value_numeric: 3, note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            display_options: {
                focused_notes: [focused_note],
            },
        });
        render(<AutoView {...props} />);
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-level', '3');
    });

    it('passes auto_resolved_type via nested prop', () => {
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
        render(<AutoView {...props} />);
        const view = screen.getByTestId('generic-view');
        expect(view).toHaveAttribute('data-auto-resolved-type', 'kanban');
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
        const { container } = render(<AutoView {...props} />);
        const wrapper = container.querySelector('[data-auto-selected-viewtype]');
        expect(wrapper).toHaveAttribute('data-auto-selected-viewtype', 'kanban');
    });

    describe('folder mode', () => {

        function makeAggregateRoot(): NoteProps {
            return {
                seq: 0,
                level: 0,
                type: 'root',
                position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } },
                children: [],
                children_body: [],
                child_notes: [],
                headline_raw: '',
                body_raw: '',
            };
        }

        function makeStory(seq: number, doc_id: string, file_view_type?: string): NoteProps {
            return makeNote({
                seq,
                level: 1,
                origin: { doc_id, doc_path: `/repo/${doc_id}.md`, file_view_type },
            });
        }

        it('majority vote: 2/3 files vote kanban → kanban', () => {
            const root = makeAggregateRoot();
            const stories = [
                makeStory(1, 'a', 'kanban'),
                makeStory(2, 'b', 'kanban'),
                makeStory(3, 'c', 'document'),
            ];
            root.child_notes = stories;
            const props = makeViewProps({
                notes: [root, ...stories],
                nested: { parent_context: root },
            });
            render(<AutoView {...props} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-type', 'kanban');
        });

        it('majority vote: tie falls back to document', () => {
            const root = makeAggregateRoot();
            const stories = [
                makeStory(1, 'a', 'kanban'),
                makeStory(2, 'b', 'document'),
            ];
            root.child_notes = stories;
            const props = makeViewProps({
                notes: [root, ...stories],
                nested: { parent_context: root },
            });
            render(<AutoView {...props} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-type', 'document');
        });

        it('no votes (no file_view_type anywhere): falls back to document', () => {
            const root = makeAggregateRoot();
            const stories = [
                makeStory(1, 'a'),
                makeStory(2, 'b'),
            ];
            root.child_notes = stories;
            const props = makeViewProps({
                notes: [root, ...stories],
                nested: { parent_context: root },
            });
            render(<AutoView {...props} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-type', 'document');
        });

        it('multiple stories from same file vote only once', () => {
            /*
             * file 'a' has 3 stories, all carrying file_view_type=kanban; file 'b' has 1 story with document
             * single-vote per file → 1 kanban vs 1 document → tie → falls back to document
             */
            const root = makeAggregateRoot();
            const stories = [
                makeStory(1, 'a', 'kanban'),
                makeStory(2, 'a', 'kanban'),
                makeStory(3, 'a', 'kanban'),
                makeStory(4, 'b', 'document'),
            ];
            root.child_notes = stories;
            const props = makeViewProps({
                notes: [root, ...stories],
                nested: { parent_context: root },
            });
            render(<AutoView {...props} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-type', 'document');
        });

        it('single-file mode (no origin on children) is not affected by majority-vote path', () => {
            // children with no origin → not aggregate root → falls back to existing logic (document)
            const root = makeAggregateRoot();
            root.child_notes = [makeNote({ seq: 1 })];
            const props = makeViewProps({
                notes: [root, makeNote({ seq: 1 })],
                nested: { parent_context: root },
            });
            render(<AutoView {...props} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-type', 'document');
        });
    });

    describe('card axis', () => {

        function makeAggregateRoot(): NoteProps {
            return {
                seq: 0,
                level: 0,
                type: 'root',
                position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } },
                children: [],
                children_body: [],
                child_notes: [],
                headline_raw: '',
                body_raw: '',
            };
        }

        function makeStory(seq: number, doc_id: string, file_card_type?: string, file_view_type?: string): NoteProps {
            return makeNote({
                seq,
                level: 1,
                origin: { doc_id, doc_path: `/repo/${doc_id}.md`, file_card_type, file_view_type },
            });
        }

        function renderFolder(stories: NoteProps[], card_selection?: string): NoteProps {
            const root = makeAggregateRoot();
            root.child_notes = stories;
            const props = makeViewProps({
                notes: [root, ...stories],
                nested: { parent_context: root },
                display_options: card_selection ? { settings: { cardType: card_selection } } : {},
            });
            render(<AutoView {...props} />);
            return root;
        }

        it('resolves to the view default card when nothing declares one', () => {
            render(<AutoView {...makeViewProps()} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-card-type', 'card');
        });

        it('publishes the resolved card type on the wrapper alongside the view type', () => {
            const { container } = render(<AutoView {...makeViewProps()} />);
            const wrapper = container.querySelector('[data-auto-selected-cardtype]');
            expect(wrapper).toHaveAttribute('data-auto-selected-cardtype', 'card');
            expect(wrapper).toHaveAttribute('data-auto-selected-viewtype', 'document');
        });

        it('publishes the resolved card type via the nested prop', () => {
            render(<AutoView {...makeViewProps()} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-auto-resolved-card-type', 'card');
        });

        it('majority vote: 2/3 files vote sticky → sticky', () => {
            renderFolder([
                makeStory(1, 'a', 'sticky'),
                makeStory(2, 'b', 'sticky'),
                makeStory(3, 'c', 'card'),
            ]);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-card-type', 'sticky');
        });

        it('majority vote: a tie falls back to the view default card', () => {
            renderFolder([
                makeStory(1, 'a', 'sticky'),
                makeStory(2, 'b', 'card'),
            ]);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-card-type', 'card');
        });

        it('majority vote: no nt_card anywhere falls back to the view default card', () => {
            renderFolder([makeStory(1, 'a'), makeStory(2, 'b')]);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-card-type', 'card');
        });

        it('votes the card axis independently of the view axis', () => {
            renderFolder([
                makeStory(1, 'a', 'sticky', 'kanban'),
                makeStory(2, 'b', 'sticky', 'kanban'),
            ]);
            const view = screen.getByTestId('generic-view');
            expect(view).toHaveAttribute('data-type', 'kanban');
            expect(view).toHaveAttribute('data-card-type', 'sticky');
        });

        it('an explicit card selection is pinned and wins over the file votes', () => {
            renderFolder([
                makeStory(1, 'a', 'sticky'),
                makeStory(2, 'b', 'sticky'),
            ], 'card');
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-card-type', 'card');
        });

        it('an explicit card selection applies with no votes to fall back on', () => {
            render(<AutoView {...makeViewProps({ display_options: { settings: { cardType: 'sticky' } } })} />);
            expect(screen.getByTestId('generic-view')).toHaveAttribute('data-card-type', 'sticky');
        });

        it('carries the card selection on replaced_attributes so the toolbar can word "Auto (...)"', () => {
            renderFolder([
                makeStory(1, 'a', 'sticky'),
                makeStory(2, 'b', 'sticky'),
            ]);
            const view = screen.getByTestId('generic-view');
            expect(view).toHaveAttribute('data-replaced-card-type', 'auto');
            expect(view).toHaveAttribute('data-auto-resolved-card-type', 'sticky');
        });
    });
});

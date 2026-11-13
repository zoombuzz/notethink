import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import VirtualCaret from './VirtualCaret';
import { convertMdastToNoteHierarchy } from '../../../lib/convertMdastToNoteHierarchy';
import { flattenAllNotes } from '../../../lib/noteops';
import type { NoteProps } from '../../../types/NoteProps';
import type { ViewApi, ViewProps } from '../../../types/ViewProps';

const TEXT = '## Task **B** [](?status=doing)\n\nbody\n';
const DOC_PATH = '/ws/a.md';

function parse(text: string): NoteProps[] {
    const root = convertMdastToNoteHierarchy(fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), text);
    return flattenAllNotes(root).map((note, index) => ({ ...note, stable_id: `n${index}` }));
}

// the headline DOM MarkdownNoteHeadline draws in a dev build, reduced to what the caret reads
function Headline(props: { note: NoteProps; title?: React.ReactNode }): React.ReactElement {
    const { note, title } = props;
    return (
        <div data-seq={note.seq}>
            <div role="rowheader">
                <span data-vc-title="">{title ?? <>Task <strong>B</strong></>}</span>
                <span>status=<span data-vc-linetag="status">doing</span></span>
            </div>
        </div>
    );
}

function setup(overrides: Partial<ViewProps> = {}, typing = false, text = TEXT, title?: React.ReactNode): { post: jest.Mock; rerender: (notes: NoteProps[], extra?: Partial<ViewProps>) => void; heading: () => NoteProps } {
    const post = jest.fn();
    const handlers = { postMessage: post } as unknown as ViewApi;
    const scope_ref = { current: null };
    let notes = parse(text);
    const heading = (): NoteProps => notes.find(note => note.type === 'heading')!;
    const view = (current: NoteProps[], extra: Partial<ViewProps> = {}): React.ReactElement => (
        <>
            <Headline note={current.find(note => note.type === 'heading')!} title={title} />
            <VirtualCaret view_props={{ notes: current, doc_path: DOC_PATH, ...overrides, ...extra } as ViewProps} handlers={handlers} scope_ref={scope_ref} typing={typing} />
        </>
    );
    const rendered = render(view(notes));
    return { post, heading, rerender: (next, extra) => { notes = next; rendered.rerender(view(next, extra)); } };
}

function key(name: string): void {
    fireEvent.keyDown(screen.getByTestId('virtual-caret-input'), { key: name });
}

beforeAll(() => {
    // jsdom lays nothing out, so a range has no rectangles
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

describe('VirtualCaret in a production build', () => {
    const editor_at = (head: number, anchor = head): Partial<ViewProps> => ({ selection: { main: { head, anchor } } as ViewProps['selection'] });

    it('draws the editor\'s caret in a title and in a linetag value', () => {
        const { rerender } = setup(editor_at(6));
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-field', 'title');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '3');
        // source offset 27 is inside the linetag value "doing"
        act(() => { rerender(parse(TEXT), editor_at(27)); });
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-field', 'status');
    });

    it('takes no keys: there is no input, and a click arms nothing and posts nothing', () => {
        const { post } = setup(editor_at(6));
        expect(screen.queryByTestId('virtual-caret-input')).toBeNull();
        fireEvent.click(document.querySelector('[data-vc-linetag="status"]')!);
        fireEvent.keyDown(document.body, { key: 'X' });
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-field', 'title');
        expect(post).not.toHaveBeenCalled();
    });

    it('draws nothing with no editor selection, and a click alone does not make a caret', () => {
        const { post } = setup();
        fireEvent.click(document.querySelector('[data-vc-title]')!);
        expect(screen.queryByTestId('virtual-caret')).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });

    it('hides for a range selection, a selection outside titles and values, and a cleared selection', () => {
        const { rerender } = setup(editor_at(6));
        expect(screen.getByTestId('virtual-caret')).toBeInTheDocument();
        act(() => { rerender(parse(TEXT), editor_at(6, 4)); });
        expect(screen.queryByTestId('virtual-caret')).toBeNull();
        act(() => { rerender(parse(TEXT), editor_at(6)); });
        expect(screen.getByTestId('virtual-caret')).toBeInTheDocument();
        // offset 36 is in the body text
        act(() => { rerender(parse(TEXT), editor_at(36)); });
        expect(screen.queryByTestId('virtual-caret')).toBeNull();
        act(() => { rerender(parse(TEXT), editor_at(6)); });
        act(() => { rerender(parse(TEXT), { selection: undefined }); });
        expect(screen.queryByTestId('virtual-caret')).toBeNull();
    });

    it('draws nothing in a title the mapping cannot read, where the rendered text is not the one it expects', () => {
        // the source holds an entity; the viewer renders "A & B", while the map counts the literal "A &amp; B"
        setup(editor_at(6), false, '## A &amp; B [](?status=doing)\n\nbody\n', 'A & B');
        expect(screen.queryByTestId('virtual-caret')).toBeNull();
    });

    it('never moves focus', () => {
        setup(editor_at(6));
        expect(document.activeElement).toBe(document.body);
    });
});

describe('VirtualCaret typing prototype in a dev build', () => {
    it('draws a caret in the title where a click lands, and in a linetag value', () => {
        setup({}, true);
        fireEvent.click(document.querySelector('[data-vc-title]')!);
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-field', 'title');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-mode', 'virtual');
        fireEvent.click(document.querySelector('[data-vc-linetag="status"]')!);
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-field', 'status');
    });

    it('moves with the arrow keys, Home and End, and stops at the ends', () => {
        setup({}, true);
        fireEvent.click(document.querySelector('[data-vc-title]')!);
        // jsdom has no hit testing, so the click lands at the end of "Task B"
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '6');
        key('Home');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '0');
        key('ArrowLeft');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '0');
        key('ArrowRight');
        key('ArrowRight');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '2');
        key('End');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '6');
    });

    it('relays typing and Backspace as editText with source offsets, and holds the next key until the update lands', () => {
        const { post, rerender } = setup({}, true);
        fireEvent.click(document.querySelector('[data-vc-title]')!);
        key('Home');
        key('X');
        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenLastCalledWith({ type: 'editText', docPath: DOC_PATH, changes: [{ from: 3, insert: 'X' }] });
        // a second key before the round trip waits for it
        key('Y');
        expect(post).toHaveBeenCalledTimes(1);
        const edited = '## XTask **B** [](?status=doing)\n\nbody\n';
        act(() => { rerender(parse(edited)); });
        expect(post).toHaveBeenCalledTimes(2);
        expect(post).toHaveBeenLastCalledWith({ type: 'editText', docPath: DOC_PATH, changes: [{ from: 4, insert: 'Y' }] });
    });

    it('relays nothing for a character a linetag value cannot hold', () => {
        const { post } = setup({}, true);
        fireEvent.click(document.querySelector('[data-vc-linetag="status"]')!);
        key('&');
        expect(post).not.toHaveBeenCalled();
        key('s');
        expect(post).toHaveBeenCalledWith({ type: 'editText', docPath: DOC_PATH, changes: [{ from: 30, insert: 's' }] });
    });

    it('Escape drops the caret', () => {
        setup({}, true);
        fireEvent.click(document.querySelector('[data-vc-title]')!);
        key('Escape');
        expect(screen.queryByTestId('virtual-caret')).toBeNull();
    });

    it('follows the editor caret while the file is open, moves it with selectRange and never types', () => {
        const { post } = setup({ selection: { main: { head: 6, anchor: 6 } } as ViewProps['selection'], active_editor_doc_path: undefined }, true);
        // source offset 6 is inside "Task" (3 + 3)
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-mode', 'editor');
        expect(screen.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '3');
        fireEvent.click(document.querySelector('[data-vc-title]')!);
        post.mockClear();
        key('Home');
        expect(post).toHaveBeenLastCalledWith({ type: 'selectRange', from: 3, to: 3, docPath: DOC_PATH, forceOpen: false });
        post.mockClear();
        key('X');
        expect(post).not.toHaveBeenCalled();
    });
});

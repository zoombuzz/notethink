import React, { Suspense, useRef } from "react";
import { render, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { convertMdastToNoteHierarchy } from "../../../lib/convertMdastToNoteHierarchy";
import GenericNote from "../../notes/GenericNote";
import { useViewHandlers } from "./useViewHandlers";
import type { NoteProps } from "../../../types/NoteProps";
import type { ViewProps } from "../../../types/ViewProps";

type RenderedTaskDoc = RenderResult & {
    post: jest.Mock;
    heading: NoteProps;
    checkboxes: () => HTMLInputElement[];
    editTextCalls: () => Array<Record<string, unknown>>;
};

/*
 * Integration regression guard for viewer task-checkbox toggling: render a real task
 * list through the real GenericNote tree + useViewHandlers, click the rendered
 * checkbox, and assert an editText is posted that flips the source state char. This
 * exercises the whole render -> click -> editText pipeline that silently regressed for
 * '+'/'*' bullets and for single-file mode (undefined docPath). The pre-existing unit
 * tests hand-fed the handler a dash-bullet body and the resolved note, so they stayed
 * green while the real pipeline produced no edit.
 */

function parse(text: string): ReturnType<typeof fromMarkdown> {
    return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

function findByType(note: NoteProps, type: string): NoteProps | undefined {
    if (note.type === type) { return note; }
    for (const child of note.children_body || []) {
        if ('seq' in (child as NoteProps)) {
            const found = findByType(child as NoteProps, type);
            if (found) { return found; }
        }
    }
    return undefined;
}

beforeEach(() => {
    global.ResizeObserver = jest.fn(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() })) as unknown as typeof ResizeObserver;
    (global as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = jest.fn(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() })) as unknown as typeof IntersectionObserver;
    Element.prototype.getBoundingClientRect = jest.fn(() => ({ top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: 0, toJSON() {} } as DOMRect));
});

const DOC_PATH = '/workspace/todo.md';

function Harness({ heading, postMessage }: { heading: NoteProps; postMessage: jest.Mock }): React.ReactElement {
    const selection_ref = useRef<ViewProps['selection']>(undefined);
    const view_props: ViewProps = {
        id: 'v1',
        type: 'document',
        doc_path: DOC_PATH,
        display_options: { deepest: { selectable_level: 1 } },
        handlers: {
            setViewManagedState: () => {},
            deleteViewFromManagedState: () => {},
            revertAllViewsToDefaultState: () => {},
            postMessage,
        },
    };
    const { handlers } = useViewHandlers(view_props, selection_ref);
    return (
        <Suspense fallback={<div>loading</div>}>
            <GenericNote {...heading} handlers={handlers} display_options={{ view_id: 'v1', deepest: { selectable_level: 1 } }} />
        </Suspense>
    );
}

async function renderTaskDoc(text: string): Promise<RenderedTaskDoc> {
    const root = convertMdastToNoteHierarchy(parse(text), text);
    const heading = findByType(root, 'heading')!;
    const post = jest.fn();
    const utils = render(<Harness heading={heading} postMessage={post} />);
    await waitFor(() => expect(utils.container.querySelector('[role="rowheader"]')).toBeTruthy());
    const checkboxes = (): HTMLInputElement[] => Array.from(utils.container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const editTextCalls = (): Array<Record<string, unknown>> => post.mock.calls.map(c => c[0]).filter((m: { type?: string }) => m?.type === 'editText');
    return { ...utils, post, heading, checkboxes, editTextCalls };
}

describe('viewer task-checkbox toggle (render -> click -> editText)', () => {
    it('renders interactive (non-disabled) checkboxes for a task list', async () => {
        const { checkboxes } = await renderTaskDoc("## Story\n\n- [ ] do something\n- [x] done thing\n");
        const boxes = checkboxes();
        expect(boxes).toHaveLength(2);
        expect(boxes.every(b => !b.disabled)).toBe(true);
    });

    it('toggles a DASH bullet task and posts editText with X at the source state char', async () => {
        const { checkboxes, editTextCalls } = await renderTaskDoc("## Story\n\n- [ ] do something\n");
        fireEvent.click(checkboxes()[0]);
        const calls = editTextCalls();
        expect(calls).toHaveLength(1);
        // "## Story\n\n- [ ] do something": state char is offset 13
        expect(calls[0].changes).toEqual([{ from: 13, to: 14, insert: 'X' }]);
        expect(calls[0].docPath).toBe(DOC_PATH);
    });

    it('toggles a PLUS bullet task (the regression) and posts editText', async () => {
        const { checkboxes, editTextCalls } = await renderTaskDoc("## Story\n\n+ [ ] first task\n");
        fireEvent.click(checkboxes()[0]);
        const calls = editTextCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0].changes).toEqual([{ from: 13, to: 14, insert: 'X' }]);
        expect(calls[0].docPath).toBe(DOC_PATH);
    });

    it('toggles a STAR bullet task and posts editText', async () => {
        const { checkboxes, editTextCalls } = await renderTaskDoc("## Story\n\n* [ ] starred task\n");
        fireEvent.click(checkboxes()[0]);
        const calls = editTextCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0].changes).toEqual([{ from: 13, to: 14, insert: 'X' }]);
    });

    it('unchecks an already-checked task (inserts a space)', async () => {
        const { checkboxes, editTextCalls } = await renderTaskDoc("## Story\n\n+ [x] first task\n");
        // the box renders checked; a plain click toggles the DOM checked to false before the handler reads it
        fireEvent.click(checkboxes()[0]);
        const calls = editTextCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0].changes[0].insert).toBe(' ');
    });

    it('falls back to the view doc_path in single-file mode (no origin)', async () => {
        const { checkboxes, editTextCalls } = await renderTaskDoc("## Story\n\n+ [ ] first task\n");
        fireEvent.click(checkboxes()[0]);
        // the parsed note carries no origin, so docPath must come from the view's own doc_path
        expect(editTextCalls()[0].docPath).toBe(DOC_PATH);
    });
});

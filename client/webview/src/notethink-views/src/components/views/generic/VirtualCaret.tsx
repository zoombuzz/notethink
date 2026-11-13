import Debug from "debug";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, RefObject } from "react";
import { createPortal } from "react-dom";
import { renderedOffsetFromPoint, rectAtRenderedOffset } from "../../../lib/caretdom";
import type { CaretRect } from "../../../lib/caretdom";
import { caretFieldsOf, editForKey, fieldAt, moveCaret, noteSourceStart, renderedToSource } from "../../../lib/caretops";
import type { CaretEdit, CaretField, CaretMove } from "../../../lib/caretops";
import { findDeepestNote, findDeepestNoteByOriginPosition } from "../../../lib/noteops";
import type { NoteProps } from "../../../types/NoteProps";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import styles from "./VirtualCaret.module.scss";

const debug = Debug("nodejs:notethink-views:components:views:generic:VirtualCaret");

// a relayed edit that never comes back (refused, or its update coalesced) frees the queue after this long
const ROUND_TRIP_TIMEOUT_MS = 1500;
const MOVES: Record<string, CaretMove> = { ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end' };

/**
 * Where the caret stands: which note and field, and the rendered offset inside it. The note is held by
 * its start in its own file, not by stable_id, because a relayed title edit renames the note and so
 * changes its stable_id, while the start of the note an edit lands inside never moves.
 * - doc_path: the file in folder mode, undefined in single-file mode
 * - field_key: the linetag key for a linetag value, undefined for the title
 */
interface CaretState {
    doc_path?: string;
    note_start: number;
    field_key?: string;
    offset: number;
}

/**
 * - view_props, handlers: the view the caret draws in
 * - scope_ref: the element holding this view's cards; headlines are looked up inside it
 * - typing: the dev-only typing prototype (click to arm, hidden input, relayed edits); false draws the editor's caret and nothing else
 */
interface VirtualCaretProps {
    view_props: ViewProps;
    handlers: ViewApi;
    scope_ref: RefObject<HTMLElement | null>;
    typing: boolean;
}

/**
 * The editor's caret drawn in a card title or linetag value, in every build. It shows where the user is
 * typing in the text editor beside the viewer and takes no keys, posts no edits and never arms on a
 * click, so the viewer stays out of the keyboard. With `typing` set (a dev build) the
 * spike's typing prototype is added on top: a click arms the caret and the webview relays edits itself.
 */
export default function VirtualCaret(props: VirtualCaretProps): ReactElement {
    return <VirtualCaretLayer {...props} />;
}

function noteOfCaret(notes: NoteProps[] | undefined, caret: Pick<CaretState, 'doc_path' | 'note_start'>): NoteProps | undefined {
    return (notes ?? []).find(note => note.type !== 'root' && note.origin?.doc_path === caret.doc_path && noteSourceStart(note) === caret.note_start);
}

function fieldOf(note: NoteProps, key: string | undefined): CaretField | undefined {
    return caretFieldsOf(note).find(field => (field.kind === 'title' ? key === undefined : field.key === key));
}

// a note's own headline: the first rowheader in its seq element, since tree offsets repeat across a folder view's files
function headlineOf(note: NoteProps, scope: ParentNode): HTMLElement | null {
    return scope.querySelector<HTMLElement>(`[data-seq="${note.seq}"] [role="rowheader"]`);
}

function fieldElement(headline: HTMLElement, key: string | undefined): HTMLElement | null {
    return key === undefined
        ? headline.querySelector<HTMLElement>('[data-vc-title]')
        : Array.from(headline.querySelectorAll<HTMLElement>('[data-vc-linetag]')).find(element => element.dataset.vcLinetag === key) ?? null;
}

// eslint-disable-next-line max-lines-per-function -- the follow-the-editor path and the dev typing prototype share one caret state
function VirtualCaretLayer(props: VirtualCaretProps): ReactElement | null {
    const { view_props, handlers, scope_ref, typing } = props;
    const { notes, selection, active_editor_doc_path } = view_props;
    const [caret, setCaret] = useState<CaretState | undefined>(undefined);
    const [rect, setRect] = useState<CaretRect | undefined>(undefined);
    const [tick, setTick] = useState(0);
    const input_ref = useRef<HTMLInputElement>(null);
    const caret_ref = useRef(caret);
    caret_ref.current = caret;
    const notes_ref = useRef(notes);
    notes_ref.current = notes;
    // relayed edits wait for their round trip, since each is computed against the source as it stands
    const pending_notes_ref = useRef<NoteProps[] | undefined>(undefined);
    const pending_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const queue_ref = useRef<Array<'Backspace' | 'Delete' | { text: string }>>([]);
    const editor_head = selection?.main.head;
    // a range selection is not a caret: the editor draws it, and the viewer shows nothing
    const editor_is_range = selection !== undefined && selection.main.anchor !== selection.main.head;
    // an editor owns the caret of a file it shows; null selections clear it, so a defined one means open
    const editor_live = editor_head !== undefined;
    const postMove = useCallback((field: CaretField, rendered_offset: number): void => {
        const source = renderedToSource(field, rendered_offset);
        handlers.postMessage?.({ type: 'selectRange', from: source, to: source, docPath: field.doc_path ?? view_props.doc_path, forceOpen: false });
    }, [handlers, view_props.doc_path]);
    // the caret follows the editor's real caret while the file is open
    useEffect(() => {
        // with no editor selection the dev prototype keeps its own caret; the shipped caret has nothing to follow
        if (editor_head === undefined) { if (!typing) { setCaret(undefined); } return; }
        if (editor_is_range) { setCaret(undefined); return; }
        const all_notes = notes ?? [];
        // folder mode resolves by the note's origin; a single file has none, so its tree offsets are the file's own
        const by_origin = active_editor_doc_path ? findDeepestNoteByOriginPosition(all_notes, active_editor_doc_path, editor_head) : undefined;
        const in_tree = by_origin ? undefined : findDeepestNote(all_notes, editor_head);
        const note = by_origin ?? (in_tree && !in_tree.origin ? in_tree : undefined);
        const hit = note ? fieldAt(caretFieldsOf(note), note.origin?.doc_path, editor_head) : undefined;
        const note_start = note ? noteSourceStart(note) : undefined;
        // an editor caret outside every title and linetag value leaves nothing to draw
        if (!note || !hit || note_start === undefined) { setCaret(undefined); return; }
        setCaret({ doc_path: note.origin?.doc_path, note_start, field_key: hit.field.kind === 'linetag' ? hit.field.key : undefined, offset: hit.rendered_offset });
    }, [editor_head, editor_is_range, typing, notes, active_editor_doc_path]);
    // a click on a title or a linetag value puts the caret there and takes the keys
    useEffect(() => {
        if (!typing) { return; }
        function onClick(event: MouseEvent): void {
            const target = event.target as HTMLElement | null;
            const headline = target?.closest<HTMLElement>('[role="rowheader"]');
            const seq = headline?.closest<HTMLElement>('[data-seq]')?.dataset.seq;
            if (!headline || seq === undefined) { return; }
            const note = (notes_ref.current ?? []).find(candidate => candidate.type !== 'root' && candidate.seq === Number(seq));
            const note_start = note ? noteSourceStart(note) : undefined;
            debug('click on headline of seq %s resolved to note start %s', seq, note_start);
            if (!note || note_start === undefined) { return; }
            const tag_element = target?.closest<HTMLElement>('[data-vc-linetag]');
            const key = tag_element?.dataset.vcLinetag;
            const element = tag_element ?? target?.closest<HTMLElement>('[data-vc-title]');
            if (!element) { return; }
            const field = fieldOf(note, key);
            debug('field for %s: %O', key ?? 'title', field);
            if (!field) { return; }
            const offset = renderedOffsetFromPoint(element, event.clientX, event.clientY) ?? field.map.rendered.length;
            const clamped = Math.min(offset, field.map.rendered.length);
            setCaret({ doc_path: note.origin?.doc_path, note_start, field_key: key, offset: clamped });
            if (editor_live) { postMove(field, clamped); }
            input_ref.current?.focus({ preventScroll: true });
        }
        // captured, because the note's own click handler stops propagation before it reaches the document
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [typing, editor_live, postMove]);
    // one relayed edit at a time: send it, and hold the next keys until the update that carries it lands
    const relay = useCallback((key: 'Backspace' | 'Delete' | { text: string }): void => {
        const current = caret_ref.current;
        const note = current ? noteOfCaret(notes_ref.current, current) : undefined;
        const field = note ? fieldOf(note, current?.field_key) : undefined;
        if (!current || !field) { return; }
        if (pending_notes_ref.current) { queue_ref.current.push(key); return; }
        const edit: CaretEdit | undefined = editForKey(field, current.offset, key);
        if (!edit) { return; }
        pending_notes_ref.current = notes_ref.current;
        pending_timer_ref.current = setTimeout(() => {
            pending_notes_ref.current = undefined;
            queue_ref.current = [];
        }, ROUND_TRIP_TIMEOUT_MS);
        setCaret({ ...current, offset: edit.next_caret });
        handlers.postMessage?.({ type: 'editText', docPath: field.doc_path ?? view_props.doc_path, changes: [edit.change] });
    }, [handlers, view_props.doc_path]);
    // the update carrying a relayed edit has landed: release the next queued key
    useEffect(() => {
        if (!pending_notes_ref.current || pending_notes_ref.current === notes) { return; }
        pending_notes_ref.current = undefined;
        if (pending_timer_ref.current) { clearTimeout(pending_timer_ref.current); }
        const next = queue_ref.current.shift();
        if (next) { relay(next); }
    }, [notes, relay]);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
        const current = caret_ref.current;
        if (!current) { return; }
        // the viewer's own key handling and any host keybinding must not see a key the caret consumed
        event.stopPropagation();
        if (event.key === 'Escape') {
            setCaret(undefined);
            input_ref.current?.blur();
            return;
        }
        const note = noteOfCaret(notes_ref.current, current);
        const field = note ? fieldOf(note, current.field_key) : undefined;
        if (!field) { return; }
        if (MOVES[event.key]) {
            event.preventDefault();
            const next = moveCaret(field, current.offset, MOVES[event.key]);
            setCaret({ ...current, offset: next });
            if (editor_live) { postMove(field, next); }
            return;
        }
        const is_edit_key = event.key === 'Backspace' || event.key === 'Delete' || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey);
        if (!is_edit_key) { return; }
        event.preventDefault();
        // with the file open the editor owns its text: the viewer never types into it
        if (editor_live) { return; }
        relay(event.key.length === 1 ? { text: event.key } : event.key as 'Backspace' | 'Delete');
    }, [editor_live, postMove, relay]);
    // place the drawn caret over the field's text after every render that could have moved it
    useLayoutEffect(() => {
        if (!caret) { setRect(undefined); return; }
        const note = noteOfCaret(notes, caret);
        const scope = scope_ref.current ?? document;
        const headline = note ? headlineOf(note, scope) : null;
        const element = headline ? fieldElement(headline, caret.field_key) : null;
        const field = note ? fieldOf(note, caret.field_key) : undefined;
        // an unmappable title (autolink, entity, raw HTML) renders other text than the map expects, and no caret beats a wrong one
        const mappable = !!element && !!field && element.textContent?.trim() === field.map.rendered.trim();
        const next = element && mappable ? rectAtRenderedOffset(element, caret.offset) : undefined;
        // read by the performance probe to say why a caret is not drawn
        (window as unknown as { __virtual_caret_state?: unknown }).__virtual_caret_state = { note_found: !!note, headline_found: !!headline, element_found: !!element, caret };
        setRect(previous => (previous && next && previous.left === next.left && previous.top === next.top && previous.height === next.height) ? previous : next);
    }, [caret, notes, tick, scope_ref]);
    // recorded for the performance probe: when the drawn caret last settled
    useEffect(() => {
        const probe = window as unknown as { __virtual_caret_paints?: number[] };
        (probe.__virtual_caret_paints ??= []).push(performance.now());
    }, [rect]);
    useEffect(() => {
        const bump = (): void => setTick(value => value + 1);
        window.addEventListener('scroll', bump, true);
        window.addEventListener('resize', bump);
        return () => {
            window.removeEventListener('scroll', bump, true);
            window.removeEventListener('resize', bump);
        };
    }, []);
    useEffect(() => () => { if (pending_timer_ref.current) { clearTimeout(pending_timer_ref.current); } }, []);
    debug('caret %O editor_live %s', caret, editor_live);
    return createPortal(
        <>
            {typing && <input
                ref={input_ref}
                data-testid="virtual-caret-input"
                aria-label="Virtual caret"
                autoComplete="off"
                value=""
                onChange={() => {}}
                onKeyDown={onKeyDown}
                onBlur={() => {}}
                style={{ position: 'fixed', left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />}
            {rect && caret && (
                <div
                    data-testid="virtual-caret"
                    data-caret-offset={caret.offset}
                    data-caret-field={caret.field_key ?? 'title'}
                    data-caret-mode={editor_live ? 'editor' : 'virtual'}
                    aria-hidden="true"
                    className={styles.caret}
                    style={{ left: rect.left, top: rect.top, height: rect.height }}
                />
            )}
        </>,
        document.body,
    );
}

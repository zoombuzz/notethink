import { genericNoteAreEqual } from "./genericNoteEquality";
import type { NoteProps } from "../../types/NoteProps";

// shared so repeated baseNote() calls describe the same unchanged note, not a fresh array each time
const SHARED_CHILDREN_BODY: NoteProps['children_body'] = [];

function baseNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 3,
        stable_id: 'story-1',
        children_body: SHARED_CHILDREN_BODY,
        headline_raw: 'Task A',
        body_raw: 'body text',
        position: { start: { offset: 0, line: 0 }, end: { offset: 10, line: 0 } },
        children: [],
        display_options: { focused_seqs: [], selected_seqs: [], deepest: { selectable_level: 3 } },
        ...overrides,
    };
}

describe('genericNoteAreEqual', () => {
    it('treats two calls with an identical note as equal (the common re-render-everything case)', () => {
        const note = baseNote();
        expect(genericNoteAreEqual(note, { ...note })).toBe(true);
    });

    it('is unequal when a different note occupies the slot', () => {
        expect(genericNoteAreEqual(baseNote({ seq: 1 }), baseNote({ seq: 2 }))).toBe(false);
    });

    it('is unequal when the headline text changed', () => {
        expect(genericNoteAreEqual(baseNote(), baseNote({ headline_raw: 'Task A (edited)' }))).toBe(false);
    });

    it('is unequal when the note newly becomes focused', () => {
        const prev = baseNote({ display_options: { focused_seqs: [], deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { focused_seqs: [1], deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is equal when an UNRELATED note becomes focused (a different seq enters focused_seqs)', () => {
        const prev = baseNote({ seq: 1, display_options: { focused_seqs: [], deepest: { selectable_level: 3 } } });
        const next = baseNote({ seq: 1, display_options: { focused_seqs: [2], deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(true);
    });

    it('is unequal when the note newly becomes selected', () => {
        const prev = baseNote({ display_options: { selected_seqs: [], deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { selected_seqs: [1], deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is unequal when card_target_height changes (a board reflow)', () => {
        const prev = baseNote({ display_options: { card_target_height: 200, deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { card_target_height: 240, deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is equal across two fresh but content-identical draggableProps.style objects (the dnd idle-render case)', () => {
        const prev = baseNote({ display_options: { provided: { draggableProps: { style: { transform: 'none' }, 'data-flip-id': 'story-1' } }, deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { provided: { draggableProps: { style: { transform: 'none' }, 'data-flip-id': 'story-1' } }, deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(true);
    });

    it('is unequal when the drag transform actually changes', () => {
        const prev = baseNote({ display_options: { provided: { draggableProps: { style: { transform: 'translate(0px, 0px)' } } }, deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { provided: { draggableProps: { style: { transform: 'translate(10px, 0px)' } } }, deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is unequal when the dragging class is added', () => {
        const prev = baseNote({ display_options: { additional_classes: undefined, deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { additional_classes: ['dragging'], deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('falls back to comparing the focused_seqs array reference for a cropped (nested, below selectable_level) note', () => {
        const prev = baseNote({ seq: 5, level: 4, display_options: { focused_seqs: [1], deepest: { selectable_level: 3 } } });
        // same content, new reference: the conservative fallback treats this as changed
        const next = baseNote({ seq: 5, level: 4, display_options: { focused_seqs: [1], deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is equal for a cropped note when the focused_seqs reference itself is unchanged', () => {
        const shared_focused_seqs = [1];
        const prev = baseNote({ seq: 5, level: 4, display_options: { focused_seqs: shared_focused_seqs, deepest: { selectable_level: 3 } } });
        const next = baseNote({ seq: 5, level: 4, display_options: { focused_seqs: shared_focused_seqs, deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(true);
    });

    it('is unequal when the settings reference changes', () => {
        const prev = baseNote({ display_options: { settings: { cardType: 'sticky-card' }, deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { settings: { cardType: 'sticky-card' }, deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is equal when the settings reference is stabilized (unchanged across renders)', () => {
        const shared_settings = { cardType: 'sticky-card' };
        const prev = baseNote({ display_options: { settings: shared_settings, deepest: { selectable_level: 3 } } });
        const next = baseNote({ display_options: { settings: shared_settings, deepest: { selectable_level: 3 } } });
        expect(genericNoteAreEqual(prev, next)).toBe(true);
    });

    it('is unequal when child_notes reference changes (a reparse or reorder)', () => {
        const prev = baseNote({ child_notes: [] });
        const next = baseNote({ child_notes: [] });
        expect(genericNoteAreEqual(prev, next)).toBe(false);
    });

    it('is equal when display_options is the exact same reference', () => {
        const shared_display_options = { focused_seqs: [1] };
        const prev = baseNote({ display_options: shared_display_options });
        const next = baseNote({ display_options: shared_display_options });
        expect(genericNoteAreEqual(prev, next)).toBe(true);
    });
});

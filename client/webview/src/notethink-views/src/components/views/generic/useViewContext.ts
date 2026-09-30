import Debug from "debug";
import { useMemo, useRef } from "react";
import {
    findDeepestNote,
    findDeepestNoteByOriginPosition,
    findSelectedNotes,
    findSelectedNotesByOriginPosition,
    findNoteBySeq,
    focusedChainFor,
    noteOrder,
    resolveFocusedNote,
    resolveParentContextNote,
} from "../../../lib/noteops";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { ViewProps } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useViewContext");

// one shared empty list, so a view with no notes hands the same array identity to the memos below on every render
const NO_NOTES: ReadonlyArray<NoteProps> = [];

/**
 * Keeps the same `settings` object reference across renders when its content is unchanged, so a
 * settings object rebuilt from the cascade every render doesn't defeat genericNoteEquality's
 * reference compare and make every note look changed.
 */
function useStableSettings<T extends Record<string, unknown>>(settings: T): T {
    const settings_ref = useRef(settings);
    const keys = Object.keys(settings) as Array<keyof T>;
    const prev_keys = Object.keys(settings_ref.current) as Array<keyof T>;
    const unchanged = keys.length === prev_keys.length && keys.every((key) => Object.is(settings[key], settings_ref.current[key]));
    if (!unchanged) { settings_ref.current = settings; }
    return settings_ref.current;
}

export interface ViewDisplayDeepestProps {
    selectable_level: number;
    rendered_level: number;
    note?: NoteProps;
}

export interface ViewContext {
    selection_ref: React.MutableRefObject<ViewProps['selection']>;
    display_options: NoteDisplayOptions;
    parent_context: NoteProps | undefined;
    parent_context_seq: number;
    notes_within_parent_context: Array<NoteProps>;
    deepest: ViewDisplayDeepestProps;
}

/**
 * Assembles the per-render view context: the cascaded display_options (global defaults -> ancestor
 * view props -> own props), the parent note that frames this view, the sorted set of notes visible
 * within it, and the focused/selected note derivations driven by the editor selection. display_options
 * is enriched in place (level, focused/selected seqs, caret offset) to match the documented shape
 * consumed by the concrete views.
 *
 * The editor selection is the tiebreaker throughout: an editor-derived match or range selection wins
 * whenever it resolves, and the view-driven view_focused_ids / view_selected_ids / view_caret (written
 * by the click dispatcher for immediate feedback) fill in only while the editor has no opinion. Folder
 * mode resolves both through the per-doc + source_position matchers, since the merged tree's `position`
 * is in synthetic merged-tree coordinates; current_file mode uses the in-tree position directly.
 * parent_context resolution goes through findNoteBySeq rather than notes.at(seq), since the two disagree
 * once flattenSingleFileStories has lifted stories out from under their epics. The visible note set is
 * sorted on a copy inside a memo keyed on the source array, so sorting never mutates the tree's own
 * cached child_notes or re-runs on an unrelated render.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useViewContext(props: ViewProps): ViewContext {
    // avoids a stale closure in the click handler when MarkdownNote's memo skips a selection-only re-render
    const selection_ref = useRef(props.selection);
    selection_ref.current = props.selection;
    // last-resort defaults before the first settingsCascade lands; ancestor views override in tree order
    const settings = useStableSettings({
        showLineNumbers: false,
        watchUnopenedFilesInViewer: true,
        kanbanAnimateTransitions: true,
        openNewEditorIfNoneOpen: false,
        scrollNoteIntoView: true,
        autoExpandFocusedNote: false,
        ...props.parent_view?.parent_view?.parent_view?.display_options?.settings,
        ...props.parent_view?.parent_view?.display_options?.settings,
        ...props.parent_view?.display_options?.settings,
        ...props.display_options?.settings,
    });
    const display_options: NoteDisplayOptions = {
        parent_context_seq: 0,
        ...props.display_options,
        settings,
    };
    // scope resolves via parent_context_id when persisted, else the upstream-derived parent_context_seq
    const resolved_parent_context: NoteProps | undefined = display_options?.parent_context_id
        ? resolveParentContextNote(display_options.parent_context_id, props.notes)
        : findNoteBySeq(props.notes, display_options?.parent_context_seq || 0);
    if (!resolved_parent_context && (display_options?.parent_context_seq ?? 0) !== 0) {
        debug('parent_context_seq %d resolved to no note in this parse, scoping to the root', display_options.parent_context_seq);
    }
    // an unresolvable scope lands on the document root, the same note a seq of 0 resolves to
    const unparsed_parent_context: NoteProps | undefined = resolved_parent_context ?? findNoteBySeq(props.notes, 0);
    const parent_context_seq: number = unparsed_parent_context?.seq ?? 0;
    display_options.parent_context_seq = parent_context_seq;
    // get latest updates: always take the `props` version of `note` attributes
    const parent_context = unparsed_parent_context ? {
        ...unparsed_parent_context,
    } : undefined;
    // notes visible in this view, sorted on a copy so the tree's own child_notes cache is untouched
    const source_notes: ReadonlyArray<NoteProps> = parent_context ? (parent_context.child_notes ?? NO_NOTES) : (props.notes ?? NO_NOTES);
    const notes_within_parent_context: Array<NoteProps> = useMemo(() => [...source_notes].sort(noteOrder), [source_notes]);
    display_options.level = (notes_within_parent_context.length > 0 ? notes_within_parent_context[0].level : 0);
    const deepest: ViewDisplayDeepestProps = {
        selectable_level: display_options.level + 0,
        rendered_level: display_options.level + 2,
    };
    // editor-derived caret match: folder mode needs the per-doc matcher; single-file offsets are already coherent
    const editor_derived_match: NoteProps | undefined = useMemo(() => {
        if (props.selection === undefined) { return undefined; }
        const caret_pos = props.selection?.main.head;
        if (caret_pos === undefined) { return undefined; }
        // works since caret_pos is already in the source file's offset space folder mode stamps via mergeAggregateRoot
        if (props.active_editor_doc_path) {
            const by_origin = findDeepestNoteByOriginPosition(props.notes || [], props.active_editor_doc_path, caret_pos);
            if (by_origin) { return by_origin; }
        }
        // clamps caret to the rendered root's end so a pre-reparse selection still resolves to a note
        let clamped = caret_pos;
        const root_end = props.notes?.[0]?.position?.end?.offset;
        if (root_end !== undefined && clamped > root_end) {
            clamped = root_end;
        }
        return findDeepestNote(props.notes || [], clamped);
    }, [
        props.notes,
        props.selection,
        props.active_editor_doc_path,
    ]);
    // view-driven ids from the click dispatcher fill in only when the editor-derived match has no opinion
    const view_focused_ids = display_options.view_focused_ids;
    const view_selected_ids = display_options.view_selected_ids;
    // consulted only when there is no editor selection, so the editor-open path is unchanged
    const view_caret = display_options.view_caret;
    deepest.note = useMemo(() => {
        return resolveFocusedNote(view_focused_ids, props.notes || [], editor_derived_match, view_caret) || parent_context;
    }, [
        view_focused_ids,
        parent_context,
        props.notes,
        editor_derived_match,
        view_caret,
    ]);
    if (deepest.note) {
        display_options.focused_notes = (deepest.note.parent_notes || []).concat([deepest.note]);
        display_options.focused_seqs = focusedChainFor(deepest.note);
    }
    // pass caret offset so clipped notes can scroll their body to the caret position
    display_options.caret_offset = props.selection?.main.head;
    // editor-derived range selection wins; view_selected_ids is the immediate-feedback fallback
    display_options.selected_notes = useMemo(() => {
        const selection = props.selection;
        if (selection) {
            const { head, anchor } = selection.main;
            if (head !== undefined && anchor !== undefined && head !== anchor) {
                if (props.active_editor_doc_path) {
                    return findSelectedNotesByOriginPosition(props.notes || [], props.active_editor_doc_path, head, anchor);
                }
                return findSelectedNotes(props.notes || [], selection);
            }
        }
        if (view_selected_ids?.length) {
            return (props.notes || []).filter(n => n.stable_id !== undefined && view_selected_ids.includes(n.stable_id));
        }
        return [];
    }, [
        view_selected_ids,
        props.notes,
        props.selection,
        props.active_editor_doc_path,
    ]);
    display_options.selected_seqs = display_options.selected_notes?.map((note: NoteProps) => note.seq) || [];
    return {
        selection_ref,
        display_options,
        parent_context,
        parent_context_seq,
        notes_within_parent_context,
        deepest,
    };
}

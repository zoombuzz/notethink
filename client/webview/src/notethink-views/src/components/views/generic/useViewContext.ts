import Debug from "debug";
import { useMemo, useRef } from "react";
import {
    findDeepestNote,
    findDeepestNoteByOriginPosition,
    findSelectedNotes,
    findSelectedNotesByOriginPosition,
    focusedChainFor,
    noteOrder,
    resolveFocusedNote,
} from "../../../lib/noteops";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import type { ViewProps } from "../../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:useViewContext");

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
 * Assembles the per-render view context: the cascaded display_options (global
 * defaults → ancestor view props → own props), the parent note that frames this
 * view, the sorted set of notes visible within it, and the focused/selected note
 * derivations driven by the editor selection. display_options is enriched in
 * place (level, focused/selected seqs, caret offset) to match the documented
 * shape consumed by the concrete views.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useViewContext(props: ViewProps): ViewContext {
    // ref for current selection — the click handler reads this to avoid stale closures when MarkdownNote's memo prevents re-render after a selection-only change
    const selection_ref = useRef(props.selection);
    selection_ref.current = props.selection;

    // set up all-view-level (global) default display_options, overridden by props (ViewManager state) and parent view props
    const display_options: NoteDisplayOptions = {
        parent_context_seq: 0,
        ...props.display_options,
        settings: {
            showLineNumbers: false,
            watchUnopenedFilesInViewer: true,
            showContextBars: true,
            scrollTextIntoView: true,
            scrollNoteIntoView: true,
            autoExpandFocusedNote: false,
            ...props.parent_view?.parent_view?.parent_view?.display_options?.settings,
            ...props.parent_view?.parent_view?.display_options?.settings,
            ...props.parent_view?.display_options?.settings,
            ...props.display_options?.settings,
        },
    };

    // parse parent note (often partly displayed)
    const parent_context_seq: number = display_options?.parent_context_seq || 0;
    const unparsed_parent_context: NoteProps | undefined = (props.notes || []).at(parent_context_seq);

    // get latest updates: always take the `props` version of `note` attributes
    const parent_context = unparsed_parent_context ? {
        ...unparsed_parent_context,
    } : undefined;

    // derive the set of notes visible in this view and what level notes to display
    const notes_within_parent_context: Array<NoteProps> = (parent_context ?
        parent_context.child_notes :
        (props.notes || [])
    ) as Array<NoteProps>;
    notes_within_parent_context?.sort(noteOrder);
    display_options.level = (notes_within_parent_context && notes_within_parent_context.length > 0 ? notes_within_parent_context[0].level : 0);

    const deepest: ViewDisplayDeepestProps = {
        selectable_level: display_options.level + 0,
        rendered_level: display_options.level + 2,
    };

    // editor-derived caret match: in current_file mode the trivial case (every note's origin.doc_path matches the active doc, or no origin is present and offsets are coherent) hits findDeepestNote; in folder mode the per-doc + source_position matcher is required because the merged tree's `position` lives in synthetic merged-tree coordinates
    const editor_derived_match: NoteProps | undefined = useMemo(() => {
        if (props.selection === undefined) { return undefined; }
        const caret_pos = props.selection?.main.head;
        if (caret_pos === undefined) { return undefined; }
        // per-doc + source_position matcher: works when the visible tree carries origin.doc_path + origin.source_position (folder mode stamps both during mergeAggregateRoot). Coordinate-coherent: caret_pos is in the source file's offset space, so the same value used here is what was emitted by the editor — no clamping against the merged-tree root needed
        if (props.active_editor_doc_path) {
            const by_origin = findDeepestNoteByOriginPosition(props.notes || [], props.active_editor_doc_path, caret_pos);
            if (by_origin) { return by_origin; }
        }
        /*
         * fallback: in-tree position match (current_file mode where offsets are coherent across the rendered tree)
         * clamp caret to the rendered root's end so a selection that arrived before the MDAST re-parse still resolves to a note rather than nothing
         */
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

    // per-view focused/selected stable_ids written by the click dispatcher; the editor-derived match wins when it resolves a note (the documented editor-as-tiebreaker), and these fill in only when it has no opinion — the latest-click-wins immediate-feedback bridge and fallback
    const view_focused_ids = display_options.view_focused_ids;
    const view_selected_ids = display_options.view_selected_ids;

    deepest.note = useMemo(() => {
        return resolveFocusedNote(view_focused_ids, props.notes || [], editor_derived_match) || parent_context;
    }, [
        view_focused_ids,
        parent_context,
        props.notes,
        editor_derived_match,
    ]);

    if (deepest.note) {
        display_options.focused_notes = (deepest.note.parent_notes || []).concat([deepest.note]);
        display_options.focused_seqs = focusedChainFor(deepest.note);
    }
    // pass caret offset so clipped notes can scroll their body to the caret position
    display_options.caret_offset = props.selection?.main.head;

    // find the set of notes within this view that are currently selected; editor-derived range selection wins (per-doc + source_position in folder mode; in-tree in single-file mode); view-driven view_selected_ids is the immediate-feedback source for the brief window between a view click and the editor's selectionChanged round-trip, and fills in when the editor has no range selection
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

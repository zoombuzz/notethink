import Debug from "debug";
import { useMemo, useRef } from "react";
import { findDeepestNote, findSelectedNotes, noteOrder } from "../../../lib/noteops";
import { renderMarkdownNoteHeadline } from "../../../lib/renderops";
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
    // ref for current selection - the click handler reads this to avoid stale closures
    // when MarkdownNote's memo prevents re-render after a selection-only change
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

    useMemo(() => {
        if (unparsed_parent_context) {
            return renderMarkdownNoteHeadline(unparsed_parent_context);
        }
        return undefined;
    }, [
        unparsed_parent_context?.headline_raw,
        unparsed_parent_context?.body_raw,
    ]);

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

    // look for the deepest note that the caret lies within
    deepest.note = useMemo(() => {
        if (props.selection !== undefined) {
            let caret_pos = props.selection?.main.head;
            // clamp caret to document bounds - selection may arrive before MDAST re-parse
            const root_end = props.notes?.[0]?.position?.end?.offset;
            if (caret_pos !== undefined && root_end !== undefined && caret_pos > root_end) {
                caret_pos = root_end;
            }
            return findDeepestNote(props.notes || [], caret_pos) || parent_context;
        }
        return parent_context;
    }, [
        parent_context,
        props.notes,
        props.selection,
    ]);

    if (deepest.note) {
        display_options.focused_notes = (deepest.note.parent_notes || []).concat([deepest.note]);
        display_options.focused_seqs = display_options.focused_notes.map((note: NoteProps) => note.seq);
    }
    // pass caret offset so clipped notes can scroll their body to the caret position
    display_options.caret_offset = props.selection?.main.head;

    // find the set of notes within this view that are currently selected (use full notes list so subnotes are included)
    display_options.selected_notes = useMemo(() => {
        if (props.selection?.main.head === undefined || props.selection?.main.anchor === undefined) { return []; }
        if (props.selection?.main.head === props.selection?.main.anchor) { return []; }
        return findSelectedNotes(props.notes || [], props.selection);
    }, [
        props.notes,
        props.selection
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

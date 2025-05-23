import {NoteProps} from "../../types/NoteProps";
import GenericNoteWrapper from "../../components/notes/GenericNoteWrapper";
import Debug from "debug";
import {lazy} from "react";
const debug = Debug("nextjs:app:GenericNote");

const MarkdownNote = lazy(() => import('./MarkdownNote'));
const CodeNote = lazy(() => import('./CodeNote'));

export const selectable_notetypes = ['markdown'];

export default function GenericNote(props: NoteProps) {

    const note = props;
    let deepest_selectable_note = note;
    let cropped_focused_seqs = note.display_options?.focused_seqs || [];
    let cropped_selected_seqs = note.display_options?.selected_seqs || [];
    // if this note is deeper than the deepest selectable note, and it's got parents, iterate up through the parents
    while (note.display_options?.deepest?.selectable_level !== undefined && (deepest_selectable_note.level > note.display_options?.deepest?.selectable_level) && deepest_selectable_note.parent_notes?.length) {
        // get immediate parent
        deepest_selectable_note = deepest_selectable_note.parent_notes[deepest_selectable_note.parent_notes.length - 1];
    }
    // if we did a crop, or if we're at the limit of what's selectable, restrict the focused_seqs and selected_seqs
    if (deepest_selectable_note.level === note.display_options?.deepest?.selectable_level) {
        // restrict the focused_seqs to the deepest selectable level
        cropped_focused_seqs = note.display_options?.focused_seqs?.includes(deepest_selectable_note.seq) ? note.display_options.focused_seqs.slice(0, note.display_options.focused_seqs.indexOf(deepest_selectable_note.seq) + 1) : note.display_options?.focused_seqs || [];
        // restrict the selected_seqs to the deepest selectable level
        cropped_selected_seqs = (note.display_options?.selected_notes || [])
            .filter((selected_note: NoteProps) => selected_note.level <= deepest_selectable_note.level)
            .map((selected_note: NoteProps) => selected_note.seq);
    }

    const enriched_props = {
        // calculate default focused and selected status here
        focused: cropped_focused_seqs?.length && cropped_focused_seqs.includes(note.seq),
        selected: cropped_selected_seqs?.length && cropped_selected_seqs.includes(note.seq),
        // override with props
        ...props,
        display_options: {
            ...props.display_options,
            deepest: {
                ...props.display_options?.deepest,
                selectable_note: deepest_selectable_note,
                selectable_level: props.display_options?.deepest?.selectable_level || deepest_selectable_note.level,
            },
            cropped_focused_seqs,
            cropped_selected_seqs,
        },
    };

    // conditional lazy-loading depending on type; see top-level View container in ViewRenderer
    switch (props.type) {
        case 'list':
        case 'listItem':
            return <GenericNoteWrapper type={props.type} {...enriched_props} />
        case 'code':
            switch (props.lang) {
                default:
                    return <CodeNote {...enriched_props} />;
            }
    }
    return <MarkdownNote {...enriched_props} />;
}

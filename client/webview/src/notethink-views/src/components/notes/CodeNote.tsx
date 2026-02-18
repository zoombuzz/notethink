import {MouseEvent} from "react";
import {NoteProps} from "../../types/NoteProps";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import Debug from 'debug';
import view_specific_styles from "../../components/ViewRenderer.module.scss";
const debug = Debug("notethink-views:CodeNote");

export default function CodeNote(props: NoteProps) {
    const note = props;

    // generate array of CSS classes that apply to this note
    const note_styles = [view_specific_styles.note];
    note.focused && note_styles.push(view_specific_styles.focused);
    note.selected && note_styles.push(view_specific_styles.selected);
    note.display_options?.settings?.show_line_numbers && note_styles.push(view_specific_styles.addGutter);

    // render note
    return (
        <div className={note_styles.join(' ')}
             id={note.display_options?.id}
             data-seq={note.seq}
             data-mdast-type={note.type}
             data-start={note.position.start.offset} data-end={note.position.end.offset}
             data-updated={note.updated} data-updated-by-view={note.updated_by_view}
             // passed-on inherited props (such as draggable)
             {...props.display_options?.provided?.draggableProps}
             {...props.display_options?.provided?.dragHandleProps}
             ref={props.display_options?.provided?.innerRef}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
        >
            { note?.linetags && <GenericNoteAttributes
                {...note}
            /> }
            <div className={view_specific_styles.body}
                 onClick={ (event: MouseEvent<HTMLElement>) => { note.handlers?.click?.(event, props.display_options?.deepest?.selectable_note, {
                     from: note.position.end.offset,
                     to: note.position.end_body?.offset,
                     selection_from: props.display_options?.deepest?.selectable_note?.position?.start?.offset,
                     selection_to: props.display_options?.deepest?.selectable_note?.position?.end?.offset,
                     type: 'note_body',
                 }); }}
            >
                {note.body_raw}
            </div>
        </div>
    );
}

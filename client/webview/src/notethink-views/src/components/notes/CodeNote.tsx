import {NoteProps} from "../../types/NoteProps";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import { buildNoteStyles, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import Debug from 'debug';
import view_specific_styles from "../../components/ViewRenderer.module.scss";
const debug = Debug("nodejs:notethink-views:CodeNote");

export default function CodeNote(props: NoteProps) {
    const note = props;

    // render note
    return (
        <div className={buildNoteStyles(note).join(' ')}
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
                 onClick={createNoteClickHandler(note, bodyClickPosition(note))}
            >
                {note.body_raw}
            </div>
        </div>
    );
}

import {NoteProps} from "../../types/NoteProps";
import {getStandardNoteDataProps, renderBodyItems} from "../../lib/renderops";

export default function GenericNoteWrapper(props: NoteProps) {
    const note = props;
    const data_props = getStandardNoteDataProps(note);

    // render note wrapper
    switch (note.type) {
        case 'list':
            return <ul id={note.display_options?.id} {...data_props}>{renderBodyItems(note, note.children_body)}</ul>;
        case 'listItem':
            return <li id={note.display_options?.id} {...data_props}>{renderBodyItems(note, note.children_body, { checked: note.checked })}</li>;
    }
}

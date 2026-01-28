import {MdastNode, NoteProps} from "../../types/NoteProps";
import {getStandardNoteDataProps, renderNodeUnified} from "../../lib/renderops";
import GenericNote from "../../components/notes/GenericNote";
import Debug from 'debug';

const debug = Debug("nextjs:app:GenericNoteWrapper");

/**
 * Render note body
 * @param note
 * @param additional_props - additional props to pass to the child notes
 * There are certain cases where the parent note influences the rendering of the child notes
 * e.g. listItems with checkboxes
 */
function renderBody(note: NoteProps, additional_props: any = {}) {
    return note.children_body.map((child: MdastNode | NoteProps) => {
        if ('seq' in child && child.seq !== undefined) {
            return <GenericNote
                key={child.seq}
                {...child}
                {...additional_props}
            />;
        } else {
            return renderNodeUnified(child);
        }
    });
}

export default function GenericNoteWrapper(props: NoteProps) {
    const note = props;
    const data_props = getStandardNoteDataProps(note);

    // render note wrapper
    switch (note.type) {
        case 'list':
            return <ul {...data_props}>{renderBody(note)}</ul>;
        case 'listItem':
            return <li {...data_props}>{renderBody(note, { checked: note.checked })}</li>;
    }
}

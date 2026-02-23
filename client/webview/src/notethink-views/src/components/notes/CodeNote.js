import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import { buildNoteStyles, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import Debug from 'debug';
import view_specific_styles from "../../components/ViewRenderer.module.scss";
const debug = Debug("nodejs:notethink-views:CodeNote");
export default function CodeNote(props) {
    const note = props;
    // render note
    return (_jsxs("div", { className: buildNoteStyles(note).join(' '), id: note.display_options?.id, "data-seq": note.seq, "data-mdast-type": note.type, "data-start": note.position.start.offset, "data-end": note.position.end.offset, "data-updated": note.updated, "data-updated-by-view": note.updated_by_view, ...props.display_options?.provided?.draggableProps, ...props.display_options?.provided?.dragHandleProps, ref: props.display_options?.provided?.innerRef, role: 'row', "aria-current": note.focused, "aria-selected": note.selected, children: [note?.linetags && _jsx(GenericNoteAttributes, { ...note }), _jsx("div", { className: view_specific_styles.body, onClick: createNoteClickHandler(note, bodyClickPosition(note)), children: note.body_raw })] }));
}

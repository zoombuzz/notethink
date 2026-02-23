import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Debug from 'debug';
import { getStandardNoteDataProps } from "../../lib/renderops";
import { buildNoteStyles, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import GenericNoteAttributes from "./GenericNoteAttributes";
import { MermaidDiagram } from "./MermaidDiagram";
import view_specific_styles from "../ViewRenderer.module.scss";
import note_specific_styles from "./MermaidNote.module.scss";
const debug = Debug("nodejs:notethink-views:MermaidNote");
const MERMAID_CLASS_NAME = 'mermaid';
const MAX_ERROR_CHARS = 200;
function deriveDiagramType(input) {
    const fallback_default = 'graph';
    const matches = input.match(new RegExp('([^`\\s]+)'));
    return (matches?.length ? matches[0] : fallback_default);
}
export default function MermaidNote(props) {
    const note = props;
    const data_props = getStandardNoteDataProps(note);
    const diagram_text = note.body_raw;
    const type = deriveDiagramType(diagram_text);
    const classes = [view_specific_styles.body, note_specific_styles.noteMermaid, MERMAID_CLASS_NAME, note_specific_styles[`type_${type}`]];
    return (_jsxs("div", { className: buildNoteStyles(note).join(' '), id: note.display_options?.id, ...data_props, ...props.display_options?.provided?.draggableProps, ...props.display_options?.provided?.dragHandleProps, ref: props.display_options?.provided?.innerRef, role: 'row', "aria-current": note.focused, "aria-selected": note.selected, children: [note?.linetags && _jsx(GenericNoteAttributes, { ...note }), _jsx(MermaidDiagram, { className: classes.join(' '), onError: (e) => {
                    const reportable_error = e instanceof Error ? e.message : (typeof e === 'string' ? e.substring(0, MAX_ERROR_CHARS) : String(e));
                    debug("Mermaid processing error (non-fatal)", reportable_error);
                }, onClick: createNoteClickHandler(note, bodyClickPosition(note)), children: note.body_raw })] }));
}

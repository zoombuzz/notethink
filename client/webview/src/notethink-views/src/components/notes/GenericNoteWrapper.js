import { jsx as _jsx } from "react/jsx-runtime";
import { getStandardNoteDataProps, renderNodeUnified } from "../../lib/renderops";
import GenericNote from "../../components/notes/GenericNote";
import Debug from 'debug';
const debug = Debug("nodejs:notethink-views:GenericNoteWrapper");
/**
 * Render note body
 * @param note
 * @param additional_props - additional props to pass to the child notes
 * There are certain cases where the parent note influences the rendering of the child notes
 * e.g. listItems with checkboxes
 */
function renderBody(note, additional_props = {}) {
    return note.children_body.map((child) => {
        if ('seq' in child && child.seq !== undefined) {
            return _jsx(GenericNote, { ...child, ...additional_props }, child.seq);
        }
        else {
            return renderNodeUnified(child);
        }
    });
}
export default function GenericNoteWrapper(props) {
    const note = props;
    const data_props = getStandardNoteDataProps(note);
    // render note wrapper
    switch (note.type) {
        case 'list':
            return _jsx("ul", { ...data_props, children: renderBody(note) });
        case 'listItem':
            return _jsx("li", { ...data_props, children: renderBody(note, { checked: note.checked }) });
    }
}

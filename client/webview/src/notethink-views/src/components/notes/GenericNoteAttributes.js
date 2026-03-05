import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import view_specialised_styles from "../../components/ViewRenderer.module.scss";
import { isInternalAttribute } from "../../lib/renderops";
const hiddenAttributes = [
    'progress_unit', 'progress_max',
    'kanban_ordering_weight',
];
export default function GenericNoteAttributes(props) {
    const note = props;
    const linetags = note.linetags || {};
    // render attributes, one at a time
    return (_jsx("ul", { className: view_specialised_styles.linetags, role: 'list', children: Object.keys(linetags).map((attrib_key, index) => {
            // don't show attributes already manually rendered
            if (hiddenAttributes.includes(attrib_key)) {
                return;
            }
            // don't show internal attributes
            if (isInternalAttribute(attrib_key)) {
                return;
            }
            // pull out the current value (dynamic typing)
            const linetag = linetags[attrib_key];
            // allow for custom formatting of identified linetags
            let attrib_value;
            switch (attrib_key) {
                case 'progress':
                    attrib_value = (linetags?.progress_max.value_numeric && linetag.value_numeric ? (Math.round(linetag.value_numeric * 100 / linetags?.progress_max.value_numeric)) : linetag.value) + linetags?.progress_unit.value;
                    break;
                default:
                    // but default to just show value
                    attrib_value = linetag.value;
                    break;
            }
            const linetags_from_position = note.linetags_from || 0;
            return (_jsxs("li", { role: 'listitem', "aria-label": attrib_key, className: view_specialised_styles.linetag, "data-updated": linetag.updated, "data-updated-by-view": linetag.updated_by_view, "data-value-previous": linetag.value_previous, children: [_jsxs("span", { className: view_specialised_styles.key, onClick: (event) => {
                            props.handlers?.click?.(event, note, {
                                from: (note.linetags_from || 0) + linetag.key_offset,
                                to: (note.linetags_from || 0) + linetag.key_offset + linetag.key.length,
                                selection_from: note.position.start.offset,
                                selection_to: note.position.end.offset,
                                type: 'linetag',
                            });
                        }, children: [attrib_key, ":"] }), _jsx("span", { className: view_specialised_styles.value, onClick: (event) => {
                            props.handlers?.click?.(event, note, {
                                from: linetags_from_position + linetag.value_offset,
                                to: linetags_from_position + linetag.value_offset + linetag.value.length,
                                selection_from: note.position.start.offset,
                                selection_to: note.position.end.offset,
                                type: 'linetag',
                            });
                        }, children: attrib_value })] }, index));
        }) }));
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import view_specific_styles from "../ViewRenderer.module.scss";
export default function KanbanColumn(props) {
    const note_styles = [view_specific_styles.column];
    if (props.type) {
        note_styles.push(view_specific_styles.pseudo);
    }
    if (props.display_options?.draglight) {
        note_styles.push(view_specific_styles.draglight);
    }
    const percentage_width = props.display_options?.total_columns ? 100 / props.display_options?.total_columns : 100;
    return (_jsxs("div", { className: note_styles.join(' '), role: 'region', "aria-label": props.value, style: { width: `calc(${percentage_width}% - 0.5em)` }, ...props.display_options?.provided?.droppableProps, ref: props.display_options?.provided?.innerRef, children: [_jsx("div", { className: view_specific_styles.heading, role: 'columnheader', children: _jsx("h3", { children: props.value }) }), _jsx("div", { className: view_specific_styles.notes, children: props.children })] }));
}

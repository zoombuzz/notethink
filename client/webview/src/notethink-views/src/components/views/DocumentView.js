import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import master_view_styles from "../../components/ViewRenderer.module.scss";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import Debug from 'debug';
import DocumentContextBar from "../../components/views/DocumentContextBar";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import GenericNote from "../../components/notes/GenericNote";
const debug = Debug("nodejs:notethink-views:DocumentView");
export default React.memo(function DocumentView(props) {
    // set up view-level default display_options, overridden by props
    const display_options = Object.assign({}, props.display_options);
    const renderNote = (note, index) => (_jsx(GenericNote, { ...note, display_options: buildChildNoteDisplayOptions(display_options, note, props), selection: props.selection, handlers: {
            click: props.handlers?.click,
            setCaretPosition: props.handlers?.setCaretPosition,
        } }, index));
    const container_styles = [view_specific_styles.viewDocument, master_view_styles.content];
    return (_jsx(_Fragment, { children: _jsxs("div", { className: container_styles.join(' '), id: `v${props.id}-inner`, "data-testid": `document-${props.id}-inner`, "data-level": display_options.level, "data-parent-content-seq": display_options.parent_context_seq, children: [display_options.settings?.show_context_bars && _jsx(DocumentContextBar, { ...props }), _jsxs("div", { className: view_specific_styles.centredPane, children: [props.nested?.parent_context?.linetags && _jsx(GenericNoteAttributes, { ...props.nested?.parent_context }), props.nested?.parent_context && renderNote(props.nested?.parent_context, 0)] })] }) }));
});

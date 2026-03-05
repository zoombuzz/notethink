import React, { useMemo } from 'react';
import master_view_styles from "../../components/ViewRenderer.module.scss";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import {ViewProps} from "../../types/ViewProps";
import {NoteProps} from "../../types/NoteProps";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import Debug from 'debug';
import DocumentContextBar from "../../components/views/DocumentContextBar";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import GenericNote from "../../components/notes/GenericNote";

const debug = Debug("nodejs:notethink-views:DocumentView");

export default React.memo(function DocumentView(props: ViewProps) {

    // set up view-level default display_options, overridden by props
    const display_options = Object.assign({
    }, props.display_options);

    // Stabilise handlers reference to avoid unnecessary child re-renders
    const note_handlers = useMemo(() => ({
        click: props.handlers?.click,
        setCaretPosition: props.handlers?.setCaretPosition,
    }), [props.handlers?.click, props.handlers?.setCaretPosition]);

    const renderNote = (note: NoteProps, index: number) => (
        <GenericNote
            key={index}
            {...note}
            display_options={buildChildNoteDisplayOptions(display_options, note, props)}
            selection={props.selection}
            handlers={note_handlers}
        />
    );

    const container_styles: Array<string> = [view_specific_styles.viewDocument, master_view_styles.content];

    return (
        <>
            <div className={container_styles.join(' ')}
                 id={`v${props.id}-inner`}
                 data-testid={`document-${props.id}-inner`}
                 data-level={display_options.level}
                 data-parent-content-seq={display_options.parent_context_seq}
            >
                {display_options.settings?.show_context_bars && <DocumentContextBar {...props} />}
                <div className={view_specific_styles.centredPane}>
                    {props.nested?.parent_context?.linetags && <GenericNoteAttributes
                        {...props.nested?.parent_context}
                    />}
                    {props.nested?.parent_context && renderNote(props.nested?.parent_context, 0)}
                    {/*{(props.notes_within_parent_context || []).map(render_note)}*/}
                </div>
            </div>
        </>
    );
});

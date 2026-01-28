import master_view_styles from "@/components/ViewRenderer.module.scss"
import view_specific_styles from "@/components/ViewRenderer.module.scss"
import {ViewProps} from "../../types/ViewProps";
import {NoteProps} from "../../types/NoteProps";
import Debug from 'debug';
import DocumentContextBar from "../../components/views/DocumentContextBar";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import GenericNote from "../../components/notes/GenericNote";

const debug = Debug("notethink-views:DocumentView");

export default function DocumentView(props: ViewProps) {

    // set up view-level default display_options, overridden by props
    const display_options = Object.assign({
    }, props.display_options);

    const renderNote = (note: NoteProps, index: number) => (
        <GenericNote
            key={index}
            {...note}
            display_options={{
                ...display_options,
                ...note?.display_options,
                view_id: props.id,
                id: `v${props.id}-n${note.seq}`,
                deepest: {
                    ...props.display_options?.deepest,
                    ...note?.display_options?.deepest,
                    // override selectable_level to allow us to select nested notes
                    selectable_level: note.level + 1
                }
            }}
            selection={props.selection}
            handlers={{
                click: props.handlers?.click,
                setCaretPosition: props.handlers?.setCaretPosition,
            }}
        />
    );

    const container_styles: Array<string> = [view_specific_styles.viewDocument, master_view_styles.content];

    return (
        <>
            <div className={master_view_styles.menubar}>
                {props.nested?.menus && renderMenusForThisView(props)}
            </div>
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
}

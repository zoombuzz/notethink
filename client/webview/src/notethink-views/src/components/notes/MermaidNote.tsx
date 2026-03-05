import Debug from 'debug';
import type { NoteProps } from "../../types/NoteProps";
import { getStandardNoteDataProps } from "../../lib/renderops";
import { buildNoteStyles, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import GenericNoteAttributes from "./GenericNoteAttributes";
import { MermaidDiagram } from "./MermaidDiagram";
import view_specific_styles from "../ViewRenderer.module.scss";
import note_specific_styles from "./MermaidNote.module.scss";

const debug = Debug("nodejs:notethink-views:MermaidNote");
const MERMAID_CLASS_NAME = 'mermaid';
const MAX_ERROR_CHARS = 200;

function deriveDiagramType(input: string): string {
    const fallback_default = 'graph';
    const matches = input.match(new RegExp('([^`\\s]+)'));
    return (matches?.length ? matches[0] : fallback_default);
}

export default function MermaidNote(props: NoteProps) {
    const note = props;
    const data_props = getStandardNoteDataProps(note);

    const diagram_text = note.body_raw;
    const type = deriveDiagramType(diagram_text);
    const classes = [view_specific_styles.body, note_specific_styles.noteMermaid, MERMAID_CLASS_NAME, note_specific_styles[`type_${type}`]];

    return (
        <div className={buildNoteStyles(note).join(' ')}
             id={note.display_options?.id}
             {...data_props}
             {...props.display_options?.provided?.draggableProps}
             {...props.display_options?.provided?.dragHandleProps}
             ref={props.display_options?.provided?.innerRef as ((instance: HTMLDivElement | null) => void) | undefined}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
        >
            {note?.linetags && <GenericNoteAttributes
                {...note}
            />}
            <MermaidDiagram
                className={classes.join(' ')}
                onError={(e: unknown) => {
                    const reportable_error = e instanceof Error ? e.message : (typeof e === 'string' ? e.substring(0, MAX_ERROR_CHARS) : String(e));
                    debug("Mermaid processing error (non-fatal)", reportable_error);
                }}
                onClick={createNoteClickHandler(note, bodyClickPosition(note))}
            >
                {note.body_raw}
            </MermaidDiagram>
        </div>
    );
}

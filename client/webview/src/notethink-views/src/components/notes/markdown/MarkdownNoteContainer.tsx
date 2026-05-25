import Debug from "debug";
import type { ReactElement, ReactNode } from "react";
import { getStandardNoteDataProps } from "../../../lib/renderops";
import { buildNoteStyles } from "../../../lib/noteui";
import type { NoteProps } from "../../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:MarkdownNoteContainer");

interface MarkdownNoteContainerProps {
    note: NoteProps;
    set_refs: (el: HTMLDivElement | null) => void;
    children: ReactNode;
}

/**
 * render-only outer wrapper for a MarkdownNote: the note class string,
 * standard data props, debug data-* attributes, drag-and-drop spread
 * (draggableProps / dragHandleProps / style), and ARIA roles.
 *
 * State-less. The set_refs callback comes from the parent so the parent can
 * tee the same DOM node into both its measurement ref and the dnd library's
 * innerRef.
 */
export default function MarkdownNoteContainer(props: MarkdownNoteContainerProps): ReactElement {
    const { note, set_refs, children } = props;
    const provided = note.display_options?.provided;
    return (
        <div className={buildNoteStyles(note, note.display_options?.additional_classes).join(' ')}
             id={note.display_options?.id}
             {...getStandardNoteDataProps(note)}
             /* debugging support */
             data-level={note.level}
             data-deepest-selectable-level={note.display_options?.deepest?.selectable_level}
             data-deepest-selectable-note-level={note.display_options?.deepest?.selectable_note?.level}
             data-focused-seqs={note.display_options?.focused_seqs?.join(',')}
             data-cropped-focused-seqs={note.display_options?.cropped_focused_seqs?.join(',')}
             data-selected-seqs={note.display_options?.selected_seqs?.join(',')}
             data-cropped-selected-seqs={note.display_options?.cropped_selected_seqs?.join(',')}
             // passed-on inherited props (such as draggable)
             {...provided?.draggableProps}
             {...provided?.dragHandleProps}
             ref={set_refs}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
             style={provided?.draggableProps?.style as React.CSSProperties | undefined}
        >
            {children}
        </div>
    );
}

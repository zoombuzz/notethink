import Debug from "debug";
import type { ReactElement } from "react";
import { isInternalAttribute } from "../../../lib/renderops";
import { headlineClickPosition, createNoteClickHandler } from "../../../lib/noteui";
import type { NoteProps } from "../../../types/NoteProps";
import OriginPill from "../../../components/notes/OriginPill";
import view_specific_styles from "../../../components/ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:MarkdownNoteHeadline");

interface MarkdownNoteHeadlineProps {
    note: NoteProps;
}

/**
 * render-only headline row: optional line number badge, optional origin pill,
 * the rendered headline content, and inline linetag badges when
 * show_linetags_in_headlines is enabled.
 *
 * State-less: all inputs come from the note prop. The click handler is built
 * via createNoteClickHandler so the same selection-mutation pathway used by
 * the rest of the note tree is preserved.
 */
export default function MarkdownNoteHeadline(props: MarkdownNoteHeadlineProps): ReactElement {
    const { note } = props;
    const show_lineno = note.display_options?.settings?.show_line_numbers
        && note.level === note.display_options?.deepest?.selectable_level;
    const show_origin = note.origin && note.level === 1;
    const show_inline_linetags = note.display_options?.settings?.show_linetags_in_headlines && note.linetags;
    return (
        <div className={view_specific_styles.headline}
             role={'rowheader'}
             data-offset-start={note.position.start.offset}
             data-offset-end={note.position.end.offset}
             onClick={createNoteClickHandler(note, headlineClickPosition(note))}
        >
            {show_lineno && (<span className={view_specific_styles.lineno}><span>{note.position.start.line}</span></span>)}
            {show_origin && (
                <OriginPill
                    origin={note.origin!}
                    onClick={(event) => {
                        event.stopPropagation();
                        note.handlers?.postMessage?.({
                            type: 'revealRange',
                            from: note.position.start.offset,
                            docPath: note.origin!.doc_path,
                        });
                    }}
                />
            )}
            {note.headline}
            {show_inline_linetags && Object.entries(note.linetags!)
                .filter(([key]) => !isInternalAttribute(key))
                .map(([key, tag]) => (
                    <span key={key} className={view_specific_styles.linetagInline}>{key}={tag.value}</span>
                ))
            }
        </div>
    );
}

import Debug from "debug";
import type { ReactElement } from "react";
import { isInternalAttribute } from "../../../lib/renderops";
import { headlineClickPosition, createNoteClickHandler } from "../../../lib/noteui";
import type { NoteProps } from "../../../types/NoteProps";
import OriginPill from "../../../components/notes/OriginPill";
import { projectFolderFromOrigin } from "../../../lib/originops";
import view_specific_styles from "../../../components/ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:MarkdownNoteHeadline");

interface MarkdownNoteHeadlineProps {
    note: NoteProps;
}

/**
 * render-only headline row: optional line number badge, optional origin pill,
 * the rendered headline content, and inline linetag badges when
 * showLinetagsInHeadlines is enabled.
 *
 * State-less: all inputs come from the note prop. The click handler is built
 * via createNoteClickHandler so the same selection-mutation pathway used by
 * the rest of the note tree is preserved.
 *
 * The synthetic root container renders no headline row at all - empty rowheader
 * elements would otherwise be picked up by `[role="rowheader"]` selectors as
 * zero-height non-visible matches.
 */
export default function MarkdownNoteHeadline(props: MarkdownNoteHeadlineProps): ReactElement | null {
    const { note } = props;
    if (note.type === 'root') { return null; }
    const show_lineno = note.display_options?.settings?.showLineNumbers
        && note.level === note.display_options?.deepest?.selectable_level;
    const show_origin = note.origin && note.level === 1;
    const show_inline_linetags = note.display_options?.settings?.showLinetagsInHeadlines && note.linetags;
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
                        // pill click is ADDITIVE on top of the headline click: it descends the folder view into the pill's project subfolder, AND the bubbling click also fires the headline's createNoteClickHandler so the editor opens the story at its position and the matching note gets highlighted (editor-derived match in useViewContext finds the story by origin.doc_path + source_position in the descended view, even though seq numbers are renumbered by mergeAggregateRoot). A file living directly at the workspace-folder root has no sub-project to descend into - projectFolderFromOrigin returns '' and the descend becomes a no-op, but the headline click still fires
                        const target_folder = projectFolderFromOrigin(note.origin!);
                        if (target_folder) {
                            note.handlers?.descendToFolder?.(target_folder);
                        }
                        // intentionally do NOT stopPropagation: let the click bubble to the headline so the note-click handler fires alongside the descend
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

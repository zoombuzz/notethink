import type { ReactElement } from "react";
import { isInternalAttribute } from "../../../lib/renderops";
import { headlineClickPosition, createNoteClickHandler } from "../../../lib/noteui";
import type { NoteProps } from "../../../types/NoteProps";
import OriginPill from "../../../components/notes/OriginPill";
import { originHasProject, projectFolderFromOrigin } from "../../../lib/originops";
import view_specific_styles from "../../../components/ViewRenderer.module.scss";

interface MarkdownNoteHeadlineProps {
    note: NoteProps;
}

/**
 * Render-only headline row: optional line number badge, optional origin pill, headline content,
 * and inline linetag badges when showLinetagsInHeadlines is enabled. Stateless; the click
 * handler goes through createNoteClickHandler to share the note tree's selection-mutation
 * pathway. Renders nothing for the root note, since an empty rowheader would still match
 * `[role="rowheader"]` selectors as a zero-height, non-visible hit.
 */
export default function MarkdownNoteHeadline(props: MarkdownNoteHeadlineProps): ReactElement | null {
    const { note } = props;
    if (note.type === 'root') { return null; }
    const show_lineno = note.display_options?.settings?.showLineNumbers
        && note.level === note.display_options?.deepest?.selectable_level;
    // renders the pill only when there's something to show, so a single-file story with no epic shows none
    const has_project = originHasProject(note.origin);
    const show_origin = !!note.origin && note.level === 1 && (has_project || !!note.origin.epic);
    const show_inline_linetags = note.display_options?.settings?.showLinetagsInHeadlines && note.linetags;
    return (
        <div className={view_specific_styles.headline}
             role={'rowheader'}
             data-offset-start={note.position.start.offset}
             data-offset-end={note.position.end.offset}
             onClick={createNoteClickHandler(note, headlineClickPosition(note))}
        >
            {show_lineno && (<span className={view_specific_styles.lineno} data-testid="note-lineno"><span>{note.position.start.line}</span></span>)}
            {show_origin && (
                <OriginPill
                    origin={note.origin!}
                    epicOnly={!has_project}
                    onClick={() => {
                        // additive to the headline click: descends into the project subfolder, matched by doc_path+position, not seq
                        const target_folder = projectFolderFromOrigin(note.origin!);
                        if (target_folder) {
                            note.handlers?.descendToFolder?.(target_folder);
                        }
                        // no stopPropagation: the click bubbles to the headline so its note-click handler fires too
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

import { useMemo } from "react";
import type { ReactElement } from "react";
import { getStandardNoteDataProps, renderMarkdownNoteHeadline } from "../../lib/renderops";
import { buildNoteStyles } from "../../lib/noteui";
import { hueForOrigin, originHasProject } from "../../lib/originops";
import type { NoteProps } from "../../types/NoteProps";
import MarkdownNoteHeadline from "./markdown/MarkdownNoteHeadline";
import sticky_styles from "./StickyNote.module.scss";

// the hue of a sticky with no project to take its colour from: a paper yellow
export const STICKY_FALLBACK_HUE = 52;

/**
 * StickyNote, the sticky card: the origin pill and the title on a square of paper with its bottom-right
 * corner curled over, and nothing beneath them. It is the second entry on the card axis, chosen
 * independently of the view, so a lane of stickies and a document of stickies are the same card in two
 * layouts. Deliberately absent, relative to MarkdownNote: the linetag attribute row, the body, the
 * clip/overflow measurement and its Show more / Show less bars. With no body there is nothing to clip,
 * which is why none of that machinery is reached for here.
 *
 * The paper takes its project's hue through hueForOrigin, the same source the project pill draws from,
 * so a sticky and the pill on it always agree; a note with no project link, judged by the same
 * originHasProject test the headline uses to decide whether to draw a pill, is yellow. The hue rides in
 * as the --nt-sticky-hue custom property and the stylesheet turns it into paper for the current theme,
 * so a theme switch needs no re-render.
 *
 * The headline sits inside an inner wrapper rather than directly under the card. The lane layouts in
 * ViewRenderer.module.scss style `.note > .headline` as a direct child, giving it the padding and the
 * divider rule that separate a headline from the body below it; a sticky has no body, so that chrome
 * would leave a title floating above a line dividing nothing. Nesting one level takes the card out of
 * that direct-child rule, and the wrapper is also where the paper is drawn, keeping the card element
 * itself free to carry the focus ring.
 */
export default function StickyNote(props: NoteProps): ReactElement {
    const note_props = props;
    const provided = note_props.display_options?.provided;
    // the full card's headline parse, memoised on the same text, checkbox state and linetag start
    const memoized_headline = useMemo(() => {
        return renderMarkdownNoteHeadline(note_props, {
            render: 'strip_linetags',
            linetags_from: note_props.linetags_from,
        });
    }, [
        note_props.headline_raw,
        note_props.checked,
        note_props.linetags_from,
    ]);
    // take the props version of every attribute, because the memoized headline only augments the note
    const note: NoteProps = {
        headline: memoized_headline,
        ...note_props,
    };
    const sticky_hue = originHasProject(note.origin) ? hueForOrigin(note.origin) : STICKY_FALLBACK_HUE;
    // the drag style, which may already carry the board's --nt-card-width, plus the paper's hue; React's style type names no custom properties, so it goes in untyped
    const card_style: Record<string, unknown> = { ...(provided?.draggableProps?.style as Record<string, unknown> | undefined), '--nt-sticky-hue': sticky_hue };
    return (
        <div className={buildNoteStyles(note, [sticky_styles.stickyNote, ...(note.display_options?.additional_classes ?? [])]).join(' ')}
             id={note.display_options?.id}
             {...getStandardNoteDataProps(note)}
             data-card-type={'sticky'}
             data-sticky-hue={sticky_hue}
             data-level={note.level}
             // passed-on inherited props (such as draggable)
             {...provided?.draggableProps}
             {...provided?.dragHandleProps}
             ref={provided?.innerRef}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
             style={card_style as React.CSSProperties}
        >
            <div className={sticky_styles.stickyInner}>
                <MarkdownNoteHeadline note={note} />
            </div>
        </div>
    );
}

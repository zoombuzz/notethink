import { useMemo } from "react";
import type { ReactElement } from "react";
import { getStandardNoteDataProps, renderMarkdownNoteHeadline } from "../../lib/renderops";
import { buildNoteStyles } from "../../lib/noteui";
import type { NoteProps } from "../../types/NoteProps";
import MarkdownNoteHeadline from "./markdown/MarkdownNoteHeadline";
import sticky_styles from "./StickyNote.module.scss";

/**
 * StickyNote, the compact card: the origin pill and the title, and nothing beneath them. It is the
 * second entry on the card axis, chosen independently of the view, so a lane of stickies and a document
 * of stickies are the same card in two layouts. Deliberately absent, relative to MarkdownNote: the
 * linetag attribute row, the body, the clip/overflow measurement and its Show more / Show less bars.
 * With no body there is nothing to clip, which is why none of that machinery is reached for here.
 *
 * The headline sits inside an inner wrapper rather than directly under the card. The lane layouts in
 * ViewRenderer.module.scss style `.note > .headline` as a direct child, giving it the padding and the
 * divider rule that separate a headline from the body below it; a compact card has no body, so that
 * chrome would leave a title floating above a line dividing nothing. Nesting one level takes the card
 * out of that direct-child rule and lets this module set its own tighter geometry instead.
 */
export default function StickyNote(props: NoteProps): ReactElement {
    const note_props = props;
    const provided = note_props.display_options?.provided;

    // same parse as the full card's headline, memoised on the same inputs: the raw text, its checkbox state, and where its linetags start
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

    return (
        <div className={buildNoteStyles(note, note.display_options?.additional_classes).join(' ')}
             id={note.display_options?.id}
             {...getStandardNoteDataProps(note)}
             data-card-type={'sticky'}
             data-level={note.level}
             // passed-on inherited props (such as draggable)
             {...provided?.draggableProps}
             {...provided?.dragHandleProps}
             ref={provided?.innerRef}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
             style={provided?.draggableProps?.style as React.CSSProperties | undefined}
        >
            <div className={sticky_styles.stickyInner}>
                <MarkdownNoteHeadline note={note} />
            </div>
        </div>
    );
}

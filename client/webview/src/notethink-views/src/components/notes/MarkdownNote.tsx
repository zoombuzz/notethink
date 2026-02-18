import {Fragment, MouseEvent, useMemo} from "react";
import {MdastNode, NoteProps} from "../../types/NoteProps";
import {
    getStandardNoteDataProps,
    renderMarkdownNoteHeadline,
    renderNodeUnified
} from "../../lib/renderops";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import GenericNote from "../../components/notes/GenericNote";
import Debug from 'debug';
const debug = Debug("notethink-views:MarkdownNote");

export default function MarkdownNote(props: NoteProps) {
    // parse note and memoize at component level to limit the string and markdown parsing (heavy lifting)
    const memoized_headline = useMemo(() => {
        return renderMarkdownNoteHeadline(props, {
            render: props.display_options?.settings?.show_linetags_in_headlines ? 'all_children' : 'first_child_only',
        });
    }, [
        props.headline_raw,
        props.checked, props.display_options?.settings?.show_linetags_in_headlines
    ]);
    // get latest updates: always take the `props` version of `note` attributes, because memoized `parseNote` is only augmenting
    const note: NoteProps = {
        headline: memoized_headline,
        ...props
    };

    // generate array of CSS classes that apply to this note
    const note_styles = [view_specific_styles.note].concat(note.display_options?.additional_classes || []);
    note.focused && note_styles.push(view_specific_styles.focused);
    note.selected && note_styles.push(view_specific_styles.selected);
    note.display_options?.settings?.show_line_numbers && note_styles.push(view_specific_styles.addGutter);

    // render note
    return (
        <div className={note_styles.join(' ')}
             id={note.display_options?.id}
             {...getStandardNoteDataProps(note)}
             /**
              * debugging support
              */
             data-level={note.level}
             data-deepest-selectable-level={note.display_options?.deepest?.selectable_level}
             data-deepest-selectable-note-level={note.display_options?.deepest?.selectable_note?.level}
             data-focused-seqs={note.display_options?.focused_seqs?.join(',')}
             data-cropped-focused-seqs={note.display_options?.cropped_focused_seqs?.join(',')}
             data-selected-seqs={note.display_options?.selected_seqs?.join(',')}
             data-cropped-selected-seqs={note.display_options?.cropped_selected_seqs?.join(',')}
             // passed-on inherited props (such as draggable)
             {...props.display_options?.provided?.draggableProps}
             {...props.display_options?.provided?.dragHandleProps}
             ref={props.display_options?.provided?.innerRef}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
        >
            <div className={view_specific_styles.headline}
                 role={'rowheader'}
                 onClick={ (event: MouseEvent<HTMLElement>) => { note.handlers?.click?.(event, note.display_options?.deepest?.selectable_note, {
                     from: note.position.start.offset,
                     to: note.position.end.offset,
                     selection_from: note.display_options?.deepest?.selectable_note?.position?.start?.offset,
                     selection_to: note.display_options?.deepest?.selectable_note?.position?.end_body?.offset || note.display_options?.deepest?.selectable_note?.position?.end?.offset,
                     type: 'note_headline',
                 }); }}
            >
                {note.display_options?.settings?.show_line_numbers && (<span className={view_specific_styles.lineno}><span>{note.position.start.line}</span></span>)}
                {note.headline}
            </div>
            { note.linetags && <GenericNoteAttributes
                {...note}
            /> }
            { note.children_body?.length ?
            <div className={view_specific_styles.body}
                 onClick={ (event: MouseEvent<HTMLElement>) => { note.handlers?.click?.(event, note.display_options?.deepest?.selectable_note, {
                     from: note.position.end.offset,
                     to: note.position.end_body?.offset,
                     selection_from: note.display_options?.deepest?.selectable_note?.position?.start?.offset,
                     selection_to: note.display_options?.deepest?.selectable_note?.position?.end_body?.offset || note.display_options?.deepest?.selectable_note?.position?.end?.offset,
                     type: 'note_body',
                 }); }}
            >
                { note.children_body?.map((child: NoteProps | MdastNode, index: number) => {
                    if ('seq' in child && child.seq !== undefined) {
                        return <GenericNote
                            key={child.seq}
                            {...child}
                            display_options={{
                                ...note.display_options,
                                id: `v${note.display_options?.view_id}-n${child.seq}`,
                                // don't pass down draggable props as only this (parent) note is draggable
                                provided: {
                                    draggableProps: undefined,
                                    dragHandleProps: undefined,
                                }
                            }}
                            // note handlers are hydrated by parent view, not in NoteProps, so pass down
                            handlers={note.handlers}
                        />;
                    } else {
                        return <Fragment key={`nn-${index}`}>
                            {renderNodeUnified(child as MdastNode)}
                        </Fragment>;
                    }
                })}
            </div> : ''}
        </div>
    );
}

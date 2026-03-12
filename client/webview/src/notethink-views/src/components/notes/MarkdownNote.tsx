import {Fragment, useMemo, useState} from "react";
import {MdastNode, NoteProps} from "../../types/NoteProps";
import {
    getStandardNoteDataProps,
    renderMarkdownNoteHeadline,
    renderNodeUnified
} from "../../lib/renderops";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import { buildNoteStyles, headlineClickPosition, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import GenericNote from "../../components/notes/GenericNote";
import Debug from 'debug';
const debug = Debug("nodejs:notethink-views:MarkdownNote");

const ABRIDGE_THRESHOLD = 4;
const MAX_VISIBLE_DESCENDANTS = 12;
const SHOW_TOP = 3;
const SHOW_BOTTOM = 2;

function renderBodyItems(note: NoteProps, items: (NoteProps | MdastNode)[], baseIndex: number) {
    return items.map((child, i) => {
        const index = baseIndex + i;
        if ('seq' in child && child.seq !== undefined) {
            return <GenericNote
                key={child.seq}
                {...child}
                display_options={{
                    ...note.display_options,
                    id: `v${note.display_options?.view_id}-n${child.seq}`,
                    provided: {
                        draggableProps: undefined,
                        dragHandleProps: undefined,
                    }
                }}
                handlers={note.handlers}
            />;
        } else {
            return <Fragment key={`nn-${index}`}>
                {renderNodeUnified(child as MdastNode)}
            </Fragment>;
        }
    });
}

export default function MarkdownNote(props: NoteProps) {
    const [expanded, setExpanded] = useState(false);

    // parse note and memoize at component level to limit the string and markdown parsing (heavy lifting)
    const memoized_headline = useMemo(() => {
        return renderMarkdownNoteHeadline(props, {
            render: props.display_options?.settings?.show_linetags_in_headlines ? 'all_children' : 'strip_linetags',
            linetags_from: props.linetags_from,
        });
    }, [
        props.headline_raw,
        props.checked, props.display_options?.settings?.show_linetags_in_headlines,
        props.linetags_from,
    ]);
    // get latest updates: always take the `props` version of `note` attributes, because memoized `parseNote` is only augmenting
    const note: NoteProps = {
        headline: memoized_headline,
        ...props
    };

    // render note
    return (
        <div className={buildNoteStyles(note, note.display_options?.additional_classes).join(' ')}
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
                 onClick={createNoteClickHandler(note, headlineClickPosition(note))}
            >
                {note.display_options?.settings?.show_line_numbers && (<span className={view_specific_styles.lineno}><span>{note.position.start.line}</span></span>)}
                {note.headline}
            </div>
            { note.linetags && <GenericNoteAttributes
                {...note}
            /> }
            { note.children_body?.length ?
            <div className={view_specific_styles.body}
                 onClick={createNoteClickHandler(note, bodyClickPosition(note))}
            >
                { (() => {
                    const body = note.children_body!;
                    // determine abridge cutoff: either by direct child count or by descendant budget
                    let cutoff = body.length;
                    const abridge_by_count = body.length > ABRIDGE_THRESHOLD;
                    if (abridge_by_count) {
                        cutoff = SHOW_TOP;
                    }
                    // budget-based cutoff: walk children, sum descendant counts, find where budget is exceeded
                    if (!abridge_by_count && body.length > 1) {
                        let running = 0;
                        for (let i = 0; i < body.length; i++) {
                            const child = body[i];
                            const child_cost = ('seq' in child && (child as NoteProps).seq !== undefined)
                                ? 1 + ((child as NoteProps).descendant_note_count ?? 0)
                                : 1;
                            running += child_cost;
                            if (running > MAX_VISIBLE_DESCENDANTS && i < body.length - 1) {
                                cutoff = i + 1;
                                break;
                            }
                        }
                    }
                    const should_abridge = cutoff < body.length && !expanded;
                    if (should_abridge) {
                        const tail = Math.min(SHOW_BOTTOM, body.length - cutoff);
                        const hidden_count = body.length - cutoff - tail;
                        return <>
                            {renderBodyItems(note, body.slice(0, cutoff), 0)}
                            {hidden_count > 0 && (
                                <span className={view_specific_styles.readMoreToggle}
                                      role="button"
                                      onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                                >&hellip; {hidden_count} more items</span>
                            )}
                            {tail > 0 && renderBodyItems(note, body.slice(-tail), body.length - tail)}
                        </>;
                    }
                    return <>
                        {renderBodyItems(note, body, 0)}
                        {cutoff < body.length && (
                            <span className={view_specific_styles.readMoreToggle}
                                  role="button"
                                  onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                            >Show less</span>
                        )}
                    </>;
                })() }
            </div> : ''}
        </div>
    );
}

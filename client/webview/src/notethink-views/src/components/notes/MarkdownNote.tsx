import {Fragment, useCallback, useEffect, useRef, useMemo, useState} from "react";
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

// abridge when rendered height exceeds this multiple of width (top-level notes only)
const HEIGHT_RATIO = 2;

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
    const [overflow_state, setOverflowState] = useState<{ overflows: boolean; max_height: number }>({ overflows: false, max_height: 0 });
    const note_ref = useRef<HTMLDivElement>(null);

    // top-level = direct child of the parent context note
    const parent_seq = props.parent_notes?.length ? props.parent_notes[props.parent_notes.length - 1].seq : undefined;
    const is_top_level = parent_seq !== undefined && parent_seq === props.display_options?.parent_context_seq;

    // merge refs: our measurement ref + drag-and-drop innerRef
    const set_refs = useCallback((el: HTMLDivElement | null) => {
        note_ref.current = el;
        const inner_ref = props.display_options?.provided?.innerRef;
        if (typeof inner_ref === 'function') {
            inner_ref(el);
        } else if (inner_ref && typeof inner_ref === 'object' && 'current' in inner_ref) {
            (inner_ref as { current: HTMLDivElement | null }).current = el;
        }
    }, [props.display_options?.provided?.innerRef]);

    // measure rendered dimensions and detect overflow (runs regardless of focus so we always know)
    useEffect(() => {
        if (!is_top_level || !note_ref.current) {
            setOverflowState({ overflows: false, max_height: 0 });
            return;
        }
        const el = note_ref.current;
        const check = () => {
            const width = el.offsetWidth;
            const max_h = width * HEIGHT_RATIO;
            const naturally_overflows = el.scrollHeight > max_h;
            setOverflowState(prev => {
                if (prev.overflows === naturally_overflows && prev.max_height === max_h) { return prev; }
                return { overflows: naturally_overflows, max_height: max_h };
            });
        };
        const observer = new ResizeObserver(check);
        observer.observe(el);
        check();
        return () => observer.disconnect();
    }, [is_top_level]);

    // expand when focused, clip when unfocused and overflowing
    const should_clip = is_top_level && !props.focused && overflow_state.overflows;

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
             ref={set_refs}
             role={'row'} aria-current={note.focused} aria-selected={note.selected}
             style={should_clip ? { maxHeight: `${overflow_state.max_height}px`, overflow: 'hidden', position: 'relative' } : undefined}
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
                {renderBodyItems(note, note.children_body, 0)}
            </div> : ''}
            {should_clip && (
                <div className={view_specific_styles.abridgeFade}>
                    <span className={view_specific_styles.readMoreToggle}>Show more</span>
                </div>
            )}
        </div>
    );
}

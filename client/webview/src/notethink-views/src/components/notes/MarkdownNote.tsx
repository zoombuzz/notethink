import {Fragment, memo, useCallback, useEffect, useRef, useMemo, useState} from "react";
import {MdastNode, NoteProps} from "../../types/NoteProps";
import {
    getStandardNoteDataProps,
    renderMarkdownNoteHeadline,
    renderBodyItems,
} from "../../lib/renderops";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import { buildNoteStyles, headlineClickPosition, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import Debug from 'debug';
const debug = Debug("nodejs:notethink-views:MarkdownNote");

// abridge when rendered height exceeds this multiple of width (top-level notes only)
const HEIGHT_RATIO = 1;

export default memo(function MarkdownNote(props: NoteProps) {
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

    // detect drag-in-progress from hello-pangea/dnd's provided style
    const is_dragging = props.display_options?.provided?.draggableProps?.style !== undefined
        && props.display_options?.provided?.draggableProps?.style !== null
        && (props.display_options.provided.draggableProps.style as Record<string, unknown>).position === 'fixed';

    // measure rendered dimensions and detect overflow (runs regardless of focus so we always know)
    useEffect(() => {
        if (!is_top_level || !note_ref.current) {
            setOverflowState({ overflows: false, max_height: 0 });
            return;
        }
        const el = note_ref.current;
        const check = () => {
            // skip measurement during drag — element is position:fixed with wrong dimensions
            if (getComputedStyle(el).position === 'fixed') { return; }
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

    // manual expand state: tracks user's "Show more" click when auto-expand is off
    const [manually_expanded, setManuallyExpanded] = useState(false);
    const auto_expand = props.display_options?.settings?.auto_expand_focused_note;

    // reset manually_expanded when note content changes
    useEffect(() => {
        setManuallyExpanded(false);
    }, [props.body_raw]);

    // clip logic: auto-expand ON → expand on focus; OFF → respect manually_expanded;
    // lock clip state during drag to prevent flash on drop
    const should_clip_base = is_top_level && overflow_state.overflows && (
        auto_expand
            ? !props.focused
            : !manually_expanded
    );
    const clip_lock_ref = useRef(should_clip_base);
    if (!is_dragging) { clip_lock_ref.current = should_clip_base; }
    const should_clip = is_dragging ? clip_lock_ref.current : should_clip_base;

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
             style={{
                 ...(props.display_options?.provided?.draggableProps?.style as React.CSSProperties | undefined),
                 ...(should_clip ? { maxHeight: `${overflow_state.max_height}px`, overflow: 'hidden', position: 'relative' } : undefined),
             }}
        >
            <div className={view_specific_styles.headline}
                 role={'rowheader'}
                 data-offset-start={note.position.start.offset}
                 data-offset-end={note.position.end.offset}
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
                {renderBodyItems(note, note.children_body)}
            </div> : ''}
            {should_clip && (
                <div className={view_specific_styles.abridgeFade}>
                    <span
                        className={view_specific_styles.readMoreToggle}
                        onClick={(e) => { e.stopPropagation(); setManuallyExpanded(true); }}
                        role="button"
                    >Show more</span>
                </div>
            )}
            {!should_clip && is_top_level && overflow_state.overflows && (
                <div className={view_specific_styles.showLessBar}>
                    <span
                        className={view_specific_styles.readMoreToggle}
                        onClick={(e) => { e.stopPropagation(); setManuallyExpanded(false); }}
                        role="button"
                    >Show less</span>
                </div>
            )}
        </div>
    );
}, areMarkdownNotePropsEqual);

function areMarkdownNotePropsEqual(prev: NoteProps, next: NoteProps): boolean {
    if (prev.seq !== next.seq) { return false; }
    if (prev.headline_raw !== next.headline_raw) { return false; }
    if (prev.body_raw !== next.body_raw) { return false; }
    if (prev.focused !== next.focused) { return false; }
    if (prev.selected !== next.selected) { return false; }
    if (prev.checked !== next.checked) { return false; }
    if (prev.level !== next.level) { return false; }
    if (prev.linetags_from !== next.linetags_from) { return false; }
    if (!!prev.linetags !== !!next.linetags) { return false; }
    if (prev.position.start.offset !== next.position.start.offset) { return false; }
    if (prev.position.end.offset !== next.position.end.offset) { return false; }
    if (prev.position.end_body?.offset !== next.position.end_body?.offset) { return false; }
    if ((prev.children_body?.length ?? 0) !== (next.children_body?.length ?? 0)) { return false; }
    if (prev.display_options?.id !== next.display_options?.id) { return false; }
    if (prev.display_options?.parent_context_seq !== next.display_options?.parent_context_seq) { return false; }
    if (prev.display_options?.settings?.show_linetags_in_headlines !== next.display_options?.settings?.show_linetags_in_headlines) { return false; }
    if (prev.display_options?.settings?.show_line_numbers !== next.display_options?.settings?.show_line_numbers) { return false; }
    if (prev.display_options?.settings?.auto_expand_focused_note !== next.display_options?.settings?.auto_expand_focused_note) { return false; }
    // DnD: provided changes during drag (draggableProps.style contains transform)
    if (prev.display_options?.provided?.draggableProps !== next.display_options?.provided?.draggableProps) { return false; }
    if (prev.display_options?.provided?.dragHandleProps !== next.display_options?.provided?.dragHandleProps) { return false; }
    return true;
}

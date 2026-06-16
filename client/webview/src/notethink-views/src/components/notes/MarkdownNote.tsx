import Debug from 'debug';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { arraysEqual } from "../../lib/noteops";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import MarkdownNoteBody from "./markdown/MarkdownNoteBody";
import MarkdownNoteContainer from "./markdown/MarkdownNoteContainer";
import MarkdownNoteHeadline from "./markdown/MarkdownNoteHeadline";
import { useMarkdownNoteOverflow } from "./markdown/useMarkdownNoteOverflow";
import { useMarkdownNoteBodyScroll } from "./markdown/useMarkdownNoteBodyScroll";
import view_specific_styles from "../../components/ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:MarkdownNote");

export default memo(function MarkdownNote(props: NoteProps): ReactElement {
    const note_ref = useRef<HTMLDivElement>(null);
    const body_ref = useRef<HTMLDivElement>(null);

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

    const overflow_state = useMarkdownNoteOverflow(body_ref, is_top_level);

    // manual expand state: tracks user's "Show more" click when auto-expand is off
    const [manually_expanded, setManuallyExpanded] = useState(false);
    const auto_expand = props.display_options?.settings?.autoExpandFocusedNote;

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

    const { scrolled_top, at_bottom } = useMarkdownNoteBodyScroll({
        body_ref,
        should_clip,
        focused: props.focused,
        children_body: props.children_body,
        body_raw: props.body_raw,
        caret_offset: props.display_options?.caret_offset as number | undefined,
    });

    // parse note and memoize at component level to limit the string and markdown parsing (heavy lifting)
    // always strip linetag link nodes from MDAST - they render as invisible empty <a> elements;
    // visible linetag badges are appended separately when showLinetagsInHeadlines is enabled
    const memoized_headline = useMemo(() => {
        return renderMarkdownNoteHeadline(props, {
            render: 'strip_linetags',
            linetags_from: props.linetags_from,
        });
    }, [
        props.headline_raw,
        props.checked,
        props.linetags_from,
    ]);
    // get latest updates: always take the `props` version of `note` attributes, because memoized `parseNote` is only augmenting
    const note: NoteProps = {
        headline: memoized_headline,
        ...props
    };

    return (
        <MarkdownNoteContainer note={note} set_refs={set_refs}>
            <MarkdownNoteHeadline note={note} />
            {/* the synthetic root's front-matter linetags surface as the view's document-level strip, not inline here */}
            { note.type !== 'root' && note.linetags && <GenericNoteAttributes {...note} /> }
            <MarkdownNoteBody
                note={note}
                body_ref={body_ref}
                should_clip={should_clip}
                max_height={overflow_state.max_height}
                scrolled_top={scrolled_top}
                at_bottom={at_bottom}
                onExpand={() => setManuallyExpanded(true)}
            />
            {!should_clip && is_top_level && overflow_state.overflows && (
                <div className={view_specific_styles.showLessBar}>
                    <span
                        className={view_specific_styles.readMoreToggle}
                        onClick={(e) => { e.stopPropagation(); setManuallyExpanded(false); }}
                        role="button"
                    >Show less</span>
                </div>
            )}
        </MarkdownNoteContainer>
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
    if (prev.display_options?.settings?.showLinetagsInHeadlines !== next.display_options?.settings?.showLinetagsInHeadlines) { return false; }
    if (prev.display_options?.settings?.showLineNumbers !== next.display_options?.settings?.showLineNumbers) { return false; }
    if (prev.display_options?.settings?.autoExpandFocusedNote !== next.display_options?.settings?.autoExpandFocusedNote) { return false; }
    // caret offset drives body scroll in clipped notes - only re-render focused notes
    if (next.focused && prev.display_options?.caret_offset !== next.display_options?.caret_offset) { return false; }
    // children's focused/selected status flows through display_options.focused_seqs / selected_seqs; when those change, child notes need to re-render even if this note's own focused/selected didn't
    if (!arraysEqual(prev.display_options?.focused_seqs, next.display_options?.focused_seqs)) { return false; }
    if (!arraysEqual(prev.display_options?.selected_seqs, next.display_options?.selected_seqs)) { return false; }
    // DnD: provided changes during drag (draggableProps.style contains transform)
    if (prev.display_options?.provided?.draggableProps !== next.display_options?.provided?.draggableProps) { return false; }
    if (prev.display_options?.provided?.dragHandleProps !== next.display_options?.provided?.dragHandleProps) { return false; }
    return true;
}

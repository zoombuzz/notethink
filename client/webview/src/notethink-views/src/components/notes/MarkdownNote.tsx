import { memo, useCallback, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { arraysEqual, dispatchNoteExpanded, isNoteManuallyExpanded } from "../../lib/noteops";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import MarkdownNoteBody from "./markdown/MarkdownNoteBody";
import MarkdownNoteContainer from "./markdown/MarkdownNoteContainer";
import MarkdownNoteHeadline from "./markdown/MarkdownNoteHeadline";
import { useMarkdownNoteOverflow } from "./markdown/useMarkdownNoteOverflow";
import { useSyncedBodyClip } from "./markdown/useSyncedBodyClip";
import { useMarkdownNoteBodyScroll } from "./markdown/useMarkdownNoteBodyScroll";
import view_specific_styles from "../../components/ViewRenderer.module.scss";

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
    const overflow_state = useMarkdownNoteOverflow(body_ref, is_top_level, props.display_options?.card_target_height);
    // manual expand lives in the view's view_expanded_ids keyed by stable_id, surviving a remount but resetting on a rename
    const manually_expanded = isNoteManuallyExpanded(props);
    const auto_expand = props.display_options?.settings?.autoExpandFocusedNote;
    // clip logic: auto-expand favours focus, otherwise manually_expanded; locked during drag to avoid a flash on drop
    const should_clip_base = is_top_level && overflow_state.overflows && (
        auto_expand
            ? !props.focused
            : !manually_expanded
    );
    const clip_lock_ref = useRef(should_clip_base);
    if (!is_dragging) { clip_lock_ref.current = should_clip_base; }
    const should_clip = is_dragging ? clip_lock_ref.current : should_clip_base;
    // settle the clip geometry synchronously, before the kanban FLIP host samples positions
    useSyncedBodyClip(body_ref, { is_top_level, is_dragging, auto_expand, focused: props.focused, manually_expanded, card_target_height: props.display_options?.card_target_height });
    const { scrolled_top, at_bottom } = useMarkdownNoteBodyScroll({
        body_ref,
        should_clip,
        focused: props.focused,
        children_body: props.children_body,
        body_raw: props.body_raw,
        caret_offset: props.display_options?.caret_offset as number | undefined,
    });
    // memoized to limit markdown parsing; strips linetag link nodes from MDAST since visible badges are appended separately
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
    // always take props' own attributes for `note`; memoized `parseNote` only augments them
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
                onExpand={() => dispatchNoteExpanded(props, true)}
            />
            {!should_clip && is_top_level && overflow_state.overflows && (
                <div className={view_specific_styles.showLessBar}>
                    <span
                        className={view_specific_styles.readMoreToggle}
                        onClick={(e) => { e.stopPropagation(); dispatchNoteExpanded(props, false); }}
                        role="button"
                    >Show less</span>
                </div>
            )}
        </MarkdownNoteContainer>
    );
}, areMarkdownNotePropsEqual);

// walkable one level deeper; an array is not, so it reaches the compare below as changed
function isPropRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether two of @hello-pangea/dnd's `provided` prop bags carry the same values.
 *
 * dnd rebuilds `provided` on every render of its Draggable, so comparing the bags by identity
 * repaints every card on every board update for no visible change. What the card does with them is
 * spread them onto its container, so their VALUES are what decides whether it has to: equal values
 * mean the DOM already carries them. `depth` bounds the walk at the one nested object these bags
 * hold, `style`, whose own members are primitives; anything deeper counts as changed.
 */
function providedPropsEqual(prev: Record<string, unknown> | undefined, next: Record<string, unknown> | undefined, depth: number = 1): boolean {
    if (prev === next) { return true; }
    if (!prev || !next) { return false; }
    const keys = Object.keys(prev);
    if (keys.length !== Object.keys(next).length) { return false; }
    for (const key of keys) {
        const prev_value = prev[key];
        const next_value = next[key];
        if (prev_value === next_value) { continue; }
        if (depth <= 0 || !isPropRecord(prev_value) || !isPropRecord(next_value)) { return false; }
        if (!providedPropsEqual(prev_value, next_value, depth - 1)) { return false; }
    }
    return true;
}

/**
 * Whether this card can skip a re-render.
 *
 * stable_id leads because it is the note's identity: two notes that share a slot across an update
 * are the same note only if it matches, and unlike seq it survives a merge that re-interleaves the
 * files. seq is still compared, one line down, because the rendered DOM carries it (data-seq, and
 * the `v<view>-n<seq>` element id the caret and scroll hooks look up), so a card whose number moved
 * has to repaint even when nothing else about it did.
 *
 * Exported for its own test: what this returns decides how much of a board an unrelated file's
 * update repaints, and that is not observable from the rendered output.
 */
export function areMarkdownNotePropsEqual(prev: NoteProps, next: NoteProps): boolean {
    if (prev.stable_id !== next.stable_id) { return false; }
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
    // the document view renders every story inside the root's body, so skipping its re-render pins each story's card
    if (prev.display_options?.settings?.cardType !== next.display_options?.settings?.cardType) { return false; }
    // caret offset drives body scroll in clipped notes - only re-render focused notes
    if (next.focused && prev.display_options?.caret_offset !== next.display_options?.caret_offset) { return false; }
    // one id list covers this note and its rendered descendants, so a parent repaints even with its own membership unchanged
    if (!arraysEqual(prev.display_options?.view_expanded_ids, next.display_options?.view_expanded_ids)) { return false; }
    // children's focused/selected flows through focused_seqs/selected_seqs, so they re-render even when this note's didn't
    if (!arraysEqual(prev.display_options?.focused_seqs, next.display_options?.focused_seqs)) { return false; }
    if (!arraysEqual(prev.display_options?.selected_seqs, next.display_options?.selected_seqs)) { return false; }
    // a lane's target height lands after the first measurement, so ignoring its change would keep the body first rendered
    if (prev.display_options?.card_target_height !== next.display_options?.card_target_height) { return false; }
    // provided changes during drag (draggableProps.style carries transform), so compare what the bags hold, not their identity
    if (!providedPropsEqual(prev.display_options?.provided?.draggableProps, next.display_options?.provided?.draggableProps)) { return false; }
    if (!providedPropsEqual(prev.display_options?.provided?.dragHandleProps, next.display_options?.provided?.dragHandleProps)) { return false; }
    return true;
}

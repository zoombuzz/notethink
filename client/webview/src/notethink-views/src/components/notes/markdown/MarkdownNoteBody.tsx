import Debug from "debug";
import type { ReactElement } from "react";
import { renderBodyItems } from "../../../lib/renderops";
import { bodyClickPosition, createNoteClickHandler } from "../../../lib/noteui";
import type { NoteProps } from "../../../types/NoteProps";
import view_specific_styles from "../../../components/ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:MarkdownNoteBody");

interface MarkdownNoteBodyProps {
    note: NoteProps;
    body_ref: React.RefObject<HTMLDivElement | null>;
    should_clip: boolean;
    max_height: number;
    scrolled_top: number;
    at_bottom: boolean;
    onExpand: () => void;
}

/**
 * render-only subtree for the body region of a MarkdownNote: the body itself,
 * the rendered body items, and the optional top/bottom "Show more" fade bars.
 *
 * State-less: every measurement and scroll value is passed in (overflow / scroll
 * state lives in useMarkdownNoteOverflow and useMarkdownNoteBodyScroll). The
 * onExpand callback is invoked when either fade bar's "Show more" is clicked -
 * the parent owns the manually_expanded toggle.
 *
 * Renders nothing when the note has no body children, mirroring the original
 * `has_body && (...)` guard.
 */
export default function MarkdownNoteBody(props: MarkdownNoteBodyProps): ReactElement | null {
    const { note, body_ref, should_clip, max_height, scrolled_top, at_bottom, onExpand } = props;
    if (!note.children_body?.length) { return null; }
    const clip_style = should_clip
        ? { maxHeight: `${max_height}px`, overflow: 'hidden' as const, scrollPaddingTop: '4em', scrollPaddingBottom: '6em' }
        : undefined;
    return (
        <div style={{ position: 'relative' }}>
            <div className={view_specific_styles.body}
                 ref={body_ref}
                 onClick={createNoteClickHandler(note, bodyClickPosition(note))}
                 style={clip_style}
            >
                {renderBodyItems(note, note.children_body)}
            </div>
            {should_clip && scrolled_top > 0 && (
                <div className={view_specific_styles.abridgeFadeTop}>
                    <span className={view_specific_styles.readMoreRow}>
                        <span
                            className={view_specific_styles.readMoreToggle}
                            onClick={(e) => { e.stopPropagation(); onExpand(); }}
                            role="button"
                        >Show more</span>
                        <span className={view_specific_styles.readMoreArrow + ' ' + view_specific_styles.readMoreArrowDown}>{'»'}</span>
                    </span>
                </div>
            )}
            {should_clip && !at_bottom && (
                <div className={view_specific_styles.abridgeFade}>
                    <span className={view_specific_styles.readMoreRow}>
                        <span
                            className={view_specific_styles.readMoreToggle}
                            onClick={(e) => { e.stopPropagation(); onExpand(); }}
                            role="button"
                        >Show more</span>
                        <span className={view_specific_styles.readMoreArrow + ' ' + view_specific_styles.readMoreArrowUp}>{'»'}</span>
                    </span>
                </div>
            )}
        </div>
    );
}

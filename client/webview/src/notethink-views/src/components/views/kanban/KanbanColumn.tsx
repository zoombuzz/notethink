import type { ReactElement, ReactNode } from "react";
import { formatColumnLabel } from "../../../lib/noteops";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import view_specific_styles from "../../ViewRenderer.module.scss";

/**
 * Props for one kanban column/group.
 * - notesRef: the `.notes` wrapper, the in-column portal target for a dragged clone; typed
 *   structurally because two @types/react copies make React's Ref nominally distinct
 */
interface KanbanColumnProps {
    seq: number;
    value: string;
    type?: string;
    count?: number;
    display_options?: NoteDisplayOptions;
    children?: ReactNode;
    notesRef?: ((instance: HTMLDivElement | null) => void) | { current: HTMLDivElement | null };
}

export default function KanbanColumn(props: KanbanColumnProps): ReactElement {
    const note_styles = [view_specific_styles.column];
    if (props.type) { note_styles.push(view_specific_styles.pseudo); }
    if (props.display_options?.draglight) { note_styles.push(view_specific_styles.draglight); }
    return (
        <div className={note_styles.join(' ')}
             role={'region'} aria-label={props.value}
             data-flip-column-id={props.value}
             data-column-group=""
             {...props.display_options?.provided?.droppableProps}
             ref={props.display_options?.provided?.innerRef}
        >
            <div className={view_specific_styles.heading} role={'columnheader'}>
                <h3>{formatColumnLabel(props.value)}</h3>
                {props.count !== undefined && (
                    <span className={view_specific_styles.countBadge} data-testid="count-badge">{props.count}</span>
                )}
            </div>
            <div className={view_specific_styles.notes} data-column-cards="" ref={props.notesRef}>
                {props.children}
            </div>
            {/* repeats the heading at the group's far end, outside .notes so it is never read as a card; aria-hidden since the heading above already names the group to assistive tech */}
            <div className={view_specific_styles.footer} aria-hidden="true" data-testid={`group-footer-${props.value}`}>
                <h3>{formatColumnLabel(props.value)}</h3>
                {props.count !== undefined && (
                    <span className={view_specific_styles.countBadge} data-testid="footer-count-badge">{props.count}</span>
                )}
            </div>
        </div>
    );
}

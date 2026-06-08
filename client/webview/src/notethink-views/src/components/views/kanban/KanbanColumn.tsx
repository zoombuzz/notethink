import Debug from "debug";
import type { ReactElement, ReactNode } from "react";
import { formatColumnLabel } from "../../../lib/noteops";
import type { NoteDisplayOptions } from "../../../types/NoteProps";
import view_specific_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:KanbanColumn");

interface KanbanColumnProps {
    seq: number;
    value: string;
    type?: string;
    count?: number;
    display_options?: NoteDisplayOptions;
    children?: ReactNode;
}

export default function KanbanColumn(props: KanbanColumnProps): ReactElement {
    const note_styles = [view_specific_styles.column];
    if (props.type) { note_styles.push(view_specific_styles.pseudo); }
    if (props.display_options?.draglight) { note_styles.push(view_specific_styles.draglight); }

    const percentage_width = props.display_options?.total_columns ? 100 / props.display_options?.total_columns : 100;

    return (
        <div className={note_styles.join(' ')}
             role={'region'} aria-label={props.value}
             style={{ width: `calc(${percentage_width}% - 0.5em)` }}
             {...props.display_options?.provided?.droppableProps}
             ref={props.display_options?.provided?.innerRef}
        >
            <div className={view_specific_styles.heading} role={'columnheader'}>
                <h3>{formatColumnLabel(props.value)}</h3>
                {props.count !== undefined && (
                    <span className={view_specific_styles.countBadge} data-testid="count-badge">{props.count}</span>
                )}
            </div>
            <div className={view_specific_styles.notes}>
                {props.children}
            </div>
        </div>
    );
}

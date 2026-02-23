import { ReactNode } from "react";
import type { NoteDisplayOptions } from "../../types/NoteProps";
import view_specific_styles from "../ViewRenderer.module.scss";

interface KanbanColumnProps {
    seq: number;
    value: string;
    type?: string;
    display_options?: NoteDisplayOptions;
    children?: ReactNode;
}

export default function KanbanColumn(props: KanbanColumnProps) {
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
                <h3>{props.value}</h3>
            </div>
            <div className={view_specific_styles.notes}>
                {props.children}
            </div>
        </div>
    );
}

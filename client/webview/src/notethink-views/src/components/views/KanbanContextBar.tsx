import type { ViewProps } from "../../types/ViewProps";
import master_view_styles from "../ViewRenderer.module.scss";

interface KanbanContextBarProps extends ViewProps {
    onSettingsClick?: () => void;
}

export default function KanbanContextBar(props: KanbanContextBarProps) {

    const container_styles: Array<string> = [master_view_styles.contextBar];

    return (
        <div className={container_styles.join(' ')} id={`v${props.id}-context`}
             data-level={props.display_options?.level}
             data-parent-content-seq={props.display_options?.parent_context_seq}>
            {props.nested?.breadcrumb_trail}
            {props.onSettingsClick && (
                <button
                    data-testid="kanban-settings-button"
                    onClick={(e) => { e.stopPropagation(); props.onSettingsClick?.(); }}
                    style={{
                        float: 'right',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '1.1em',
                        padding: '0 0.5em',
                        color: 'inherit',
                        opacity: 0.6,
                    }}
                    title="Kanban settings"
                    aria-label="Kanban settings"
                >
                    &#9881;
                </button>
            )}
        </div>
    );
}

import {ViewProps} from "../../types/ViewProps";
import master_view_styles from "../../components/ViewRenderer.module.scss";

export default function DocumentContextBar(props: ViewProps) {

    const container_styles: Array<string> = [master_view_styles.contextBar];

    return (
        <div className={container_styles.join(' ')} id={`v${props.id}-context`}
             data-level={props.display_options?.level}
             data-parent-content-seq={props.display_options?.parent_context_seq}>
        </div>
    );
}

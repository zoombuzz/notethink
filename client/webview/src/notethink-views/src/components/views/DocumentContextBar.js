import { jsx as _jsx } from "react/jsx-runtime";
import master_view_styles from "../../components/ViewRenderer.module.scss";
export default function DocumentContextBar(props) {
    const container_styles = [master_view_styles.contextBar];
    return (_jsx("div", { className: container_styles.join(' '), id: `v${props.id}-context`, "data-level": props.display_options?.level, "data-parent-content-seq": props.display_options?.parent_context_seq, children: props.nested?.breadcrumb_trail }));
}

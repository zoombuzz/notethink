import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, Fragment } from "react";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import styles from "./BreadcrumbTrail.module.scss";
export default function BreadcrumbTrail(props) {
    const parent_context = props;
    const parent_context_headlines_raw = (parent_context.parent_notes || []).map((item) => item.headline_raw).join(' > ');
    const memoized_notes = useMemo(() => {
        return (parent_context.parent_notes || []).map((item, index, items) => {
            const item_with_headline = renderMarkdownNoteHeadline(item, { output_type: 'string' });
            return {
                ...item,
                headline: item_with_headline,
                display_options: {
                    ...item.display_options,
                    additional_classes: (index < items.length - 1 ? [styles.breadcrumbItem, styles.clickable] : [styles.breadcrumbItem]),
                }
            };
        });
    }, [
        parent_context_headlines_raw,
        parent_context
    ]);
    return (_jsx("div", { className: styles.breadcrumbTrail, children: memoized_notes.map((item, index) => {
            return _jsxs(Fragment, { children: [index > 0 && _jsx("div", { className: styles.breadcrumbSeparator, children: ">" }), _jsx("div", { className: item.display_options?.additional_classes?.join(' '), onClick: (event) => {
                            parent_context.handlers?.setParentContextSeq?.(item.seq);
                        }, children: _jsx("span", { children: item.headline }) })] }, `breadcrumb-${item.seq}-${index}`);
        }) }));
}

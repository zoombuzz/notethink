import { MouseEvent, useMemo, Fragment } from "react";
import type { NoteProps } from "../../types/NoteProps";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import styles from "./BreadcrumbTrail.module.scss";

export default function BreadcrumbTrail(props: NoteProps) {
    const parent_context = props;
    const parent_context_headlines_raw = (parent_context.parent_notes || []).map((item: NoteProps) => item.headline_raw).join(' > ');

    const memoized_notes: Array<NoteProps> = useMemo(() => {
        return (parent_context.parent_notes || []).map((item: NoteProps, index: number, items: Array<NoteProps>) => {
            const item_with_headline = renderMarkdownNoteHeadline(item, { output_type: 'string' });
            return {
                ...item,
                headline: item_with_headline,
                display_options: {
                    ...item.display_options,
                    additional_classes: (index < items.length - 1 ? [styles.breadcrumbItem, styles.clickable] : [styles.breadcrumbItem]),
                }
            } as NoteProps;
        });
    }, [
        parent_context_headlines_raw,
        parent_context
    ]);

    return (
        <div className={styles.breadcrumbTrail}>
            {memoized_notes.map((item: NoteProps, index: number) => {
                return <Fragment key={`breadcrumb-${item.seq}-${index}`}>
                    {index > 0 && <div className={styles.breadcrumbSeparator}>&gt;</div>}
                    <div className={item.display_options?.additional_classes?.join(' ')}
                         onClick={(event: MouseEvent<HTMLElement>) => {
                             parent_context.handlers?.setParentContextSeq?.(item.seq);
                         }}
                    >
                        <span>{item.headline}</span>
                    </div>
                </Fragment>;
            })}
        </div>
    );
}

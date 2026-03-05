import { MouseEvent, useMemo, Fragment } from "react";
import type { NoteProps } from "../../types/NoteProps";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import styles from "./BreadcrumbTrail.module.scss";

/**
 * Strip markdown heading prefixes and leading/trailing whitespace
 * from a raw headline string to produce plain text for aria-labels.
 */
function stripMarkdownHeadline(headline_raw: string): string {
    return headline_raw.replace(/^#+\s*/, '').trim();
}

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
        <nav className={styles.breadcrumbTrail} role="navigation" aria-label="Breadcrumb">
            {memoized_notes.map((item: NoteProps, index: number) => {
                return <Fragment key={`breadcrumb-${item.seq}-${index}`}>
                    {index > 0 && <span className={styles.breadcrumbSeparator} aria-hidden="true">&gt;</span>}
                    <button className={item.display_options?.additional_classes?.join(' ')}
                            aria-label={stripMarkdownHeadline(item.headline_raw)}
                            onClick={(event: MouseEvent<HTMLElement>) => {
                                parent_context.handlers?.setParentContextSeq?.(item.seq);
                            }}
                    >
                        <span>{item.headline}</span>
                    </button>
                </Fragment>;
            })}
        </nav>
    );
}

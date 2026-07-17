import Debug from "debug";
import type { MouseEvent, ReactElement } from "react";
import { useMemo, Fragment } from "react";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import { stripHeadlineLinetags } from "../../lib/noteops";
import type { NoteProps } from "../../types/NoteProps";
import styles from "./BreadcrumbTrail.module.scss";

const debug = Debug("nodejs:notethink-views:BreadcrumbNoteSegments");

interface BreadcrumbNoteSegmentsProps {
    notes: NoteProps[];
    onNoteClick?: (seq: number) => void;
}

/**
 * The note half of the breadcrumb: the chain of ancestor headlines above the parent context, each
 * clickable to re-root the view on that note. Every headline but the last is clickable, matching the
 * path segments above them, and each is rendered as simplified HTML through renderops.
 */
export default function BreadcrumbNoteSegments(props: BreadcrumbNoteSegmentsProps): ReactElement {
    const headlines_raw = props.notes.map((item: NoteProps) => item.headline_raw).join(' > ');
    const memoized_notes: Array<NoteProps> = useMemo(() => {
        return props.notes.map((item: NoteProps, index: number, items: Array<NoteProps>) => {
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
    }, [headlines_raw, props.notes]);
    debug("notes=%d", memoized_notes.length);

    return (
        <>
            {memoized_notes.map((item: NoteProps, index: number) => {
                return <Fragment key={`breadcrumb-${item.seq}-${index}`}>
                    {index > 0 && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
                    <button className={item.display_options?.additional_classes?.join(' ')}
                            aria-label={stripHeadlineLinetags(item.headline_raw)}
                            onClick={(event: MouseEvent<HTMLElement>) => {
                                props.onNoteClick?.(item.seq);
                            }}
                    >
                        <span>{item.headline}</span>
                    </button>
                </Fragment>;
            })}
        </>
    );
}

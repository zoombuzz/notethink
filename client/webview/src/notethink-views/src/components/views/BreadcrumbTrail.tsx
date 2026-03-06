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

export interface BreadcrumbTrailProps extends NoteProps {
    doc_path?: string;
    doc_relative_path?: string;
    workspace_root?: string;
    onDirectoryClick?: (dir_path: string) => void;
}

/**
 * Split a file path into segments for breadcrumb display.
 * Returns an array of { label, path } objects.
 * E.g. "/workspace/docs/todo.md" → [{label:"workspace",path:"/workspace"}, {label:"docs",path:"/workspace/docs"}, {label:"todo.md",path:"/workspace/docs/todo.md"}]
 */
function splitPathSegments(doc_path: string, workspace_root?: string, doc_relative_path?: string): Array<{ label: string; path: string }> {
    // Prefer doc_relative_path (computed by extension via asRelativePath, handles symlinks)
    // Fall back to stripping workspace_root prefix manually
    let relative_path: string;
    let prefix: string;

    if (doc_relative_path) {
        // Extension already computed the relative path — use it directly
        relative_path = doc_relative_path;
        // Derive the prefix by removing the relative path from the full doc_path
        const suffix_index = doc_path.lastIndexOf(doc_relative_path);
        prefix = suffix_index > 0 ? doc_path.slice(0, suffix_index).replace(/\/$/, '') : '';
    } else if (workspace_root && doc_path.startsWith(workspace_root)) {
        relative_path = doc_path.slice(workspace_root.length);
        prefix = workspace_root;
    } else {
        relative_path = doc_path;
        prefix = '';
    }

    const parts = relative_path.split('/').filter(Boolean);
    const segments: Array<{ label: string; path: string }> = [];
    let accumulated = prefix;
    for (const part of parts) {
        accumulated += '/' + part;
        segments.push({ label: part, path: accumulated });
    }
    return segments;
}

export default function BreadcrumbTrail(props: BreadcrumbTrailProps) {
    const parent_context = props;
    const parent_context_headlines_raw = (parent_context.parent_notes || []).map((item: NoteProps) => item.headline_raw).join(' > ');

    const path_segments = useMemo(() => {
        return props.doc_path ? splitPathSegments(props.doc_path, props.workspace_root, props.doc_relative_path) : [];
    }, [props.doc_path, props.workspace_root, props.doc_relative_path]);

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

    const has_path = path_segments.length > 0;
    const has_notes = memoized_notes.length > 0;

    return (
        <nav className={styles.breadcrumbTrail} role="navigation" aria-label="Breadcrumb">
            {path_segments.map((segment, index) => {
                return <Fragment key={`path-${index}`}>
                    {index > 0 && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
                    <button className={styles.breadcrumbItem + ' ' + styles.pathSegment}
                          aria-label={segment.label}
                          data-path={segment.path}
                          onClick={(event: MouseEvent<HTMLElement>) => {
                              event.stopPropagation();
                              props.onDirectoryClick?.(segment.path);
                          }}
                    >
                        {segment.label}
                    </button>
                </Fragment>;
            })}
            {has_path && has_notes && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
            {memoized_notes.map((item: NoteProps, index: number) => {
                return <Fragment key={`breadcrumb-${item.seq}-${index}`}>
                    {index > 0 && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
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

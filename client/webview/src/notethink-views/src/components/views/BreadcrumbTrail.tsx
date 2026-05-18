import { MouseEvent, useMemo, Fragment } from "react";
import * as l10n from "@vscode/l10n";
import type { NoteProps } from "../../types/NoteProps";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import { stripHeadlineLinetags } from "../../lib/noteops";
import styles from "./BreadcrumbTrail.module.scss";

export interface BreadcrumbTrailProps extends NoteProps {
    doc_path?: string;
    doc_relative_path?: string;
    workspace_root?: string;
    /**
     * When set, breadcrumb path segments reflect this directory (aggregate mode)
     * instead of the current file's path. Clicking a segment narrows the
     * aggregation to that subdirectory.
     */
    integration_path?: string;
    // directory (aggregate) mode only: number of source files in the merged view, rendered as "(N)" after the path (or "(N of M)" when the discovery cap truncated the set); not shown in single-file mode
    file_count?: number;
    aggregate_total_discovered?: number;
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
        // Extension already computed the relative path - use it directly
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
    // go one level up: keep the opened workspace folder itself (the last component of the stripped prefix, e.g. "active_development") as the first clickable breadcrumb segment so selecting it re-aggregates the whole opened folder rather than starting at the first subdirectory
    if (prefix) {
        const root_label = prefix.split('/').filter(Boolean).pop();
        if (root_label) {
            segments.push({ label: root_label, path: prefix });
        }
    }
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
        // directory (aggregate) mode: segment the integration directory itself
        // we synthesise the same {label, path} shape: each path holds the absolute directory so onDirectoryClick can re-narrow the aggregation
        if (props.integration_path) {
            // go one level up: keep the opened workspace folder itself as the first breadcrumb segment (e.g. "active_development") so it is clickable and re-aggregates the whole opened folder, not just the current subdirectory
            // we do this by stripping workspace_root's PARENT rather than workspace_root itself
            const within_workspace = !!props.workspace_root && props.integration_path.startsWith(props.workspace_root);
            const workspace_parent = within_workspace
                ? props.workspace_root!.replace(/\/[^/]*\/?$/, '')
                : '';
            const stripped = within_workspace
                ? props.integration_path.slice(workspace_parent.length)
                : props.integration_path;
            const parts = stripped.split('/').filter(Boolean);
            const segments: Array<{ label: string; path: string }> = [];
            let accumulated = workspace_parent;
            for (const part of parts) {
                accumulated += '/' + part;
                segments.push({ label: part, path: accumulated });
            }
            return segments;
        }
        return props.doc_path ? splitPathSegments(props.doc_path, props.workspace_root, props.doc_relative_path) : [];
    }, [props.doc_path, props.workspace_root, props.doc_relative_path, props.integration_path]);

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

    // directory (aggregate) mode only: "(N)" file count after the path, or "(N of M)" when the discovery cap truncated the set; never in single-file mode (always one file, so the count is meaningless there)
    const file_count_label = useMemo(() => {
        if (!props.integration_path || typeof props.file_count !== 'number') { return undefined; }
        const loaded = props.file_count;
        const total = props.aggregate_total_discovered;
        return (typeof total === 'number' && total > loaded)
            ? `(${loaded} of ${total})`
            : `(${loaded})`;
    }, [props.integration_path, props.file_count, props.aggregate_total_discovered]);

    const has_path = path_segments.length > 0;
    const has_notes = memoized_notes.length > 0;

    return (
        <nav className={styles.breadcrumbTrail} role="navigation" aria-label={l10n.t('Breadcrumb')}>
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
            {file_count_label && (
                <span className={styles.fileCount}
                      aria-label={l10n.t('{0} files in this folder', String(props.file_count ?? 0))}>
                    {file_count_label}
                </span>
            )}
            {has_path && has_notes && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
            {memoized_notes.map((item: NoteProps, index: number) => {
                return <Fragment key={`breadcrumb-${item.seq}-${index}`}>
                    {index > 0 && <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>}
                    <button className={item.display_options?.additional_classes?.join(' ')}
                            aria-label={stripHeadlineLinetags(item.headline_raw)}
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

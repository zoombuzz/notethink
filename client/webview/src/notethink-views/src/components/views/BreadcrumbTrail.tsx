import Debug from "debug";
import type { MouseEvent, ReactElement } from "react";
import { useMemo, Fragment } from "react";
import * as l10n from "@vscode/l10n";
import { renderMarkdownNoteHeadline } from "../../lib/renderops";
import { stripHeadlineLinetags } from "../../lib/noteops";
import { segmentPathBelowWorkspace, splitPathSegments } from "../../lib/pathops";
import type { NoteProps } from "../../types/NoteProps";
import styles from "./BreadcrumbTrail.module.scss";

const debug = Debug("nodejs:notethink-views:BreadcrumbTrail");

/**
 * integration_path: when set, breadcrumb path segments reflect this folder (folder mode)
 * instead of the current file's path; clicking a segment narrows the aggregation to that subfolder.
 * file_count / note_count / aggregate_total_discovered: folder mode only, rendered as "(X in Y files)"
 * after the path (or "(X in Y of M files)" when the discovery cap truncated the set), never in single-file mode.
 * X = note_count (top-level stories), Y = file_count (source files loaded), M = aggregate_total_discovered (files found before the cap).
 * onFileCountClick: clicking the count opens the Files drawer, receiving the count element so the drawer can scroll-anchor to it.
 */
export interface BreadcrumbTrailProps extends NoteProps {
    doc_path?: string;
    doc_relative_path?: string;
    workspace_root?: string;
    integration_path?: string;
    file_count?: number;
    note_count?: number;
    aggregate_total_discovered?: number;
    onFolderClick?: (folder_path: string) => void;
    onFileCountClick?: (anchor: HTMLElement) => void;
}

// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export default function BreadcrumbTrail(props: BreadcrumbTrailProps): ReactElement {
    const parent_context = props;
    const parent_context_headlines_raw = (parent_context.parent_notes || []).map((item: NoteProps) => item.headline_raw).join(' > ');

    const path_segments = useMemo(() => {
        // folder mode: segment the integration folder itself so onFolderClick can re-narrow the aggregation to any ancestor; single-file mode: segment doc_path. Both go through the same pathops helpers, which keep the opened workspace folder as the first clickable segment.
        if (props.integration_path) {
            return segmentPathBelowWorkspace(props.integration_path, props.workspace_root);
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

    // folder mode only: "(X in Y files)" after the path, or "(X in Y of M files)" when the discovery cap truncated the set; never in single-file mode (always one file, so the count is meaningless there)
    const file_count_label = useMemo(() => {
        if (!props.integration_path || typeof props.file_count !== 'number') { return undefined; }
        const loaded = props.file_count;
        const notes = props.note_count ?? 0;
        const total = props.aggregate_total_discovered;
        return (typeof total === 'number' && total > loaded)
            ? l10n.t('({0} in {1} of {2} files)', String(notes), String(loaded), String(total))
            : l10n.t('({0} in {1} files)', String(notes), String(loaded));
    }, [props.integration_path, props.file_count, props.note_count, props.aggregate_total_discovered]);

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
                              props.onFolderClick?.(segment.path);
                          }}
                    >
                        {segment.label}
                    </button>
                </Fragment>;
            })}
            {file_count_label && (
                <button className={styles.fileCount}
                      data-testid="breadcrumb-file-count"
                      aria-label={l10n.t('{0} notes in {1} files — open the Files panel', String(props.note_count ?? 0), String(props.file_count ?? 0))}
                      onClick={(event: MouseEvent<HTMLElement>) => {
                          event.stopPropagation();
                          props.onFileCountClick?.(event.currentTarget as HTMLElement);
                      }}
                >
                    {file_count_label}
                </button>
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

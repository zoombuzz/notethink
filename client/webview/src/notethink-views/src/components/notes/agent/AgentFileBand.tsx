import React from "react";
import * as l10n from "@vscode/l10n";
import { vendorMonogram, type ActivityBand, type ActivityUnavailable } from "../../../lib/agentactivityops";
import type { AgentFileEntry } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";
import view_specific_styles from "../../ViewRenderer.module.scss";

/**
 * The uncommitted band of the working tree: files changed and not yet committed, each openable as a
 * live `git:` HEAD diff. There is no stored blob: the analyser reads the working tree itself, rather
 * than receiving one written by an external producer, so a row's diff is never pre-judged as
 * available or not: every click asks the host, and a failure the host reports replaces the row's
 * action line with why.
 *
 * A row is a native button, so Enter, Space and focus order come from the platform rather than a
 * hand-rolled key handler.
 *
 * Attribution is drawn from the analyser's own answer and never guessed. A file no session's write
 * calls account for is marked unattributed and stays on every agent card drawing this repository,
 * because nothing places it on one; crediting it to whichever agent happened to be running is the
 * failure this feature exists to prevent.
 *
 * A band longer than `maxRows` folds its tail into one "and N more" line. With `onToggleExpanded` that
 * line is a control that unfolds every row and is replaced by "Show less", the same expand and collapse
 * the default card's "Show more" bar offers; without it the line only counts what is folded.
 * - maxRows: rows beyond this many fold into the "and N more" line rather than growing the card without bound; undefined shows every row
 * - totalLineDiff: the header's own +added -removed, summed only across entries the analyser actually diffed; absent when none of this band's entries carry a line diff
 * - expanded: every row is drawn despite `maxRows`
 * - onToggleExpanded: asks the owner to expand or collapse the band; undefined leaves the fold uncontrollable
 */
export interface AgentFileBandProps {
    title: string;
    band: ActivityBand;
    entries: ReadonlyArray<AgentFileEntry>;
    emptyLabel: string;
    unavailable: ActivityUnavailable | undefined;
    onOpenDiff: (path: string, band: ActivityBand) => void;
    maxRows?: number;
    totalLineDiff?: { added: number; removed: number };
    expanded?: boolean;
    onToggleExpanded?: (expanded: boolean) => void;
}

/** the host's own answer after an attempt, since the webview cannot know in advance whether a diff will resolve */
function refusalLabel(reason: string): string {
    switch (reason) {
        case 'unknown_root': return l10n.t('No diff: NoteThink has read no working tree for this repository');
        case 'not_listed': return l10n.t('No diff: this file is no longer in the band');
        case 'no_side': return l10n.t('No diff: neither side could be resolved');
        default: return l10n.t('No diff: the editor would not open it');
    }
}

function changeLabel(change: string): string {
    switch (change) {
        case 'added': return l10n.t('added');
        case 'deleted': return l10n.t('deleted');
        case 'renamed': return l10n.t('renamed');
        default: return l10n.t('modified');
    }
}

// every row in the uncommitted band is a change, so the commonest kind needs no word: it takes git's own one-letter status and keeps the word for its tooltip
function changeMark(change: string): string {
    switch (change) {
        case 'modified': return 'M';
        default: return changeLabel(change);
    }
}

/** a file's own +added -removed, or the band header's total; absent when the analyser has not computed (or declined to compute) a line diff for this file */
function LineDiffCounts(props: { added: number | undefined; removed: number | undefined; testid: string }): React.ReactElement | null {
    if (props.added === undefined || props.removed === undefined) { return null; }
    return (
        <span className={styles.lineDiff} data-testid={props.testid}>
            <span className={styles.lineDiffAdded}>{`+${props.added}`}</span>
            {' '}
            <span className={styles.lineDiffRemoved}>{`-${props.removed}`}</span>
        </span>
    );
}

function AgentFileBand(props: AgentFileBandProps): React.ReactElement {
    const foldable = props.maxRows !== undefined && props.entries.length > props.maxRows;
    const expanded = foldable && props.onToggleExpanded !== undefined && props.expanded === true;
    const shown = foldable && !expanded ? props.entries.slice(0, props.maxRows) : props.entries;
    const hidden = props.entries.length - shown.length;
    const toggle = props.onToggleExpanded;
    return (
        <section className={styles.fileBand} data-band={props.band} data-testid={`agent-file-band-${props.band}`}>
            <div className={styles.fileBandHeader}>
                <h4 className={styles.fileBandTitle}>{props.title}</h4>
                {props.totalLineDiff && <LineDiffCounts added={props.totalLineDiff.added} removed={props.totalLineDiff.removed} testid={`agent-file-band-line-diff-${props.band}`} />}
            </div>
            {props.entries.length === 0 && (
                <p className={styles.fileBandEmpty} data-testid={`agent-file-band-empty-${props.band}`}>{props.emptyLabel}</p>
            )}
            <ul className={styles.fileRows}>
                {shown.map(entry => {
                    const refused = props.unavailable?.request === 'diff' && props.unavailable.path === entry.file.path;
                    return (
                        <li key={entry.file.path} className={styles.fileRow} data-testid="agent-file-row" data-attributed={entry.session !== undefined}>
                            <button
                                type="button"
                                className={styles.fileRowButton}
                                data-testid="agent-file-row-button"
                                title={l10n.t('Open this file as a diff')}
                                onClick={(event) => { event.stopPropagation(); props.onOpenDiff(entry.file.path, props.band); }}
                            >
                                <span className={styles.fileAttribution} data-testid="agent-file-attribution">
                                    {entry.session ? vendorMonogram(entry.session.session.vendor) : l10n.t('unattributed')}
                                </span>
                                <span className={styles.filePath}>{entry.file.path}</span>
                                <LineDiffCounts added={entry.file.added} removed={entry.file.removed} testid="agent-file-line-diff" />
                                <span className={styles.fileChange} data-testid="agent-file-change" title={changeLabel(entry.file.change)}>{changeMark(entry.file.change)}</span>
                            </button>
                            {entry.file.previous_path && (
                                <p className={styles.fileDetailLine}>{l10n.t('Renamed from {0}', entry.file.previous_path)}</p>
                            )}
                            {refused && (
                                <p className={styles.fileDetailLine} data-testid="agent-file-no-diff">{refusalLabel(props.unavailable!.reason)}</p>
                            )}
                        </li>
                    );
                })}
            </ul>
            {hidden > 0 && !toggle && (
                <p className={styles.fileBandMore} data-testid={`agent-file-band-more-${props.band}`}>{l10n.t('and {0} more', String(hidden))}</p>
            )}
            {hidden > 0 && toggle && (
                <button
                    type="button"
                    className={`${styles.fileBandToggle} ${view_specific_styles.readMoreToggle}`}
                    data-testid={`agent-file-band-more-${props.band}`}
                    aria-expanded={false}
                    onClick={(event) => { event.stopPropagation(); toggle(true); }}
                >{l10n.t('and {0} more', String(hidden))}</button>
            )}
            {expanded && toggle && (
                <button
                    type="button"
                    className={`${styles.fileBandToggle} ${view_specific_styles.readMoreToggle}`}
                    data-testid={`agent-file-band-less-${props.band}`}
                    aria-expanded={true}
                    onClick={(event) => { event.stopPropagation(); toggle(false); }}
                >{l10n.t('Show less')}</button>
            )}
        </section>
    );
}

export default React.memo(AgentFileBand);

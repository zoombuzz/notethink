import React, { useState } from "react";
import * as l10n from "@vscode/l10n";
import { vendorMonogram, type ActivityBand, type ActivityUnavailable } from "../../../lib/agentactivityops";
import type { AgentFileEntry } from "./useAgentNoteModel";
import Chevron from "../../Chevron";
import styles from "../AgentNote.module.scss";

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
 * The band is one summary row, collapsed by default, that unfolds to every file when clicked. The row is
 * a native button with a `Chevron` and `aria-expanded`, the same disclosure the subagent toggle
 * uses. With `onToggleExpanded` the open state is the owner's, so it survives a re-render; without it
 * the band keeps its own.
 * - totalLineDiff: the summary's own +added -removed, summed only across entries the analyser actually diffed; absent when none of this band's entries carry a line diff
 * - coverageTitle: the summary's hover text, set when some entries carry no line counts so the total is not read as complete
 * - expanded: every row is drawn
 * - onToggleExpanded: asks the owner to expand or collapse the band; undefined leaves the band to its own state
 */
export interface AgentFileBandProps {
    title: string;
    band: ActivityBand;
    entries: ReadonlyArray<AgentFileEntry>;
    unavailable: ActivityUnavailable | undefined;
    onOpenDiff: (path: string, band: ActivityBand) => void;
    totalLineDiff?: { added: number; removed: number };
    coverageTitle?: string;
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

// 'modified' is the commonest change, so it takes git's bare letter; the word stays for the tooltip
function changeMark(change: string): string {
    switch (change) {
        case 'modified': return 'M';
        default: return changeLabel(change);
    }
}

/** a file's own +added -removed, or the band header's total; absent when the analyser has not computed (or declined to compute) a line diff for this file */
export function LineDiffCounts(props: { added: number | undefined; removed: number | undefined; testid: string }): React.ReactElement | null {
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
    const [own_expanded, setOwnExpanded] = useState(false);
    const toggle = props.onToggleExpanded;
    const expanded = toggle ? props.expanded === true : own_expanded;
    const flip = (): void => { if (toggle) { toggle(!expanded); } else { setOwnExpanded(!expanded); } };
    return (
        <section className={styles.fileBand} data-band={props.band} data-testid={`agent-file-band-${props.band}`}>
            <button
                type="button"
                className={styles.fileBandSummary}
                data-testid={`agent-file-band-toggle-${props.band}`}
                aria-expanded={expanded}
                title={props.coverageTitle}
                onClick={(event) => { event.stopPropagation(); flip(); }}
            >
                <Chevron direction={expanded ? "down" : "right"} />
                <span>{props.title}</span>
                {' '}
                {props.totalLineDiff && <LineDiffCounts added={props.totalLineDiff.added} removed={props.totalLineDiff.removed} testid={`agent-file-band-line-diff-${props.band}`} />}
            </button>
            {expanded && (
                <ul className={styles.fileRows}>
                    {props.entries.map(entry => {
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
            )}
        </section>
    );
}

export default React.memo(AgentFileBand);

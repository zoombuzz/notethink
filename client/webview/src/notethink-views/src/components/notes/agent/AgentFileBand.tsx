import React from "react";
import * as l10n from "@vscode/l10n";
import { diffAvailabilityOf, vendorMonogram } from "../../../lib/agentactivityops";
import type { ActivityBand, ActivityDiffAvailability, ActivityUnavailable } from "../../../lib/agentactivityops";
import type { AgentFileEntry } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * One band of the working tree: the files changed and not yet committed, or the files changed by
 * commits on this branch. Both bands are drawn by this component, differing only in their heading and
 * in what a stored diff side means, which `diffAvailabilityOf` resolves.
 *
 * A row is a native button that opens the file as a two-column diff, so Enter, Space and focus order
 * come from the platform rather than from a hand-rolled key handler. A row whose sides the producer
 * did not store opens nothing, and says so in place of the action rather than offering a control that
 * would produce an empty pane; the host's own refusal, which arrives after an attempt, replaces that
 * line when it lands.
 *
 * Attribution is drawn from the producer's own answer and never guessed. A file no session's write
 * calls account for is marked unattributed and stays on every agent card drawing this contract root,
 * because nothing places it on one; crediting it to whichever agent happened to be running is the
 * failure this contract names.
 */
export interface AgentFileBandProps {
    title: string;
    band: ActivityBand;
    entries: ReadonlyArray<AgentFileEntry>;
    emptyLabel: string;
    unavailable: ActivityUnavailable | undefined;
    onOpenDiff: (path: string, band: ActivityBand) => void;
}

/** what a diff of this row would show, in words, so an unopenable diff says why rather than opening an empty pane */
function availabilityLabel(availability: ActivityDiffAvailability): string {
    switch (availability) {
        case 'both_sides': return l10n.t('Both sides stored');
        case 'added_no_base': return l10n.t('New file, so there is no earlier side');
        case 'omitted_binary': return l10n.t('No diff: the earlier side is binary and was not stored');
        case 'omitted_size': return l10n.t('No diff: the earlier side was too large to store');
        default: return l10n.t('No diff: the producer stored no side');
    }
}

/** the host's own answer after an attempt, which outranks what the card could tell from the contract alone */
function refusalLabel(reason: string): string {
    switch (reason) {
        case 'unknown_root': return l10n.t('No diff: NoteThink has read no working tree for this repository');
        case 'not_listed': return l10n.t('No diff: this file is no longer in the band');
        case 'omitted_binary': return l10n.t('No diff: the earlier side is binary and was not stored');
        case 'omitted_size': return l10n.t('No diff: the earlier side was too large to store');
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

function AgentFileBand(props: AgentFileBandProps): React.ReactElement {
    return (
        <section className={styles.fileBand} data-band={props.band} data-testid={`agent-file-band-${props.band}`}>
            <h4 className={styles.fileBandTitle}>{props.title}</h4>
            {props.entries.length === 0 && (
                <p className={styles.fileBandEmpty} data-testid={`agent-file-band-empty-${props.band}`}>{props.emptyLabel}</p>
            )}
            <ul className={styles.fileRows}>
                {props.entries.map(entry => {
                    const availability = diffAvailabilityOf(entry.file, props.band);
                    const refused = props.unavailable?.request === 'diff' && props.unavailable.path === entry.file.path;
                    const openable = availability === 'both_sides' || availability === 'added_no_base';
                    return (
                        <li key={entry.file.path} className={styles.fileRow} data-testid="agent-file-row" data-attributed={entry.session !== undefined}>
                            <button
                                type="button"
                                className={styles.fileRowButton}
                                data-testid="agent-file-row-button"
                                disabled={!openable}
                                title={openable ? l10n.t('Open this file as a diff') : availabilityLabel(availability)}
                                onClick={(event) => { event.stopPropagation(); props.onOpenDiff(entry.file.path, props.band); }}
                            >
                                <span className={styles.fileAttribution} data-testid="agent-file-attribution">
                                    {entry.session ? vendorMonogram(entry.session.session.vendor) : l10n.t('unattributed')}
                                </span>
                                <span className={styles.filePath}>{entry.file.path}</span>
                                <span className={styles.fileChange}>{changeLabel(entry.file.change)}</span>
                            </button>
                            {entry.file.previous_path && (
                                <p className={styles.fileDetailLine}>{l10n.t('Renamed from {0}', entry.file.previous_path)}</p>
                            )}
                            {(refused || !openable) && (
                                <p className={styles.fileDetailLine} data-testid="agent-file-no-diff">
                                    {refused ? refusalLabel(props.unavailable!.reason) : availabilityLabel(availability)}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default React.memo(AgentFileBand);

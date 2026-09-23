import React from "react";
import * as l10n from "@vscode/l10n";
import { vendorMonogram } from "../../../lib/agentactivityops";
import type { AgentCommitEntry } from "./useAgentNoteModel";
import styles from "../AgentNote.module.scss";

/**
 * The committed band: commits on this branch, credited to whichever session's own `git commit` call
 * made them. Unlike the uncommitted band this lists commits rather than files, so a row states its
 * subject rather than opening a diff: a commit's own file list is a `git show` away for a reader who
 * wants it, not a second table this card has to keep current.
 */
export interface AgentCommitBandProps {
    title: string;
    entries: ReadonlyArray<AgentCommitEntry>;
    emptyLabel: string;
}

function AgentCommitBand(props: AgentCommitBandProps): React.ReactElement {
    return (
        <section className={styles.fileBand} data-band="committed" data-testid="agent-commit-band">
            <h4 className={styles.fileBandTitle}>{props.title}</h4>
            {props.entries.length === 0 && (
                <p className={styles.fileBandEmpty} data-testid="agent-commit-band-empty">{props.emptyLabel}</p>
            )}
            <ul className={styles.fileRows}>
                {props.entries.map(entry => (
                    <li key={entry.commit.sha} className={`${styles.fileRow} ${styles.commitRow}`} data-testid="agent-commit-row" data-attributed={entry.session !== undefined}>
                        <span className={styles.fileAttribution} data-testid="agent-commit-attribution">
                            {entry.session ? vendorMonogram(entry.session.session.vendor) : l10n.t('unattributed')}
                        </span>
                        <span className={styles.commitSubject} data-testid="agent-commit-subject" title={`${entry.commit.subject}\n${entry.commit.sha}`}>{entry.commit.subject}</span>
                        <span className={styles.fileChange}>{entry.commit.sha.slice(0, 8)}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default React.memo(AgentCommitBand);

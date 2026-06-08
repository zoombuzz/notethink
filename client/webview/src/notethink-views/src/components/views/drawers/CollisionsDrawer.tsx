import Debug from "debug";
import React from "react";
import type { ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { collisionNoteLocation } from "../../../lib/noteops";
import type { StableIdCollision } from "../../../lib/noteops";
import type { NoteProps } from "../../../types/NoteProps";
import styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:CollisionsDrawer");

interface CollisionsDrawerProps {
    collisions: StableIdCollision[];
    onRevealNote?: (note: NoteProps) => void;
}

/**
 * Collisions drawer: lists the slugs whose stable_id is shared by two or more story-level
 * notes, with each colliding note's headline and source origin (relative_path:line). Each
 * headline is a link that calls onRevealNote to jump the editor to that story so the user
 * can rename it and break the duplicate. Built from findStableIdCollisions upstream; the
 * drawer only opens when at least one collision exists, but it renders a defensive
 * empty-state row when handed an empty list.
 */
function CollisionsDrawer(props: CollisionsDrawerProps): ReactElement {
    debug("rendering %d collision group(s)", props.collisions.length);

    return (
        <div className={styles.drawerBody} data-testid="collisions-drawer">
            <div className={styles.drawerGroups}>
                <section className={styles.drawerGroup}>
                    <p>{l10n.t('Duplicate IDs')}</p>
                    <ul className={styles.drawerList} data-testid="collisions-drawer-list">
                        {props.collisions.length === 0 && (
                            <li className={styles.drawerEmpty} data-testid="collisions-drawer-empty">
                                {l10n.t('No duplicate IDs')}
                            </li>
                        )}
                        {props.collisions.map(collision => (
                            <li key={collision.slug} className={styles.collisionsDrawerGroup}>
                                <span className={styles.collisionsDrawerSlug}>{collision.slug}</span>
                                <ul className={styles.collisionsDrawerNotes}>
                                    {collision.notes.map((note, index) => {
                                        const location = collisionNoteLocation(note);
                                        return (
                                            <li key={note.stable_id ?? `${collision.slug}-${index}`}>
                                                {/* whole row is one explorer-style link to the story */}
                                                {/* folder mode shows the source file; single-file shows nothing (file implicit), line intentionally hidden */}
                                                <button
                                                    type="button"
                                                    className={`${styles.drawerLink} ${styles.collisionsDrawerNote}`}
                                                    data-testid="collisions-drawer-note"
                                                    title={l10n.t('Open this story in the editor')}
                                                    onClick={() => props.onRevealNote?.(note)}
                                                >
                                                    <span className={styles.collisionsDrawerHeadline}>{location.headline}</span>
                                                    {location.relative_path && (
                                                        <span className={styles.collisionsDrawerOrigin}>{location.relative_path}</span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>

            <aside className={styles.drawerMeta}>
                <h3>{l10n.t('Collisions')}</h3>
            </aside>
        </div>
    );
}

export default React.memo(CollisionsDrawer);

import Debug from "debug";
import React, { useEffect, useState, type MouseEvent } from "react";
import { detectThemeAttribute, originPillColour, pillColourForHue, projectAbbreviation, projectNameFromRelativePath } from "../../lib/originops";
import type { NoteOrigin } from "../../types/NoteProps";
import styles from "./OriginPill.module.scss";

const debug = Debug("nodejs:notethink-views:OriginPill");

interface OriginPillProps {
    origin: NoteOrigin;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Origin pill: shown next to a story's headline in folder mode.
 *
 * Renders a project pill (two uppercase letters derived from origin.relative_path's
 * first path segment) followed by an optional epic pill (epic.name) when origin.epic
 * is set. The first letter is always the project name's initial; the second is the
 * earliest character that disambiguates this project from every other one visible in
 * the folder view (e.g. notegit→`NG`, notethink→`NT`, countingsheet→`CO`). Project pill
 * colour is deterministic per project name; theme-adaptive for dark/light.
 *
 * Pure helpers (label derivation, hue assignment, theme detection) live in
 * `../../lib/originops` so they can be reused by the folder-mode merge pipeline
 * and unit-tested without mounting a renderer.
 */
export default function OriginPill({ origin, onClick }: OriginPillProps): React.ReactElement {
    // re-render on theme change so colour swatches stay readable when the user toggles VS Code theme
    const [theme, setTheme] = useState<'dark' | 'light'>(detectThemeAttribute);
    useEffect(() => {
        if (typeof document === 'undefined') { return; }
        const observer = new MutationObserver(() => {
            setTheme(detectThemeAttribute());
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
        return () => observer.disconnect();
    }, []);

    const project_name = projectNameFromRelativePath(origin.relative_path);
    // folder mode stamps origin.project_label using the global divergence rule (see buildProjectLabels); single-file / legacy origins fall back to the project name's first+second characters
    const label = origin.project_label ?? projectAbbreviation(project_name);
    // folder mode stamps origin.project_hue from the sorted-index assignment in mergeAggregateRoot; fall back to the hash-based colour for legacy origins or single-file mode where no global enumeration exists
    const colour = typeof origin.project_hue === 'number'
        ? pillColourForHue(origin.project_hue, theme)
        : originPillColour(project_name || origin.doc_path, theme);

    return (
        <span className={styles.originPillGroup} role="presentation">
            <span
                className={styles.projectPill}
                style={{ backgroundColor: colour }}
                title={origin.relative_path ?? origin.doc_path}
                data-testid="origin-project-pill"
                data-project={project_name}
                onClick={onClick}
            >
                {label}
            </span>
            {origin.epic && (
                <span
                    className={styles.epicPill}
                    title={origin.epic.id ? `Epic: ${origin.epic.name} (id: ${origin.epic.id})` : `Epic: ${origin.epic.name}`}
                    data-testid="origin-epic-pill"
                    data-epic-id={origin.epic.id}
                >
                    {origin.epic.name}
                </span>
            )}
        </span>
    );
}

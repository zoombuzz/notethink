import Debug from "debug";
import React, { useEffect, useState, type MouseEvent } from "react";
import type { NoteOrigin } from "../../types/NoteProps";
import styles from "./OriginPill.module.scss";

const debug = Debug("nodejs:notethink-views:OriginPill");

interface OriginPillProps {
    origin: NoteOrigin;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
}

// golden angle (≈ 360 - 360/φ). Used to spread sorted-index inputs around the hue wheel so adjacent indices land ~137° apart, far from each other on the colour wheel
const GOLDEN_ANGLE_DEG = 137.50776405003785;

/**
 * Origin pill: shown next to a story's headline in folder mode.
 *
 * Renders a project pill (two uppercase letters derived from origin.relative_path's
 * first path segment) followed by an optional epic pill (epic.name) when origin.epic
 * is set. The first letter is always the project name's initial; the second is the
 * earliest character that disambiguates this project from every other one visible in
 * the folder view (e.g. notegit→`NG`, notethink→`NT`, countingsheet→`CO`). Project pill
 * colour is deterministic per project name; theme-adaptive for dark/light.
 */

/**
 * djb2-style hash of a string to a 32-bit integer (sign-collapsed). Used as a fallback only — see hueForProjectIndex for the primary assignment.
 */
function djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * Deterministic hue (0-359) for a project given its 0-based index in a stable sorted enumeration of all distinct project names visible in the folder view. Using a golden-angle multiplier instead of a hash-mod ensures any number of projects get visually-distinct hues — hash%360 happens to collide for our real-world names (calfam/shopify-uncomplicated, notegit/countingsheet).
 */
export function hueForProjectIndex(index: number): number {
    // floor + non-negative modulo so negative indices don't break the result
    const v = (index * GOLDEN_ANGLE_DEG) % 360;
    return Math.floor(v < 0 ? v + 360 : v);
}

/**
 * Turn a hue value (0-359) into the final HSL string at the theme-appropriate lightness.
 */
export function pillColourForHue(hue: number, theme: 'dark' | 'light'): string {
    const lightness = theme === 'dark' ? 32 : 72;
    return `hsl(${hue} 65% ${lightness}%)`;
}

/**
 * Deterministic colour for a project pill from the project name only — fallback when the merged origin doesn't carry a precomputed hue (single-file mode, legacy origins, tests). Uses djb2(name)%360 which can collide for some name pairs; folder-mode callers should use hueForProjectIndex via origin.project_hue instead.
 */
export function originPillColour(project_name: string, theme: 'dark' | 'light'): string {
    return pillColourForHue(djb2(project_name) % 360, theme);
}

/**
 * Extract the project name from a relative_path. For `oma/docstech/users/alex/todo.md`
 * the project is `oma`. Falls back to the full relative_path if no `/` is present.
 */
export function projectNameFromRelativePath(relative_path: string | undefined): string {
    if (!relative_path) { return ''; }
    const idx = relative_path.indexOf('/');
    return idx === -1 ? relative_path : relative_path.slice(0, idx);
}

/**
 * Compute the absolute folder path to descend the folder view into when this pill is clicked.
 *
 * Returns the workspace-folder root joined with the pill's project segment — the folder
 * whose contents the pill represents (e.g. `/path/to/active_development/notethink` for a
 * pill whose origin sits at `notethink/docstech/users/alex/todo.md` inside the
 * `active_development` workspace folder). Derives the root by stripping the
 * `relative_path` suffix from `doc_path`, so the rule works for any workspace layout
 * without assuming a particular root name.
 *
 * Returns an empty string when descent is not meaningful: missing relative_path,
 * relative_path with no `/` (file lives directly at the workspace-folder root, so
 * there is no sub-project to descend into), or missing doc_path.
 */
export function projectFolderFromOrigin(origin: NoteOrigin): string {
    const project_segment = projectNameFromRelativePath(origin.relative_path);
    if (!project_segment || !origin.relative_path || !origin.doc_path) { return ''; }
    if (!origin.relative_path.includes('/')) { return ''; }
    if (!origin.doc_path.endsWith(origin.relative_path)) { return ''; }
    const workspace_root = origin.doc_path.slice(0, origin.doc_path.length - origin.relative_path.length).replace(/\/$/, '');
    if (!workspace_root) { return ''; }
    return `${workspace_root}/${project_segment}`;
}

/**
 * Single-project abbreviation used as a fallback in single-file mode or when the
 * merged origin doesn't carry a precomputed label. First char + second char of the
 * project name, both uppercased; a single-letter name yields the single letter; an
 * empty name yields '?'.
 */
export function projectAbbreviation(project_name: string | undefined): string {
    if (!project_name) { return '?'; }
    const first = project_name.charAt(0).toUpperCase();
    if (project_name.length < 2) { return first; }
    return first + project_name.charAt(1).toUpperCase();
}

/**
 * Compute a 2-character label per project across the supplied list. The first
 * character is always the project name's initial. The second character is taken
 * from the smallest index i >= 1 at which no other name in the set shares the
 * prefix `name.slice(0, i + 1)` — i.e. the earliest character that
 * differentiates this project from any other (so notegit vs notethink emit
 * `NG` and `NT` rather than two `N`s). If a name is a strict prefix of another
 * (no divergence found), we fall back to the second character of the name
 * itself. Names shorter than 2 chars produce single-letter labels.
 */
export function buildProjectLabels(names: string[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const name of names) {
        if (!name || labels.has(name)) { continue; }
        const first = name.charAt(0).toUpperCase();
        if (name.length < 2) {
            labels.set(name, first);
            continue;
        }
        let chosen_i = -1;
        for (let i = 1; i < name.length; i++) {
            const prefix = name.slice(0, i + 1);
            let collides = false;
            for (const other of names) {
                if (other === name) { continue; }
                if (other.startsWith(prefix)) { collides = true; break; }
            }
            if (!collides) { chosen_i = i; break; }
        }
        // name is a strict prefix of another project — fall back to the second char of name itself
        if (chosen_i === -1) { chosen_i = 1; }
        labels.set(name, first + name.charAt(chosen_i).toUpperCase());
    }
    return labels;
}

/**
 * Read the current Mantine color scheme from <html data-mantine-color-scheme>.
 * Defaults to 'dark' if the attribute is missing.
 */
function detectThemeAttribute(): 'dark' | 'light' {
    if (typeof document === 'undefined') { return 'dark'; }
    const scheme = document.documentElement.getAttribute('data-mantine-color-scheme');
    return scheme === 'light' ? 'light' : 'dark';
}

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

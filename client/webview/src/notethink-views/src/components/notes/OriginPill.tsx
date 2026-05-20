import Debug from "debug";
import { MouseEvent, useEffect, useState } from "react";
import type { NoteOrigin } from "../../types/NoteProps";
import styles from "./OriginPill.module.scss";
const debug = Debug("nodejs:notethink-views:OriginPill");

/**
 * Origin pill: shown next to a story's headline in aggregate (folder) mode.
 *
 * Renders a project pill (single uppercase letter from origin.relative_path's first
 * path segment) followed by an optional epic pill (epic.name) when origin.epic is set.
 * Project pill colour is deterministic per project name; theme-adaptive for dark/light.
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

// golden angle (≈ 360 - 360/φ). Used to spread sorted-index inputs around the hue wheel so adjacent indices land ~137° apart, far from each other on the colour wheel
const GOLDEN_ANGLE_DEG = 137.50776405003785;

/**
 * Deterministic hue (0-359) for a project given its 0-based index in a stable sorted enumeration of all distinct project names visible in the aggregate. Using a golden-angle multiplier instead of a hash-mod ensures any number of projects get visually-distinct hues — hash%360 happens to collide for our real-world names (calfam/shopify-uncomplicated, notegit/countingsheet).
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
 * Deterministic colour for a project pill from the project name only — fallback when the merged origin doesn't carry a precomputed hue (single-file mode, legacy origins, tests). Uses djb2(name)%360 which can collide for some name pairs; aggregate-mode callers should use hueForProjectIndex via origin.project_hue instead.
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
 * Read the current Mantine color scheme from <html data-mantine-color-scheme>.
 * Defaults to 'dark' if the attribute is missing.
 */
function detectThemeAttribute(): 'dark' | 'light' {
    if (typeof document === 'undefined') { return 'dark'; }
    const scheme = document.documentElement.getAttribute('data-mantine-color-scheme');
    return scheme === 'light' ? 'light' : 'dark';
}

interface OriginPillProps {
    origin: NoteOrigin;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
}

export default function OriginPill({ origin, onClick }: OriginPillProps) {
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
    const letter = project_name ? project_name.charAt(0).toUpperCase() : '?';
    // aggregate mode stamps origin.project_hue from the sorted-index assignment in mergeAggregateRoot; fall back to the hash-based colour for legacy origins or single-file mode where no global enumeration exists
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
                {letter}
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

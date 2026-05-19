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
 * djb2-style hash of a string to a 32-bit integer (sign-collapsed).
 */
function djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * Deterministic colour for a project pill.
 *
 * - hue: derived from a djb2 hash of the full project name (spread across the spectrum)
 * - saturation: 65% (visible spread, no neon)
 * - lightness: dark 32% (white text on dark theme); light 72% (dark text on light theme)
 */
export function originPillColour(project_name: string, theme: 'dark' | 'light'): string {
    const hue = djb2(project_name) % 360;
    const lightness = theme === 'dark' ? 32 : 72;
    return `hsl(${hue} 65% ${lightness}%)`;
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
    const colour = originPillColour(project_name || origin.doc_path, theme);

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

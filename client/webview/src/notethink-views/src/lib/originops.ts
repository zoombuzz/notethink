import Debug from "debug";
import type { NoteOrigin } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:originops");

/**
 * Pure helpers backing the OriginPill JSX component. Lifted out of OriginPill.tsx
 * so the React component stays JSX-only and these functions can be reused by the
 * folder-mode merge pipeline (mergeAggregateRoot) and unit-tested without
 * mounting a renderer.
 *
 * Covers: project name extraction, project-folder derivation, label/abbreviation
 * derivation across a set of project names, and theme-aware pill colour
 * computation (identity-hash based on project name, set-independent).
 */

/**
 * djb2-style hash of a string to a 32-bit integer (sign-collapsed). Primary hue
 * assignment: produces a deterministic, set-independent hue for any project name.
 */
function djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * Deterministic hue (0-359) for a project from its name alone — set-independent
 * so the colour cannot change as the workspace universe fills in on first paint.
 * Same name always produces the same hue regardless of which other projects are
 * visible.
 */
export function hueForProjectName(name: string): number {
    return djb2(name) % 360;
}

/**
 * Turn a hue value (0-359) into the final HSL string at the theme-appropriate lightness.
 */
export function pillColourForHue(hue: number, theme: 'dark' | 'light'): string {
    const lightness = theme === 'dark' ? 32 : 72;
    return `hsl(${hue} 65% ${lightness}%)`;
}

/**
 * Deterministic colour for a project pill from the project name only. Uses
 * hueForProjectName (djb2 identity hash) so the colour is set-independent —
 * single-file mode, folder mode, and legacy origins all converge on the same
 * value for a given project name.
 */
export function originPillColour(project_name: string, theme: 'dark' | 'light'): string {
    return pillColourForHue(hueForProjectName(project_name), theme);
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
 * differentiates this project from any other (so `notebook` vs `notethink` emit
 * `NB` and `NT` rather than two `N`s). If a name is a strict prefix of another
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
export function detectThemeAttribute(): 'dark' | 'light' {
    if (typeof document === 'undefined') { return 'dark'; }
    const scheme = document.documentElement.getAttribute('data-mantine-color-scheme');
    return scheme === 'light' ? 'light' : 'dark';
}

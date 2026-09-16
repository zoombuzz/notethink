import type { NoteOrigin } from "../types/NoteProps";

// the <body> classes VS Code stamps on a webview for a light theme; mirrored as the light selectors in OriginPill.module.scss and StickyNote.module.scss
export const VS_CODE_LIGHT_THEME_CLASSES = ['vscode-light', 'vscode-high-contrast-light'];

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
 * Deterministic hue (0-359) for a project from its name alone - set-independent
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
 * True when an origin links its note to a project, which is when the headline draws a
 * project pill rather than an epic chip alone. Folder-mode origins carry project metadata;
 * single-file story cards carry only an epic. Every surface that asks "does this note have
 * a project" reads this, so the pill and anything coloured by project agree.
 */
export function originHasProject(origin: NoteOrigin | undefined): origin is NoteOrigin {
    return !!(origin && (origin.relative_path || origin.project_label || origin.project_hue !== undefined));
}

/**
 * The hue a project is drawn in, for the project pill and for anything coloured to match it.
 * The djb2 identity hash mergeAggregateRoot stamps as project_hue wins; without it the same
 * hash is taken from the project name (or the doc path when the name is empty), so single-file,
 * folder and legacy origins all converge on one hue for a given project.
 */
export function hueForOrigin(origin: NoteOrigin): number {
    if (typeof origin.project_hue === 'number') { return origin.project_hue; }
    return hueForProjectName(projectNameFromRelativePath(origin.relative_path) || origin.doc_path);
}

/**
 * Extract the project name from a relative_path. For `orbit/docstech/users/alex/todo.md`
 * the project is `orbit`. Falls back to the full relative_path if no `/` is present.
 */
export function projectNameFromRelativePath(relative_path: string | undefined): string {
    if (!relative_path) { return ''; }
    const idx = relative_path.indexOf('/');
    return idx === -1 ? relative_path : relative_path.slice(0, idx);
}

/**
 * Compute the absolute folder path to descend the folder view into when this pill is clicked.
 *
 * Returns the workspace-folder root joined with the pill's project segment - the folder
 * whose contents the pill represents (e.g. `/path/to/in_development/notethink` for a
 * pill whose origin sits at `notethink/docstech/users/alex/todo.md` inside the
 * `in_development` workspace folder). Derives the root by stripping the
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
 * prefix `name.slice(0, i + 1)` - i.e. the earliest character that
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
        // name is a strict prefix of another project - fall back to the second char of name itself
        if (chosen_i === -1) { chosen_i = 1; }
        labels.set(name, first + name.charAt(chosen_i).toUpperCase());
    }
    return labels;
}

/**
 * Read the current VS Code theme kind from the class VS Code stamps on a webview's <body>:
 * `vscode-light` and `vscode-high-contrast-light` are light, and every other theme,
 * including a body with no theme class at all, is dark. VS_CODE_LIGHT_THEME_CLASSES
 * lists the light ones so a stylesheet and this function name the same classes.
 */
export function detectVscodeTheme(): 'dark' | 'light' {
    if (typeof document === 'undefined' || !document.body) { return 'dark'; }
    const is_light = VS_CODE_LIGHT_THEME_CLASSES.some(name => document.body.classList.contains(name));
    return is_light ? 'light' : 'dark';
}

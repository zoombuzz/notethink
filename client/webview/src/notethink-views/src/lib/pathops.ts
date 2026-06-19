import Debug from "debug";

const debug = Debug("nodejs:notethink-views:pathops");

/**
 * Pure path-segmentation helpers used by breadcrumb rendering and origin-pill
 * navigation. All functions are deterministic string operations - no IO, no DOM,
 * no React. The helpers unify two previously-duplicated derivations:
 *
 *   1. workspace_root from (doc_path, relative_path) - collapses
 *      `OriginPill.projectFolderFromOrigin` and `BreadcrumbTrail.splitPathSegments`.
 *   2. absolute-path → breadcrumb segments - collapses the two independent
 *      "split on '/', accumulate, prepend root label" branches that used to live
 *      in `BreadcrumbTrail` (one for single-file doc paths, one for the
 *      folder-mode integration path).
 */

/**
 * Breadcrumb segment: { label, path } where `label` is the visible text and
 * `path` is the absolute path that clicking the segment should navigate to.
 */
export interface PathSegment {
    label: string;
    path: string;
}

/**
 * Infer the workspace root by stripping a known relative_path suffix off a
 * doc_path. Returns '' when the suffix doesn't actually match the end of
 * doc_path (defensive: callers should not act on the result) or when either
 * input is empty.
 *
 * Mirrors the derivation that used to live inline in
 * `OriginPill.projectFolderFromOrigin` and `BreadcrumbTrail.splitPathSegments`.
 */
export function workspaceRootFromDocAndRelative(doc_path: string | undefined, relative_path: string | undefined): string {
    if (!doc_path || !relative_path) { return ''; }
    if (!doc_path.endsWith(relative_path)) { return ''; }
    return doc_path.slice(0, doc_path.length - relative_path.length).replace(/\/$/, '');
}

/**
 * Segment an absolute path into clickable breadcrumb pieces, with the opened
 * workspace folder kept as the first segment so it is itself clickable
 * (selecting it re-narrows to the whole opened workspace folder, not just the
 * first child).
 *
 * Given `absolute_path = "/abs/active_development/notethink/docs/todo.md"` and
 * `workspace_root = "/abs/active_development/notethink"`, returns segments for
 * `active_development`, `notethink`, `docs`, `todo.md` (i.e. the workspace
 * root's own label is included). The `path` on each segment is the absolute
 * path that segment represents.
 *
 * When `workspace_root` is missing or `absolute_path` does not sit under it,
 * falls back to segmenting from `/` with no leading workspace-folder label.
 */
export function segmentPathBelowWorkspace(absolute_path: string, workspace_root?: string): PathSegment[] {
    // strip workspace_root's PARENT (one level up) so the workspace folder itself becomes the first clickable segment
    const within_workspace = !!workspace_root && absolute_path.startsWith(workspace_root);
    const workspace_parent = within_workspace
        ? workspace_root!.replace(/\/[^/]*\/?$/, '')
        : '';
    const stripped = within_workspace
        ? absolute_path.slice(workspace_parent.length)
        : absolute_path;
    const parts = stripped.split('/').filter(Boolean);
    const segments: PathSegment[] = [];
    let accumulated = workspace_parent;
    for (const part of parts) {
        accumulated += '/' + part;
        segments.push({ label: part, path: accumulated });
    }
    return segments;
}

/**
 * Resolve an `nt_breadcrumb_last` folder label against the opened file's path trail.
 * Segments `doc_path` below the workspace root (the same trail the breadcrumb renders) and
 * returns the absolute path of the DEEPEST segment whose label matches `label`. Deepest wins
 * so a duplicate label (e.g. a `portfolio/portfolio` nesting) scopes to the lower folder,
 * matching "click the rightmost matching breadcrumb segment".
 *
 * The match is exact and case-sensitive on the segment label. The terminal segment (the file
 * itself) is excluded - a breadcrumb folder scope only ever names a folder, never the open
 * file. Returns undefined when no folder segment matches (caller falls back to the note-seq
 * resolver, then to the default scope).
 */
export function resolveBreadcrumbFolderSegment(
    label: string,
    doc_path: string | undefined,
    workspace_root?: string,
    doc_relative_path?: string,
): string | undefined {
    if (!label || !doc_path) { return undefined; }
    const segments = splitPathSegments(doc_path, workspace_root, doc_relative_path);
    // exclude the terminal segment (the file) - breadcrumb_last names a folder, not the open file
    const folder_segments = segments.slice(0, -1);
    let match: string | undefined;
    for (const segment of folder_segments) {
        if (segment.label === label) { match = segment.path; }
    }
    return match;
}

/**
 * Single-file breadcrumb segmentation. Prefers `doc_relative_path` (computed by
 * the extension via VS Code's `asRelativePath`, which handles symlinks
 * correctly); falls back to stripping `workspace_root` off `doc_path` manually;
 * falls back again to segmenting from `/` when neither is available.
 *
 * The opened workspace folder itself is kept as the first clickable breadcrumb
 * segment (so clicking `active_development` re-roots there rather than starting
 * at its first child).
 */
export function splitPathSegments(doc_path: string, workspace_root?: string, doc_relative_path?: string): PathSegment[] {
    // resolve the effective workspace root: extension-provided relative path is most reliable, then the workspace_root prop, then nothing
    let effective_root: string | undefined;
    if (doc_relative_path) {
        const inferred = workspaceRootFromDocAndRelative(doc_path, doc_relative_path);
        effective_root = inferred || undefined;
    } else if (workspace_root && doc_path.startsWith(workspace_root)) {
        effective_root = workspace_root;
    }
    return segmentPathBelowWorkspace(doc_path, effective_root);
}

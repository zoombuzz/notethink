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
 * Whether `file_path` sits inside (or is) the folder at `folder_path`. Gates the reactive
 * auto-integration exit: switching the active editor to a file OUTSIDE the current folder scope
 * drops the board to current_file, while revealing a member file INSIDE the scope (e.g. a kanban
 * card click) keeps the board. A path equal to the folder counts as inside (defensive). Empty
 * inputs are treated as not-inside.
 */
export function isPathWithinFolder(file_path: string | undefined, folder_path: string | undefined): boolean {
    if (!file_path || !folder_path) { return false; }
    return file_path === folder_path || file_path.startsWith(folder_path.endsWith('/') ? folder_path : folder_path + '/');
}

/**
 * The parent folder of an absolute path (everything before the last `/`). Returns undefined when the
 * path is empty, has no separator, or is already a bare segment. Used for a file's own folder (the
 * folder a concrete folder-pin or a folder-declaring file scopes to).
 */
export function parentFolderOf(file_path: string | undefined): string | undefined {
    if (!file_path) { return undefined; }
    const folder = file_path.replace(/\/[^/]+$/, '');
    return folder && folder !== file_path ? folder : undefined;
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
 * The breadcrumb segment trail a view renders. In folder mode `integration_path` is set and the
 * aggregation folder itself is segmented, so clicking a segment re-narrows the aggregation; in
 * single-file mode the opened file's path is segmented instead. Both branches keep the opened
 * workspace folder as the first clickable segment. Returns [] when there is nothing to segment.
 *
 * Shared so the rendered breadcrumb and the toolbar's Jump to tab resolve the same terminal leaf.
 */
export function breadcrumbSegmentsForView(
    integration_path: string | undefined,
    doc_path: string | undefined,
    workspace_root?: string,
    doc_relative_path?: string,
): PathSegment[] {
    if (integration_path) {
        return segmentPathBelowWorkspace(integration_path, workspace_root);
    }
    return doc_path ? splitPathSegments(doc_path, workspace_root, doc_relative_path) : [];
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

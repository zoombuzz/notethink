/**
 * Maps a session's own real root tree onto a workspace folder opened through a symlinked alias. Every
 * vendor records a session's `cwd`, and every path it touches, as the real filesystem path (measured:
 * Claude Code's own pid file and transcript `cwd`, Codex's `session_meta.cwd`, Grok's encoded session
 * directory name are all real paths), but `vscode.workspace.workspaceFolders` carries whichever path
 * VS Code was pointed at, alias included, so an ordinary prefix test between the two never matches
 * when the workspace was opened through a symlink.
 *
 * A session's `cwd` is usually a project folder nested inside the aliased tree rather than the tree's
 * own root - the ordinary multi-project case, where the workspace folder is a parent directory and each
 * session's cwd is one of its children - so the alias is found by walking up from `cwd` through its
 * ancestors rather than by comparing `cwd` itself against each workspace folder. `bestAliasMapping`
 * finds the ancestor-or-self of a real path, and the workspace folder, that share the most trailing
 * path segments; it is only a hint, since two unrelated directory trees can legitimately share their
 * final segments (a "lookalike tree"). The caller must still confirm the mapping with a filesystem
 * probe - checking that a file the session actually touched resolves under the aliased root too -
 * before trusting it.
 */

// how many trailing path segments `real_path` and `candidate_root` share, read from the end of each
export function trailingSegmentMatchCount(real_path: string, candidate_root: string): number {
    const real_segments = real_path.split('/').filter(segment => segment.length > 0);
    const candidate_segments = candidate_root.split('/').filter(segment => segment.length > 0);
    let count = 0;
    while (
        count < real_segments.length &&
        count < candidate_segments.length &&
        real_segments[real_segments.length - 1 - count] === candidate_segments[candidate_segments.length - 1 - count]
    ) {
        count++;
    }
    return count;
}

// `real_path` itself, then each of its ancestor directories in turn, ordered from deepest to shallowest
function ancestorsAndSelf(real_path: string): string[] {
    const segments = real_path.split('/').filter(segment => segment.length > 0);
    const ancestors: string[] = [];
    for (let depth = segments.length; depth > 0; depth--) {
        ancestors.push(`/${segments.slice(0, depth).join('/')}`);
    }
    return ancestors;
}

/**
 * A real filesystem root paired with the alias root a workspace folder reaches the same tree through.
 * - real_root: an ancestor of, or exactly, the real path `bestAliasMapping` was given
 * - alias_root: the candidate root it matched, as `vscode.workspace.workspaceFolders` names it
 */
export interface AliasRootMapping {
    real_root: string;
    alias_root: string;
}

/**
 * The best-matching `{ real_root, alias_root }` pairing for `real_path` among `candidate_roots`, found
 * by trailing path segments. `real_path` and each of its ancestors are each compared against every
 * candidate in turn, so a project folder nested inside the aliased tree still matches through one of
 * its parents even though it shares no trailing segment with the workspace folder itself. A candidate
 * `real_path` already matches by ordinary prefix is excluded (nothing to alias there), and at least one
 * trailing segment must match. Ties break on the highest segment count, then the longer candidate root,
 * then alphabetically, and finally on the deepest ancestor when the same candidate matches more than
 * one ancestor at an equal count.
 */
export function bestAliasMapping(real_path: string, candidate_roots: readonly string[]): AliasRootMapping | undefined {
    const eligible_roots = candidate_roots.filter(root => real_path !== root && !real_path.startsWith(`${root}/`));
    let best: { real_root: string; alias_root: string; match_count: number } | undefined;
    for (const ancestor of ancestorsAndSelf(real_path)) {
        for (const root of eligible_roots) {
            const match_count = trailingSegmentMatchCount(ancestor, root);
            if (match_count === 0) { continue; }
            const better = !best
                || match_count > best.match_count
                || (match_count === best.match_count && root.length > best.alias_root.length)
                || (match_count === best.match_count && root.length === best.alias_root.length && root < best.alias_root);
            if (better) { best = { real_root: ancestor, alias_root: root, match_count }; }
        }
    }
    return best ? { real_root: best.real_root, alias_root: best.alias_root } : undefined;
}

/** `absolute_path` rewritten from under `real_root` onto `alias_root`, unchanged when it is not under `real_root` at all */
export function remapUnderRoot(absolute_path: string, real_root: string, alias_root: string): string {
    if (absolute_path === real_root) { return alias_root; }
    if (absolute_path.startsWith(`${real_root}/`)) { return `${alias_root}${absolute_path.slice(real_root.length)}`; }
    return absolute_path;
}

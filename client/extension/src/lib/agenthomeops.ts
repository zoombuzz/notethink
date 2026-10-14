/**
 * Where each vendor's own session files live, derived from `context.logUri` rather than from any
 * API that hands back $HOME directly, because there is none: this is a web extension and Node's own
 * `os.homedir()` is not among the fallbacks webpack polyfills for it.
 *
 * VS Code's own user-data directory is itself built from $HOME on every desktop layout this analyser
 * recognises (`$HOME/.config/<product>` on Linux, `$HOME/Library/Application Support/<product>` on
 * macOS, `$HOME\AppData\Roaming\<product>` on Windows), and `logUri` sits a few versioned segments
 * below it (`.../logs/<session>/exthost/webWorker/<extension-id>/...`, CODING_STANDARDS.md > Reading
 * VS Code logs). Walking up to the anchor segment that names the platform's user-data root and
 * stopping there gives $HOME back, regardless of which product (Code, Code - Insiders, VSCodium) or
 * which extension-host log-path shape a later VS Code version uses under it, so this needs no
 * per-product name list and no re-derivation when VS Code adds a segment to the log path.
 *
 * A web host (vscode.dev, notegit's workbench) has no local disk at all, so this returns undefined
 * there; the caller reports the analyser unavailable rather than guessing.
 */

const HOME_ANCHORS = ['.config', 'Library', 'AppData'] as const;

/** the OS home directory this desktop host runs under, or undefined when `log_uri` does not resolve to one of the platform layouts this analyser recognises */
export function homeDirectoryFromLogPath(log_path: string): string | undefined {
    const segments = log_path.split('/').filter(segment => segment.length > 0);
    for (let i = segments.length - 1; i >= 0; i--) {
        if ((HOME_ANCHORS as readonly string[]).includes(segments[i])) {
            return `/${segments.slice(0, i).join('/')}`;
        }
    }
    return undefined;
}

/** the three directories this analyser reads, joined onto the resolved home; absent when `homeDirectoryFromLogPath` could not resolve one */
export interface AgentVendorHome {
    claudeCode: string;
    codex: string;
    grok: string;
}

export function agentVendorHomeFrom(log_path: string): AgentVendorHome | undefined {
    const home = homeDirectoryFromLogPath(log_path);
    if (!home) { return undefined; }
    return {
        claudeCode: `${home}/.claude`,
        codex: `${home}/.codex`,
        grok: `${home}/.grok`,
    };
}

/**
 * Picking a remote agent home among several candidates that each hold a session directory, when the
 * workspace folder's own ancestors held none: Claude Code names each project directory after the
 * session's own real working directory, with every character that is not `[a-zA-Z0-9]` (including
 * every `/`) replaced by a dash, so `/home/dev/work_tree` becomes `-home-dev-work-tree`. That name
 * records the real path, while the workspace
 * folder VS Code was pointed at may be a symlinked alias reaching the same tree from elsewhere, so a
 * plain prefix test on the un-encoded workspace path misses it; `trailingWorkspaceSegmentMatchCount`
 * matches by trailing path segments instead, the way `agentpathaliasops.ts`'s `bestAliasMapping`
 * does for a session's `cwd`.
 */

/** `real_path` as Claude Code's own project directory under `.claude/projects` would be named */
export function encodeClaudeProjectDirName(real_path: string): string {
    return real_path.replace(/[^a-zA-Z0-9]/g, '-');
}

/** how many of `workspace_path`'s trailing path segments the encoded `dir_name` ends with */
export function trailingWorkspaceSegmentMatchCount(dir_name: string, workspace_path: string): number {
    const segments = workspace_path.split('/').filter(segment => segment.length > 0);
    let count = 0;
    for (let take = 1; take <= segments.length; take++) {
        const suffix = segments.slice(segments.length - take).join('/');
        if (!dir_name.endsWith(encodeClaudeProjectDirName(suffix))) { break; }
        count = take;
    }
    return count;
}

/** whether `dir_name` names `workspace_path` itself, a symlinked alias of it, or a folder inside it */
export function projectDirNamesWorkspace(dir_name: string, workspace_path: string): boolean {
    if (dir_name.startsWith(encodeClaudeProjectDirName(workspace_path))) { return true; }
    return trailingWorkspaceSegmentMatchCount(dir_name, workspace_path) > 0;
}

/**
 * One remote agent home candidate that already qualified (held at least one vendor's session
 * directory), as far as `bestAgentHomeCandidate` needs to know to rank it.
 * - claude_project_dir_names: directory names under this candidate's `.claude/projects`, empty when
 *   that vendor's directory does not exist here
 * - newest_session_mtime_ms: the most recent mtime among this candidate's own session directories,
 *   undefined only when none could be stat'd (never true for a candidate that qualified)
 */
export interface AgentHomeCandidate {
    path: string;
    claude_project_dir_names: readonly string[];
    newest_session_mtime_ms: number | undefined;
}

/**
 * The candidate whose `.claude/projects` names `workspace_path` (or a symlinked alias of it, or a
 * folder inside it), breaking a tie among several such candidates by the newest session directory;
 * when none names the workspace, the newest session directory alone decides. Returns the first
 * candidate when none has a usable mtime to compare, so the choice stays deterministic.
 */
export function bestAgentHomeCandidate(candidates: readonly AgentHomeCandidate[], workspace_path: string): AgentHomeCandidate | undefined {
    if (candidates.length === 0) { return undefined; }
    const named = candidates.filter(candidate => candidate.claude_project_dir_names.some(dir_name => projectDirNamesWorkspace(dir_name, workspace_path)));
    const pool = named.length > 0 ? named : candidates;
    let best = pool[0];
    for (const candidate of pool) {
        if (candidate.newest_session_mtime_ms !== undefined && (best.newest_session_mtime_ms === undefined || candidate.newest_session_mtime_ms > best.newest_session_mtime_ms)) {
            best = candidate;
        }
    }
    return best;
}

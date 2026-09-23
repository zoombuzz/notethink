import * as vscode from 'vscode';
import { countLineDiff, looksBinary, type LineDiffCounts } from '../lib/agentlinediffops';
import { parseGitReflog, type GitReflogCommit } from '../lib/agentgitreflogops';
import { writeToLog } from '../lib/errorops';
import type { ActivityChangedFile, ActivityChangeKind, ActivityTree } from '../types/AgentActivity';

/**
 * Reading a repository's working tree through the built-in git extension, because this is a web
 * extension with no child process of its own to run `git` directly.
 *
 * NoteThink runs in the web worker extension host even on desktop, and the git extension runs in the
 * node host, so the git extension's exported API object never reaches this host: VS Code proxies
 * commands between hosts but not an extension's exports. The git extension registers
 * `git.api.getRepositories` and `git.api.getRepositoryState` for exactly this, and they are the only
 * route read here. Both return plain data: each repository root as a URI string, and a state
 * snapshot whose change URIs are strings and whose statuses are the `Status` enum's own names
 * (`MODIFIED`, `UNTRACKED`), which is the shape `GitCommandState` records.
 *
 * The snapshot carries `workingTreeChanges` and `indexChanges` and no separate untracked list, so
 * under the default `git.untrackedChanges: mixed` an untracked file arrives as a working-tree
 * change; a user who sets it to `separate` gets no untracked files on the card, since the command
 * omits them.
 */

export const GIT_API_REPOSITORIES_COMMAND = 'git.api.getRepositories';
export const GIT_API_REPOSITORY_STATE_COMMAND = 'git.api.getRepositoryState';

// the git extension's `Status` names that read as each change kind; any other name reads as modified
const GIT_ADDED_STATUSES = new Set(['INDEX_ADDED', 'UNTRACKED', 'INTENT_TO_ADD', 'ADDED_BY_US', 'ADDED_BY_THEM', 'BOTH_ADDED']);
const GIT_DELETED_STATUSES = new Set(['INDEX_DELETED', 'DELETED', 'DELETED_BY_US', 'DELETED_BY_THEM', 'BOTH_DELETED']);
const GIT_RENAMED_STATUSES = new Set(['INDEX_RENAMED', 'INTENT_TO_RENAME']);

/** GitCommandChange is one change as `git.api.getRepositoryState` returns it, every URI a string */
interface GitCommandChange {
    uri: string;
    originalUri: string;
    renameUri?: string;
    status: string;
}

/** GitCommandState is the part of `git.api.getRepositoryState`'s answer this file reads */
interface GitCommandState {
    HEAD?: { name?: string; commit?: string };
    workingTreeChanges?: GitCommandChange[];
    indexChanges?: GitCommandChange[];
}

export interface GitChange {
    uri: vscode.Uri;
    originalUri: vscode.Uri;
    renameUri?: vscode.Uri;
    status: string;
}

export interface GitRepositoryState {
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    HEAD?: { name?: string; commit?: string };
}

/** GitRepository is one repository's root and a state snapshot taken this scan */
export interface GitRepository {
    rootUri: vscode.Uri;
    state: GitRepositoryState;
}

export interface GitApi {
    readRepositories(): Promise<GitRepository[]>;
}

function changeFromCommand(change: GitCommandChange): GitChange {
    return {
        uri: vscode.Uri.parse(change.uri),
        originalUri: vscode.Uri.parse(change.originalUri),
        renameUri: change.renameUri ? vscode.Uri.parse(change.renameUri) : undefined,
        status: change.status,
    };
}

/** every repository the git extension has open, each with a fresh state snapshot; a root whose state comes back empty is skipped */
async function readRepositoriesByCommand(): Promise<GitRepository[]> {
    const roots = await vscode.commands.executeCommand<string[] | undefined>(GIT_API_REPOSITORIES_COMMAND) ?? [];
    const repositories: GitRepository[] = [];
    for (const root of roots) {
        const state = await vscode.commands.executeCommand<GitCommandState | null | undefined>(GIT_API_REPOSITORY_STATE_COMMAND, root);
        if (!state) { continue; }
        repositories.push({
            rootUri: vscode.Uri.parse(root),
            state: {
                HEAD: state.HEAD,
                workingTreeChanges: (state.workingTreeChanges ?? []).map(changeFromCommand),
                indexChanges: (state.indexChanges ?? []).map(changeFromCommand),
            },
        });
    }
    return repositories;
}

/** the git extension's cross-host commands, undefined while they are not registered (git disabled, not yet activated, or a web host with no git support) */
export async function resolveGitApi(): Promise<GitApi | undefined> {
    try {
        const registered = await vscode.commands.getCommands(true);
        if (!registered.includes(GIT_API_REPOSITORIES_COMMAND)) { return undefined; }
        return { readRepositories: readRepositoriesByCommand };
    } catch (err) {
        writeToLog('resolveGitApi', `the git extension commands could not be listed: ${String(err)}`);
        return undefined;
    }
}

function changeKindOf(status: string): ActivityChangeKind {
    if (GIT_ADDED_STATUSES.has(status)) { return 'added'; }
    if (GIT_DELETED_STATUSES.has(status)) { return 'deleted'; }
    if (GIT_RENAMED_STATUSES.has(status)) { return 'renamed'; }
    return 'modified';
}

/**
 * The two change lists folded into one uncommitted band. An index change wins over a working-tree
 * one for the same path since it is the more current state git itself would stage next.
 */
function uncommittedFrom(state: GitRepositoryState, root_path: string): ActivityTree['uncommitted'] {
    const by_path = new Map<string, GitChange>();
    for (const change of [...state.workingTreeChanges, ...state.indexChanges]) { by_path.set(change.uri.path, change); }
    // on a rename the git extension's `uri` and `renameUri` are both the new path and `originalUri` the old one
    return [...by_path.values()].map(change => ({
        path: relativeToRoot(root_path, change.uri.path),
        change: changeKindOf(change.status),
        previous_path: change.originalUri.path !== change.uri.path ? relativeToRoot(root_path, change.originalUri.path) : undefined,
    }));
}

function relativeToRoot(root_path: string, absolute_path: string): string {
    return absolute_path.startsWith(`${root_path}/`) ? absolute_path.slice(root_path.length + 1) : absolute_path;
}

/**
 * One repository's working tree and its reflog commits, kept as two return values because
 * `ActivityTree.committed` carries no timestamp (only sha and subject, per its own doc comment) while
 * attributing a commit to a session needs the reflog's real timestamp; `AgentAnalyser.ts` uses
 * `reflog` for that match and then discards it, folding only sha/subject/session_id into the posted
 * tree. Neither list is yet credited to a session here - `agentgitattributionops.ts` does that
 * against the analyser's own tool-invocation data.
 */
export interface GitTreeRead {
    tree: ActivityTree;
    reflog: GitReflogCommit[];
}

export async function readRepositoryTree(repository: GitRepository, generated_at_ms: number): Promise<GitTreeRead> {
    const root_path = repository.rootUri.path;
    const reflog_text = await readReflogText(repository.rootUri);
    const reflog = reflog_text ? parseGitReflog(reflog_text) : [];
    return {
        reflog,
        tree: {
            generated_at: new Date(generated_at_ms).toISOString(),
            branch: repository.state.HEAD?.name ?? '',
            head_commit: repository.state.HEAD?.commit ?? '',
            uncommitted: uncommittedFrom(repository.state, root_path),
            committed: reflog.map(commit => ({ sha: commit.sha, subject: commit.subject })),
        },
    };
}

async function readReflogText(root_uri: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root_uri, '.git', 'logs', 'HEAD'));
        return new TextDecoder().decode(bytes);
    } catch {
        // a repository with no reflog yet (a fresh clone with gc'd reflogs, or reflogs disabled) has no commits to list, which is a fact to report rather than a failure
        return undefined;
    }
}

// either side of a diff larger than this is declined rather than decoded and diffed: the LCS-based counter (agentlinediffops.ts) is O(lines-in-one-side * lines-in-the-other), so an unbounded side could stall a scan the way an unbounded transcript read would
const AGENT_LINE_DIFF_MAX_BYTES = 256 * 1024;

/**
 * The committed side of an uncommitted file's diff, read live through the git extension's own `git:`
 * document-content provider - the same reconstruction of its `toGitUri` shape `ActivityCommands.ts`'s
 * `headUri` uses to open the diff a click reveals, kept separate here since this file has no `path`
 * import for `ActivityCommands.ts`'s own resolved-path handling and needs none: a repository-relative
 * path joined onto `root_uri` is enough to build the URI.
 */
function gitHeadUri(root_uri: vscode.Uri, repo_relative_path: string): vscode.Uri {
    const working_uri = vscode.Uri.joinPath(root_uri, repo_relative_path);
    return working_uri.with({ scheme: 'git', query: JSON.stringify({ path: working_uri.fsPath, ref: 'HEAD' }) });
}

// a side that does not exist (an added file's HEAD side, a deleted file's working-tree side) reads as undefined the same way a side that could not be read at all does; the two are told apart by the caller, which already knows which sides `change` promises exist
async function readSideBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
    try { return await vscode.workspace.fs.readFile(uri); }
    catch { return undefined; }
}

/**
 * Line-level added/removed counts for one uncommitted file, HEAD vs the working tree: an added file
 * counts every line added, a deleted file every line removed. Declines (returns undefined) rather
 * than guessing whenever a side this file's own `change` promises should exist could not be read, is
 * over `AGENT_LINE_DIFF_MAX_BYTES`, or looks binary - the caller leaves `added`/`removed` off the file
 * rather than publish a partial or wrong count.
 */
export async function lineDiffForFile(
    root_uri: vscode.Uri,
    file: Pick<ActivityChangedFile, 'path' | 'change' | 'previous_path'>,
): Promise<LineDiffCounts | undefined> {
    const head_uri = file.change === 'added' ? undefined : gitHeadUri(root_uri, file.previous_path ?? file.path);
    const working_uri = file.change === 'deleted' ? undefined : vscode.Uri.joinPath(root_uri, file.path);
    const head_bytes = head_uri ? await readSideBytes(head_uri) : undefined;
    const working_bytes = working_uri ? await readSideBytes(working_uri) : undefined;
    if (head_uri && head_bytes === undefined) { return undefined; }
    if (working_uri && working_bytes === undefined) { return undefined; }
    if ((head_bytes && head_bytes.byteLength > AGENT_LINE_DIFF_MAX_BYTES) || (working_bytes && working_bytes.byteLength > AGENT_LINE_DIFF_MAX_BYTES)) { return undefined; }
    if ((head_bytes && looksBinary(head_bytes)) || (working_bytes && looksBinary(working_bytes))) { return undefined; }
    const head_text = head_bytes ? new TextDecoder().decode(head_bytes) : undefined;
    const working_text = working_bytes ? new TextDecoder().decode(working_bytes) : undefined;
    return countLineDiff(head_text, working_text);
}

/**
 * Reading the commits a branch is ahead of its upstream by from git's own loose object store, because
 * the built-in git extension's cross-host commands (`git.api.getRepositoryState` is the only one that
 * reads a repository) carry the branch's ahead count, HEAD's sha and every ref's sha, and no commit,
 * tree or diff. Everything here is pure over a `readObject` function, so the host binds it to
 * `vscode.workspace.fs` and a test binds it to an in-memory store.
 *
 * A packed object cannot be read this way, so `readObject` answers undefined for it and every function
 * here degrades to "no figure" rather than guessing: a commit whose tree cannot be read still lists by
 * its sha, and a file count is never published for a diff that was cut short.
 */

/** GitObjectReader answers one object's inflated bytes (header included), undefined when it is absent or packed */
export type GitObjectReader = (sha: string) => Promise<Uint8Array | undefined>;

/**
 * PendingCommitChange is one file a pending commit changes, the blob on each side.
 * - old_sha: the blob before the commit, absent for an added file
 * - new_sha: the blob after the commit, absent for a deleted file
 */
export interface PendingCommitChange {
    path: string;
    old_sha?: string;
    new_sha?: string;
}

/**
 * PendingCommitRead is one pending commit as read from the object store.
 * - changes: every file the commit changes against its first parent; undefined when a tree could not be read or the diff passed its read budget
 */
export interface PendingCommitRead {
    sha: string;
    changes?: PendingCommitChange[];
}

/** PendingCommitsRead is the newest pending commits, newest first, and whether the walk stopped before the upstream */
export interface PendingCommitsRead {
    commits: PendingCommitRead[];
    reached_upstream: boolean;
}

// a commit that touches more than this many files, or whose trees take more objects to read, reports no file figures
export const AGENT_PENDING_COMMIT_MAX_OBJECT_READS = 400;
export const AGENT_PENDING_COMMIT_MAX_CHANGES = 200;

/** inflates a zlib stream; undefined when the bytes are not one, since a corrupt object is a fact to skip */
export async function inflateObject(compressed: Uint8Array): Promise<Uint8Array | undefined> {
    try {
        const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return undefined;
    }
}

/** splits an inflated object into its type and body, undefined when it has no `<type> <size>\0` header */
export function splitObject(object: Uint8Array): { type: string; body: Uint8Array } | undefined {
    const end = object.indexOf(0);
    if (end < 0) { return undefined; }
    const header = new TextDecoder().decode(object.subarray(0, end));
    const type = header.split(' ')[0];
    return { type, body: object.subarray(end + 1) };
}

/** a commit's tree and parents, from its header lines (ahead of the first blank line) */
export function parseCommitBody(body: Uint8Array): { tree: string; parents: string[] } | undefined {
    const text = new TextDecoder().decode(body);
    const head = text.split('\n\n', 1)[0];
    let tree: string | undefined;
    const parents: string[] = [];
    for (const line of head.split('\n')) {
        if (line.startsWith('tree ')) { tree = line.slice(5).trim(); }
        else if (line.startsWith('parent ')) { parents.push(line.slice(7).trim()); }
    }
    return tree ? { tree, parents } : undefined;
}

export interface GitTreeEntry {
    name: string;
    sha: string;
    is_tree: boolean;
}

/** a tree's entries: `<octal mode> <name>\0<20 raw sha bytes>` repeated; a submodule (mode 160000) is skipped */
export function parseTreeBody(body: Uint8Array): GitTreeEntry[] {
    const entries: GitTreeEntry[] = [];
    const decoder = new TextDecoder();
    let offset = 0;
    while (offset < body.length) {
        const nul = body.indexOf(0, offset);
        if (nul < 0 || nul + 21 > body.length) { break; }
        const label = decoder.decode(body.subarray(offset, nul));
        const space = label.indexOf(' ');
        const mode = label.slice(0, space);
        const name = label.slice(space + 1);
        let sha = '';
        for (let i = nul + 1; i < nul + 21; i++) { sha += body[i].toString(16).padStart(2, '0'); }
        offset = nul + 21;
        if (mode === '160000') { continue; }
        entries.push({ name, sha, is_tree: mode === '40000' });
    }
    return entries;
}

async function readTyped(read: GitObjectReader, sha: string, type: string, budget: { reads: number }): Promise<Uint8Array | undefined> {
    if (budget.reads <= 0) { return undefined; }
    budget.reads--;
    const object = await read(sha);
    const split = object ? splitObject(object) : undefined;
    return split?.type === type ? split.body : undefined;
}

/**
 * Every file whose blob differs between two trees, descending only into subtrees whose sha differs.
 * Undefined when an object is unreadable or the read budget or `AGENT_PENDING_COMMIT_MAX_CHANGES` is
 * spent, because a partial list would read as the whole commit.
 */
async function diffTrees(
    read: GitObjectReader,
    old_tree: string | undefined,
    new_tree: string | undefined,
    prefix: string,
    budget: { reads: number },
    out: PendingCommitChange[],
): Promise<boolean> {
    const old_body = old_tree ? await readTyped(read, old_tree, 'tree', budget) : undefined;
    const new_body = new_tree ? await readTyped(read, new_tree, 'tree', budget) : undefined;
    if ((old_tree && !old_body) || (new_tree && !new_body)) { return false; }
    const old_entries = new Map((old_body ? parseTreeBody(old_body) : []).map(entry => [entry.name, entry]));
    const new_entries = new Map((new_body ? parseTreeBody(new_body) : []).map(entry => [entry.name, entry]));
    for (const name of new Set([...old_entries.keys(), ...new_entries.keys()])) {
        const old_entry = old_entries.get(name);
        const new_entry = new_entries.get(name);
        if (old_entry && new_entry && old_entry.sha === new_entry.sha && old_entry.is_tree === new_entry.is_tree) { continue; }
        const path = `${prefix}${name}`;
        const old_tree_sha = old_entry?.is_tree ? old_entry.sha : undefined;
        const new_tree_sha = new_entry?.is_tree ? new_entry.sha : undefined;
        if (old_tree_sha || new_tree_sha) {
            if (!await diffTrees(read, old_tree_sha, new_tree_sha, `${path}/`, budget, out)) { return false; }
        }
        const old_blob = old_entry && !old_entry.is_tree ? old_entry.sha : undefined;
        const new_blob = new_entry && !new_entry.is_tree ? new_entry.sha : undefined;
        if (old_blob || new_blob) {
            out.push({ path, old_sha: old_blob, new_sha: new_blob });
            if (out.length > AGENT_PENDING_COMMIT_MAX_CHANGES) { return false; }
        }
    }
    return true;
}

/** the files one commit changes against its first parent (or against nothing for a root commit); undefined when it cannot be read whole */
export async function readCommitChanges(read: GitObjectReader, commit_tree: string, parent_sha: string | undefined): Promise<PendingCommitChange[] | undefined> {
    const budget = { reads: AGENT_PENDING_COMMIT_MAX_OBJECT_READS };
    let parent_tree: string | undefined;
    if (parent_sha) {
        const parent_body = await readTyped(read, parent_sha, 'commit', budget);
        const parent = parent_body ? parseCommitBody(parent_body) : undefined;
        if (!parent) { return undefined; }
        parent_tree = parent.tree;
    }
    const changes: PendingCommitChange[] = [];
    return await diffTrees(read, parent_tree, commit_tree, '', budget, changes) ? changes : undefined;
}

/**
 * Walks first parents from HEAD until the upstream's commit, or `max_commits`, collecting each commit
 * and its changed files. A merge counts against its first parent only, so a branch that merged another
 * lists the merge and the first-parent line. `reached_upstream` is false when the walk ran out of
 * budget or hit an unreadable commit first.
 */
export async function readPendingCommits(read: GitObjectReader, head_sha: string, upstream_sha: string | undefined, max_commits: number): Promise<PendingCommitsRead> {
    const commits: PendingCommitRead[] = [];
    let sha: string | undefined = head_sha;
    while (sha && sha !== upstream_sha) {
        if (commits.length >= max_commits) { return { commits, reached_upstream: false }; }
        const body = await readTyped(read, sha, 'commit', { reads: 1 });
        const commit = body ? parseCommitBody(body) : undefined;
        if (!commit) { return { commits, reached_upstream: false }; }
        const parent = commit.parents[0];
        const changes = await readCommitChanges(read, commit.tree, parent);
        commits.push({ sha, changes });
        sha = parent;
    }
    return { commits, reached_upstream: sha === upstream_sha };
}

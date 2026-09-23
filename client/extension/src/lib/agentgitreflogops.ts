/**
 * Reads `.git/logs/HEAD` for the commits on the current branch: the built-in git extension's own API
 * lists no commits, only the working tree's changes, while the reflog is small, plain text, and
 * already ordered oldest-first the way a commit list wants to be read.
 *
 * A session is credited with a commit by time proximity to its own `git commit` tool call, not by
 * author identity, because the reflog carries the local user's identity on every line regardless of
 * which of several sessions on the same machine actually ran the command (`agentgitattributionops.ts`
 * does that matching; this module only parses the file).
 */

export interface GitReflogCommit {
    sha: string;
    at_ms: number;
    subject: string;
}

// "commit:", "commit (initial):" and "commit (amend):" are the three shapes an ordinary or amended commit writes; every other reflog action (checkout, reset, pull, merge of a branch) is not a commit this session made and is skipped
const REFLOG_COMMIT_MESSAGE = /^commit(?:\s+\([^)]*\))?:\s*(.*)$/;
// "<old-sha> <new-sha> <name> <email> <epoch-seconds> <tz>\t<message>"; the identity fields are free text and may themselves contain spaces, so the parse anchors on the two hashes at the front and the timestamp immediately before the tab-delimited message
const REFLOG_LINE = /^([0-9a-f]{7,40})\s+([0-9a-f]{7,40})\s+.*?(\d{10,})\s+[+-]\d{4}\t(.*)$/;

/** every commit the reflog records, oldest first, exactly as git wrote them */
export function parseGitReflog(text: string): GitReflogCommit[] {
    const commits: GitReflogCommit[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) { continue; }
        const match = REFLOG_LINE.exec(line);
        if (!match) { continue; }
        const [, , new_sha, epoch_seconds, message] = match;
        const commit_match = REFLOG_COMMIT_MESSAGE.exec(message);
        if (!commit_match) { continue; }
        commits.push({ sha: new_sha, at_ms: Number(epoch_seconds) * 1000, subject: commit_match[1] });
    }
    return commits;
}

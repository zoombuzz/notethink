import type { GitReflogCommit } from './agentgitreflogops';
import type { ActivityChangedFile, ActivityChangeKind, ActivityCommit } from '../types/AgentActivity';

/**
 * Credits a repository's working tree to the sessions whose own write calls touched it: the
 * uncommitted band credits each file only by its own write calls, and the committed band credits
 * each commit read from its own `git commit` calls.
 *
 * Neither credit can be exact. A file is matched by path, which is unambiguous; a commit is matched
 * by time, because the reflog carries no session identity at all, only the local user's git identity
 * on every line regardless of which of several concurrent sessions actually ran the command.
 */

/**
 * One session's write call to a path.
 * - repo_relative_path: resolved by the caller from the session's own cwd
 */
export interface AgentWriteCall {
    session_id: string;
    repo_relative_path: string;
    at_ms: number;
}

export interface AgentCommitCall {
    session_id: string;
    at_ms: number;
}

/**
 * One uncommitted file per working-tree path, credited to whichever session's write call to that
 * exact path is the most recent. Two sessions editing the same file is rare and the later write is
 * the one still sitting in the working tree, so it is the more honest credit of the two.
 */
export function attributeFilesToSessions(
    working_tree: ReadonlyArray<{ path: string; change: ActivityChangeKind; previous_path?: string }>,
    write_calls: ReadonlyArray<AgentWriteCall>,
): ActivityChangedFile[] {
    return working_tree.map(entry => {
        const matches = write_calls.filter(call => call.repo_relative_path === entry.path);
        const latest = matches.reduce<AgentWriteCall | undefined>((best, call) => (!best || call.at_ms > best.at_ms) ? call : best, undefined);
        return { path: entry.path, change: entry.change, previous_path: entry.previous_path, session_id: latest?.session_id };
    });
}

/**
 * One committed entry per reflog commit, credited to the session whose own `git commit` tool call
 * falls within `tolerance_ms` of the commit's own reflog timestamp and is closest to it. A commit
 * outside every session's tolerance is listed with no session_id rather than guessed onto the
 * nearest one regardless of distance.
 */
export function attributeCommitsToSessions(
    reflog_commits: ReadonlyArray<GitReflogCommit>,
    commit_calls: ReadonlyArray<AgentCommitCall>,
    tolerance_ms = 60_000,
): ActivityCommit[] {
    return reflog_commits.map(commit => {
        let best: AgentCommitCall | undefined;
        let best_distance = Infinity;
        for (const call of commit_calls) {
            const distance = Math.abs(call.at_ms - commit.at_ms);
            if (distance <= tolerance_ms && distance < best_distance) { best = call; best_distance = distance; }
        }
        return { sha: commit.sha, subject: commit.subject, session_id: best?.session_id };
    });
}

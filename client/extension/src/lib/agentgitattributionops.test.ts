import { attributeCommitsToSessions, attributeFilesToSessions, type AgentCommitCall, type AgentWriteCall } from './agentgitattributionops';
import type { GitReflogCommit } from './agentgitreflogops';

describe('attributeFilesToSessions', () => {
    it('credits a file to the session whose write call named its exact path', () => {
        const write_calls: AgentWriteCall[] = [{ session_id: 's1', repo_relative_path: 'a.ts', at_ms: 1000 }];
        const result = attributeFilesToSessions([{ path: 'a.ts', change: 'modified' }], write_calls);
        expect(result).toEqual([{ path: 'a.ts', change: 'modified', previous_path: undefined, session_id: 's1' }]);
    });

    it('leaves a file unattributed when no write call named it', () => {
        const result = attributeFilesToSessions([{ path: 'b.ts', change: 'added' }], []);
        expect(result[0].session_id).toBeUndefined();
    });

    it('credits the most recent write call when two sessions touched the same path', () => {
        const write_calls: AgentWriteCall[] = [
            { session_id: 's1', repo_relative_path: 'a.ts', at_ms: 1000 },
            { session_id: 's2', repo_relative_path: 'a.ts', at_ms: 2000 },
        ];
        const result = attributeFilesToSessions([{ path: 'a.ts', change: 'modified' }], write_calls);
        expect(result[0].session_id).toBe('s2');
    });

    it('never credits a write call to a different path', () => {
        const write_calls: AgentWriteCall[] = [{ session_id: 's1', repo_relative_path: 'other.ts', at_ms: 1000 }];
        const result = attributeFilesToSessions([{ path: 'a.ts', change: 'deleted' }], write_calls);
        expect(result[0].session_id).toBeUndefined();
    });
});

describe('attributeCommitsToSessions', () => {
    const reflog: GitReflogCommit[] = [{ sha: 'a'.repeat(40), at_ms: 100_000, subject: 'fix the thing' }];

    it('credits a commit to the session whose commit call is within tolerance', () => {
        const calls: AgentCommitCall[] = [{ session_id: 's1', at_ms: 100_500 }];
        expect(attributeCommitsToSessions(reflog, calls)).toEqual([{ sha: 'a'.repeat(40), subject: 'fix the thing', session_id: 's1' }]);
    });

    it('leaves a commit unattributed when no call falls within tolerance', () => {
        const calls: AgentCommitCall[] = [{ session_id: 's1', at_ms: 500_000 }];
        expect(attributeCommitsToSessions(reflog, calls)[0].session_id).toBeUndefined();
    });

    it('credits the closest call when two sessions both fall within tolerance', () => {
        const calls: AgentCommitCall[] = [
            { session_id: 's1', at_ms: 100_000 + 50_000 },
            { session_id: 's2', at_ms: 100_000 + 5_000 },
        ];
        expect(attributeCommitsToSessions(reflog, calls)[0].session_id).toBe('s2');
    });

    it('respects a caller-supplied tolerance', () => {
        const calls: AgentCommitCall[] = [{ session_id: 's1', at_ms: 100_000 + 5_000 }];
        expect(attributeCommitsToSessions(reflog, calls, 1_000)[0].session_id).toBeUndefined();
    });
});

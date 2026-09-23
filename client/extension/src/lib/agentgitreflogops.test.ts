import { parseGitReflog } from './agentgitreflogops';

const IDENTITY = 'Alex Stanhope <alex@lightenna.com>';

function reflogLine(old_sha: string, new_sha: string, epoch_seconds: number, message: string): string {
    return `${old_sha} ${new_sha} ${IDENTITY} ${epoch_seconds} +0000\t${message}`;
}

describe('parseGitReflog', () => {
    it('parses an ordinary commit line', () => {
        const text = reflogLine('0'.repeat(40), 'a'.repeat(40), 1758556800, 'commit: fix the thing');
        expect(parseGitReflog(text)).toEqual([{ sha: 'a'.repeat(40), at_ms: 1758556800000, subject: 'fix the thing' }]);
    });

    it('parses an amended commit and an initial commit, keeping their own subject', () => {
        const text = [
            reflogLine('0'.repeat(40), 'a'.repeat(40), 1758556800, 'commit (initial): first commit'),
            reflogLine('a'.repeat(40), 'b'.repeat(40), 1758556900, 'commit (amend): first commit, reworded'),
        ].join('\n');
        expect(parseGitReflog(text)).toEqual([
            { sha: 'a'.repeat(40), at_ms: 1758556800000, subject: 'first commit' },
            { sha: 'b'.repeat(40), at_ms: 1758556900000, subject: 'first commit, reworded' },
        ]);
    });

    it('skips a non-commit reflog action such as checkout or reset', () => {
        const text = [
            reflogLine('a'.repeat(40), 'b'.repeat(40), 1758556800, 'checkout: moving from staging to main'),
            reflogLine('b'.repeat(40), 'c'.repeat(40), 1758556900, 'reset: moving to HEAD~1'),
        ].join('\n');
        expect(parseGitReflog(text)).toEqual([]);
    });

    it('keeps commits in file order, which is oldest first', () => {
        const text = [
            reflogLine('0'.repeat(40), 'a'.repeat(40), 1758556800, 'commit: first'),
            reflogLine('a'.repeat(40), 'b'.repeat(40), 1758556900, 'commit: second'),
        ].join('\n');
        expect(parseGitReflog(text).map(c => c.subject)).toEqual(['first', 'second']);
    });

    it('ignores a blank line and a line that does not match the reflog shape at all', () => {
        const text = ['', 'not a reflog line', reflogLine('0'.repeat(40), 'a'.repeat(40), 1758556800, 'commit: only real one')].join('\n');
        expect(parseGitReflog(text)).toEqual([{ sha: 'a'.repeat(40), at_ms: 1758556800000, subject: 'only real one' }]);
    });

    it('returns an empty array for an empty reflog', () => {
        expect(parseGitReflog('')).toEqual([]);
    });
});

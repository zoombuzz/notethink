import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Uri } from '../__mocks__/vscode';
import { readPendingCommitsOf, type GitRepository } from './agentgitops';
import { inflateObject, splitObject, type GitObjectReader, type PendingCommitsRead } from '../lib/agentgitobjectops';
import { lineDiffFromBytes } from '../lib/agentlinediffops';

function gitAvailable(): boolean {
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const HAS_GIT = gitAvailable();

function git(cwd: string, args: string[], input?: string): string {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', input });
}

function write(cwd: string, path: string, text: string): void {
    const full = join(cwd, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
}

function commitAll(cwd: string, subject: string): void {
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-q', '-m', subject]);
}

// the loose-object reader's job against a real .git, with the real DecompressionStream; a missing file reads as absent
function fsObjectReader(repo: string): GitObjectReader {
    return async sha => {
        try {
            return await inflateObject(new Uint8Array(readFileSync(join(repo, '.git', 'objects', sha.slice(0, 2), sha.slice(2)))));
        } catch {
            return undefined;
        }
    };
}

function repositoryAt(repo: string, head: string, upstream_sha: string, ahead: number): GitRepository {
    return {
        rootUri: Uri.file(repo),
        state: {
            workingTreeChanges: [],
            indexChanges: [],
            HEAD: { name: 'main', commit: head, upstream: { remote: 'origin', name: 'main' }, ahead },
            refs: [{ name: 'origin/main', commit: upstream_sha }],
        },
    };
}

async function blobBytes(read: GitObjectReader, sha: string | undefined): Promise<Uint8Array | undefined> {
    if (!sha) { return undefined; }
    const object = await read(sha);
    return object ? splitObject(object)?.body : undefined;
}

// per commit the short sha, file count and summed line counts, composed from the read changes as the analyser does
async function figuresOf(read: GitObjectReader, pending: PendingCommitsRead): Promise<Array<{ short_sha: string; files?: number; added?: number; removed?: number }>> {
    const figures = [];
    for (const commit of pending.commits) {
        if (!commit.changes) { figures.push({ short_sha: commit.sha.slice(0, 7) }); continue; }
        let added = 0;
        let removed = 0;
        for (const change of commit.changes) {
            const counts = lineDiffFromBytes(await blobBytes(read, change.old_sha), await blobBytes(read, change.new_sha));
            added += counts?.added ?? 0;
            removed += counts?.removed ?? 0;
        }
        figures.push({ short_sha: commit.sha.slice(0, 7), files: commit.changes.length, added, removed });
    }
    return figures;
}

// git's own answer for the ahead range: newest first, each with its changed file count and numstat sums
function gitFigures(repo: string, range: string): Array<{ short_sha: string; files: number; added: number; removed: number }> {
    const out = git(repo, ['log', '--no-renames', '--numstat', '--format=@@%H', range]);
    const figures: Array<{ short_sha: string; files: number; added: number; removed: number }> = [];
    for (const line of out.split('\n')) {
        if (line.startsWith('@@')) { figures.push({ short_sha: line.slice(2, 9), files: 0, added: 0, removed: 0 }); continue; }
        const [added, removed] = line.split('\t');
        if (added === undefined || removed === undefined || line.trim() === '') { continue; }
        const current = figures[figures.length - 1];
        current.files += 1;
        current.added += Number(added);
        current.removed += Number(removed);
    }
    return figures;
}

const describeWithGit = HAS_GIT ? describe : describe.skip;

describeWithGit('pending commits read from a real git repository', () => {
    let repo: string;
    let bare: string;
    let upstream_sha: string;
    let head_sha: string;
    let ahead: number;

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'notethink-realrepo-'));
        git(repo, ['init', '-q', '-b', 'main']);
        write(repo, 'README.md', 'one\ntwo\nthree\n');
        write(repo, 'src/keep.ts', 'a\nb\nc\nd\ne\n');
        write(repo, 'src/gone.ts', 'x\ny\n');
        commitAll(repo, 'base');
        // a bare clone stands in for the remote the branch tracks
        bare = `${repo}-remote.git`;
        git(repo, ['clone', '-q', '--bare', repo, bare]);
        git(repo, ['remote', 'add', 'origin', bare]);
        git(repo, ['fetch', '-q', 'origin']);
        git(repo, ['branch', '-q', '-u', 'origin/main']);
        upstream_sha = git(repo, ['rev-parse', 'origin/main']).trim();
        // the pending commits: edits, an addition in a new nested folder, a deletion and a touch of a second file
        write(repo, 'README.md', 'one\nTWO\nthree\nfour\nfive\n');
        write(repo, 'src/new/deep/added.ts', '1\n2\n3\n4\n');
        commitAll(repo, 'first pending');
        git(repo, ['rm', '-q', 'src/gone.ts']);
        write(repo, 'src/keep.ts', 'a\nc\nd\nE\nf\ng\n');
        commitAll(repo, 'second pending');
        write(repo, 'src/new/deep/added.ts', '1\n2\n');
        commitAll(repo, 'third pending');
        head_sha = git(repo, ['rev-parse', 'HEAD']).trim();
        ahead = Number(git(repo, ['rev-list', '--count', '@{u}..HEAD']).trim());
    });

    afterEach(() => {
        rmSync(repo, { recursive: true, force: true });
        rmSync(bare, { recursive: true, force: true });
    });

    it('matches git log --numstat for the ahead range: short shas, file counts and added and removed lines', async () => {
        const read = fsObjectReader(repo);
        const pending = await readPendingCommitsOf(repositoryAt(repo, head_sha, upstream_sha, ahead), 20, read);
        expect(pending?.reached_upstream).toBe(true);
        expect(ahead).toBe(3);
        const expected = gitFigures(repo, '@{u}..HEAD');
        expect(expected).toHaveLength(3);
        expect(await figuresOf(read, pending!)).toEqual(expected);
    });

    it('stops at the listing bound with the newest commits first, and says it did not reach the upstream', async () => {
        const pending = await readPendingCommitsOf(repositoryAt(repo, head_sha, upstream_sha, ahead), 2, fsObjectReader(repo));
        expect(pending?.commits.map(commit => commit.sha.slice(0, 7))).toEqual(gitFigures(repo, '@{u}..HEAD').slice(0, 2).map(figure => figure.short_sha));
        expect(pending?.reached_upstream).toBe(false);
    });

    it('lists a commit whose parent is packed by its hash alone, with no figures guessed, while the loose ones keep theirs', async () => {
        // pack everything the upstream reaches and drop its loose copies, so the oldest pending commit's parent is only packed
        const objects = git(repo, ['rev-list', '--objects', upstream_sha]);
        git(repo, ['pack-objects', '-q', join(repo, '.git', 'objects', 'pack', 'pack')], objects);
        git(repo, ['prune-packed']);
        const read = fsObjectReader(repo);
        expect(await read(upstream_sha)).toBeUndefined();
        const pending = await readPendingCommitsOf(repositoryAt(repo, head_sha, upstream_sha, ahead), 20, read);
        const expected = gitFigures(repo, '@{u}..HEAD');
        const figures = await figuresOf(read, pending!);
        expect(figures).toHaveLength(3);
        expect(figures[2]).toEqual({ short_sha: expected[2].short_sha });
        expect(figures[0].files).toBe(expected[0].files);
        expect(figures[1].files).toBe(expected[1].files);
    });

    it('reads nothing, rather than guessing, once git gc has packed the whole repository', async () => {
        git(repo, ['gc', '-q', '--prune=now']);
        const read = fsObjectReader(repo);
        expect(await read(head_sha)).toBeUndefined();
        const pending = await readPendingCommitsOf(repositoryAt(repo, head_sha, upstream_sha, ahead), 20, read);
        expect(pending).toEqual({ commits: [], reached_upstream: false });
    });
});

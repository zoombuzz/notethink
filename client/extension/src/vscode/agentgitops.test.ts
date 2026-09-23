import * as vscode from 'vscode';
import { Uri } from '../__mocks__/vscode';
import { GIT_API_REPOSITORIES_COMMAND, GIT_API_REPOSITORY_STATE_COMMAND, lineDiffForFile, readRepositoryTree, resolveGitApi, type GitRepository } from './agentgitops';

const ROOT_PATH = '/ws/notethink';

function makeRepository(overrides: Partial<GitRepository['state']> = {}): GitRepository {
    return {
        rootUri: Uri.file(ROOT_PATH),
        state: {
            workingTreeChanges: [],
            indexChanges: [],
            HEAD: { name: 'staging', commit: 'a'.repeat(40) },
            ...overrides,
        },
    };
}

describe('resolveGitApi', () => {
    afterEach(() => {
        (vscode.commands.getCommands as jest.Mock).mockReset().mockResolvedValue([]);
        (vscode.commands.executeCommand as jest.Mock).mockReset();
    });

    it('is undefined while the git extension has not registered its api commands', async () => {
        expect(await resolveGitApi()).toBeUndefined();
    });

    it('is undefined, not throwing, when the commands cannot be listed', async () => {
        (vscode.commands.getCommands as jest.Mock).mockRejectedValueOnce(new Error('boom'));
        expect(await resolveGitApi()).toBeUndefined();
    });

    it('reads every repository through the cross-host commands, parsing URI strings and keeping status names', async () => {
        (vscode.commands.getCommands as jest.Mock).mockResolvedValue([GIT_API_REPOSITORIES_COMMAND, GIT_API_REPOSITORY_STATE_COMMAND]);
        (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (command: string, root?: string) => {
            if (command === GIT_API_REPOSITORIES_COMMAND) { return [`file://${ROOT_PATH}`, 'file:///ws/gone']; }
            if (command === GIT_API_REPOSITORY_STATE_COMMAND && root === `file://${ROOT_PATH}`) {
                return {
                    HEAD: { name: 'staging', commit: 'a'.repeat(40) },
                    workingTreeChanges: [{ uri: `file://${ROOT_PATH}/new.ts`, originalUri: `file://${ROOT_PATH}/new.ts`, status: 'UNTRACKED' }],
                    indexChanges: [],
                };
            }
            return null;
        });
        const api = await resolveGitApi();
        const repositories = await api!.readRepositories();
        expect(repositories).toHaveLength(1);
        expect(repositories[0].rootUri.path).toBe(ROOT_PATH);
        expect(repositories[0].state.workingTreeChanges[0]).toMatchObject({ status: 'UNTRACKED' });
        expect(repositories[0].state.workingTreeChanges[0].uri.path).toBe(`${ROOT_PATH}/new.ts`);
    });
});

describe('readRepositoryTree', () => {
    beforeEach(() => {
        (vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(new Error('no reflog'));
    });

    it('maps INDEX_ADDED and UNTRACKED to added, INDEX_DELETED and DELETED to deleted, INDEX_RENAMED to renamed, and everything else to modified', async () => {
        const repository = makeRepository({
            workingTreeChanges: [
                { uri: Uri.file(`${ROOT_PATH}/added.ts`), originalUri: Uri.file(`${ROOT_PATH}/added.ts`), status: 'INDEX_ADDED' },
                { uri: Uri.file(`${ROOT_PATH}/untracked.ts`), originalUri: Uri.file(`${ROOT_PATH}/untracked.ts`), status: 'UNTRACKED' },
                { uri: Uri.file(`${ROOT_PATH}/deleted.ts`), originalUri: Uri.file(`${ROOT_PATH}/deleted.ts`), status: 'DELETED' },
                { uri: Uri.file(`${ROOT_PATH}/renamed.ts`), originalUri: Uri.file(`${ROOT_PATH}/old.ts`), renameUri: Uri.file(`${ROOT_PATH}/renamed.ts`), status: 'INDEX_RENAMED' },
                { uri: Uri.file(`${ROOT_PATH}/modified.ts`), originalUri: Uri.file(`${ROOT_PATH}/modified.ts`), status: 'MODIFIED' },
            ],
        });
        const { tree } = await readRepositoryTree(repository, Date.parse('2026-09-22T00:00:00Z'));
        const by_path = new Map(tree.uncommitted.map(entry => [entry.path, entry]));
        expect(by_path.get('added.ts')?.change).toBe('added');
        expect(by_path.get('untracked.ts')?.change).toBe('added');
        expect(by_path.get('deleted.ts')?.change).toBe('deleted');
        expect(by_path.get('renamed.ts')?.change).toBe('renamed');
        expect(by_path.get('renamed.ts')?.previous_path).toBe('old.ts');
        expect(by_path.get('modified.ts')?.change).toBe('modified');
    });

    it('resolves a path relative to the repository root', async () => {
        const repository = makeRepository({
            workingTreeChanges: [{ uri: Uri.file(`${ROOT_PATH}/src/lib/foo.ts`), originalUri: Uri.file(`${ROOT_PATH}/src/lib/foo.ts`), status: 'MODIFIED' }],
        });
        const { tree } = await readRepositoryTree(repository, Date.now());
        expect(tree.uncommitted[0].path).toBe('src/lib/foo.ts');
        expect(tree.uncommitted[0].previous_path).toBeUndefined();
    });

    it('an index change wins over a working-tree change for the same path', async () => {
        const repository = makeRepository({
            workingTreeChanges: [{ uri: Uri.file(`${ROOT_PATH}/a.ts`), originalUri: Uri.file(`${ROOT_PATH}/a.ts`), status: 'MODIFIED' }],
            indexChanges: [{ uri: Uri.file(`${ROOT_PATH}/a.ts`), originalUri: Uri.file(`${ROOT_PATH}/a.ts`), status: 'INDEX_ADDED' }],
        });
        const { tree } = await readRepositoryTree(repository, Date.now());
        expect(tree.uncommitted).toHaveLength(1);
        expect(tree.uncommitted[0].change).toBe('added');
    });

    it('reads the branch and head commit from HEAD, and empty strings when there is none', async () => {
        const { tree } = await readRepositoryTree(makeRepository(), Date.now());
        expect(tree.branch).toBe('staging');
        expect(tree.head_commit).toBe('a'.repeat(40));
        const detached = await readRepositoryTree(makeRepository({ HEAD: undefined }), Date.now());
        expect(detached.tree.branch).toBe('');
        expect(detached.tree.head_commit).toBe('');
    });

    it('parses the reflog into committed entries and returns the raw reflog alongside the tree', async () => {
        const line = `${'0'.repeat(40)} ${'b'.repeat(40)} Alex Stanhope <alex@lightenna.com> 1758556800 +0000\tcommit: wire the analyser\n`;
        (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValueOnce(new TextEncoder().encode(line));
        const { tree, reflog } = await readRepositoryTree(makeRepository(), Date.now());
        expect(tree.committed).toEqual([{ sha: 'b'.repeat(40), subject: 'wire the analyser' }]);
        expect(reflog).toEqual([{ sha: 'b'.repeat(40), at_ms: 1758556800000, subject: 'wire the analyser' }]);
    });

    it('a repository with no reflog yet reads as no commits, not a failure', async () => {
        const { tree, reflog } = await readRepositoryTree(makeRepository(), Date.now());
        expect(tree.committed).toEqual([]);
        expect(reflog).toEqual([]);
    });
});

describe('lineDiffForFile', () => {
    const ROOT_URI = Uri.file(ROOT_PATH);

    // wires readFile so a `git:` scheme URI answers as the HEAD side and every other URI as the working-tree side, matching how gitHeadUri distinguishes the two
    function wireSides(head_bytes: Uint8Array | undefined, working_bytes: Uint8Array | undefined): void {
        (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
            if (uri.scheme === 'git') {
                if (head_bytes === undefined) { throw new Error('no such HEAD side'); }
                return head_bytes;
            }
            if (working_bytes === undefined) { throw new Error('no such working-tree side'); }
            return working_bytes;
        });
    }

    function bytesOf(text: string): Uint8Array {
        return new TextEncoder().encode(text);
    }

    it('counts added and removed lines for a modified file, reading both sides', async () => {
        wireSides(bytesOf('a\nb\nc\n'), bytesOf('a\nx\nc\n'));
        const counts = await lineDiffForFile(ROOT_URI, { path: 'src/foo.ts', change: 'modified' });
        expect(counts).toEqual({ added: 1, removed: 1 });
    });

    it('reads only the working-tree side for an added file, counting every line added', async () => {
        wireSides(undefined, bytesOf('a\nb\n'));
        const counts = await lineDiffForFile(ROOT_URI, { path: 'src/new.ts', change: 'added' });
        expect(counts).toEqual({ added: 2, removed: 0 });
    });

    it('reads only the HEAD side for a deleted file, counting every line removed', async () => {
        wireSides(bytesOf('a\nb\nc\n'), undefined);
        const counts = await lineDiffForFile(ROOT_URI, { path: 'src/gone.ts', change: 'deleted' });
        expect(counts).toEqual({ added: 0, removed: 3 });
    });

    it('reads the HEAD side at previous_path for a renamed file', async () => {
        let head_uri_path: string | undefined;
        (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
            if (uri.scheme === 'git') { head_uri_path = JSON.parse(uri.query).path; return bytesOf('a\n'); }
            return bytesOf('a\nb\n');
        });
        await lineDiffForFile(ROOT_URI, { path: 'src/new-name.ts', change: 'renamed', previous_path: 'src/old-name.ts' });
        expect(head_uri_path).toBe(`${ROOT_PATH}/src/old-name.ts`);
    });

    it('declines when a side the change kind promises should exist could not be read', async () => {
        wireSides(undefined, bytesOf('a\n'));
        const counts = await lineDiffForFile(ROOT_URI, { path: 'src/foo.ts', change: 'modified' });
        expect(counts).toBeUndefined();
    });

    it('declines when either side looks binary', async () => {
        wireSides(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]), bytesOf('a\n'));
        const counts = await lineDiffForFile(ROOT_URI, { path: 'image.png', change: 'modified' });
        expect(counts).toBeUndefined();
    });

    it('declines when either side is over the byte cap', async () => {
        wireSides(bytesOf('a'.repeat(300_000)), bytesOf('a\n'));
        const counts = await lineDiffForFile(ROOT_URI, { path: 'src/huge.ts', change: 'modified' });
        expect(counts).toBeUndefined();
    });
});

import { createHash } from 'crypto';
import { deflateSync } from 'zlib';
import { AGENT_PENDING_COMMIT_MAX_CHANGES, inflateObject, parseCommitBody, parseTreeBody, readCommitChanges, readPendingCommits, splitObject, type GitObjectReader } from './agentgitobjectops';

// an in-memory object store: every object is written as git does, `<type> <size>\0<body>`
class Store {
    objects = new Map<string, Uint8Array>();
    missing = new Set<string>();

    put(type: string, body: Buffer): string {
        const object = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
        const sha = createHash('sha1').update(object).digest('hex');
        this.objects.set(sha, new Uint8Array(object));
        return sha;
    }

    blob(text: string): string { return this.put('blob', Buffer.from(text)); }

    tree(entries: Array<{ name: string; sha: string; is_tree?: boolean }>): string {
        const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
        return this.put('tree', Buffer.concat(sorted.map(entry => Buffer.concat([Buffer.from(`${entry.is_tree ? '40000' : '100644'} ${entry.name}\0`), Buffer.from(entry.sha, 'hex')]))));
    }

    commit(tree: string, parents: string[], subject: string): string {
        const lines = [`tree ${tree}`, ...parents.map(parent => `parent ${parent}`), 'author A <a@b> 1 +0000', 'committer A <a@b> 1 +0000', '', subject, ''];
        return this.put('commit', Buffer.from(lines.join('\n')));
    }

    reader(): GitObjectReader {
        return async sha => (this.missing.has(sha) ? undefined : this.objects.get(sha));
    }
}

describe('object parsing', () => {
    it('inflates a zlib stream and says nothing for bytes that are not one', async () => {
        const inflated = await inflateObject(new Uint8Array(deflateSync(Buffer.from('blob 2\0hi'))));
        expect(new TextDecoder().decode(inflated)).toBe('blob 2\0hi');
        expect(await inflateObject(new Uint8Array([1, 2, 3]))).toBeUndefined();
    });

    it('splits an object into its type and body, and rejects one with no header', () => {
        expect(splitObject(new Uint8Array(Buffer.from('blob 2\0hi')))?.type).toBe('blob');
        expect(splitObject(new Uint8Array(Buffer.from('no header')))).toBeUndefined();
    });

    it('reads a commit\'s tree and every parent, ignoring the message', () => {
        const store = new Store();
        const tree = store.tree([]);
        const parent_a = store.commit(tree, [], 'a');
        const parent_b = store.commit(tree, [], 'b');
        const merge = store.commit(tree, [parent_a, parent_b], 'tree deadbeef parent nope');
        const parsed = parseCommitBody(splitObject(store.objects.get(merge)!)!.body);
        expect(parsed).toEqual({ tree, parents: [parent_a, parent_b] });
    });

    it('reads a tree\'s entries, marking subtrees and skipping a submodule', () => {
        const store = new Store();
        const blob = store.blob('x');
        const body = Buffer.concat([
            Buffer.from('100644 a.ts\0'), Buffer.from(blob, 'hex'),
            Buffer.from('40000 src\0'), Buffer.from(blob, 'hex'),
            Buffer.from('160000 vendor\0'), Buffer.from(blob, 'hex'),
        ]);
        expect(parseTreeBody(new Uint8Array(body))).toEqual([
            { name: 'a.ts', sha: blob, is_tree: false },
            { name: 'src', sha: blob, is_tree: true },
        ]);
    });
});

describe('readCommitChanges', () => {
    it('lists each changed file against the first parent, descending only into subtrees that differ', async () => {
        const store = new Store();
        const kept = store.blob('kept');
        const old_src = store.blob('old');
        const new_src = store.blob('new');
        const added = store.blob('added');
        const deep_tree = (blob: string): string => store.tree([{ name: 'inner.ts', sha: blob }]);
        const untouched_dir = store.tree([{ name: 'x.ts', sha: kept }]);
        const parent_tree = store.tree([{ name: 'keep', sha: untouched_dir, is_tree: true }, { name: 'src', sha: deep_tree(old_src), is_tree: true }, { name: 'gone.ts', sha: old_src }]);
        const commit_tree = store.tree([{ name: 'keep', sha: untouched_dir, is_tree: true }, { name: 'src', sha: deep_tree(new_src), is_tree: true }, { name: 'new.ts', sha: added }]);
        const parent = store.commit(parent_tree, [], 'parent');
        store.missing.add(untouched_dir);
        const changes = await readCommitChanges(store.reader(), commit_tree, parent);
        expect(changes).toEqual(expect.arrayContaining([
            { path: 'src/inner.ts', old_sha: old_src, new_sha: new_src },
            { path: 'gone.ts', old_sha: old_src, new_sha: undefined },
            { path: 'new.ts', old_sha: undefined, new_sha: added },
        ]));
        expect(changes).toHaveLength(3);
    });

    it('reads a root commit as every file added', async () => {
        const store = new Store();
        const blob = store.blob('x');
        const tree = store.tree([{ name: 'a.ts', sha: blob }]);
        expect(await readCommitChanges(store.reader(), tree, undefined)).toEqual([{ path: 'a.ts', old_sha: undefined, new_sha: blob }]);
    });

    it('reports nothing, not a partial list, when an object it needs is packed', async () => {
        const store = new Store();
        const blob = store.blob('x');
        const other = store.blob('y');
        const parent_tree = store.tree([{ name: 'a.ts', sha: other }]);
        const tree = store.tree([{ name: 'a.ts', sha: blob }]);
        const parent = store.commit(parent_tree, [], 'p');
        store.missing.add(parent_tree);
        expect(await readCommitChanges(store.reader(), tree, parent)).toBeUndefined();
    });

    it('reports nothing for a commit that changes more files than the bound', async () => {
        const store = new Store();
        const many = Array.from({ length: AGENT_PENDING_COMMIT_MAX_CHANGES + 1 }, (_unused, index) => ({ name: `f${index}.ts`, sha: store.blob(`c${index}`) }));
        expect(await readCommitChanges(store.reader(), store.tree(many), undefined)).toBeUndefined();
    });
});

describe('readPendingCommits', () => {
    function history(): { store: Store; upstream: string; first: string; second: string; third: string } {
        const store = new Store();
        const t0 = store.tree([{ name: 'a.ts', sha: store.blob('0') }]);
        const upstream = store.commit(t0, [], 'upstream');
        const first = store.commit(store.tree([{ name: 'a.ts', sha: store.blob('1') }]), [upstream], 'first');
        const second = store.commit(store.tree([{ name: 'a.ts', sha: store.blob('2') }]), [first], 'second');
        const third = store.commit(store.tree([{ name: 'a.ts', sha: store.blob('3') }]), [second], 'third');
        return { store, upstream, first, second, third };
    }

    it('lists the commits between HEAD and the upstream, newest first, each with its changed files', async () => {
        const { store, upstream, first, second, third } = history();
        const read = await readPendingCommits(store.reader(), third, upstream, 20);
        expect(read.commits.map(commit => commit.sha)).toEqual([third, second, first]);
        expect(read.reached_upstream).toBe(true);
        expect(read.commits.every(commit => commit.changes?.length === 1)).toBe(true);
    });

    it('stops at the bound and says it did not reach the upstream', async () => {
        const { store, upstream, second, third } = history();
        const read = await readPendingCommits(store.reader(), third, upstream, 2);
        expect(read.commits.map(commit => commit.sha)).toEqual([third, second]);
        expect(read.reached_upstream).toBe(false);
    });

    it('stops at a commit it cannot read, keeping the newer ones listed', async () => {
        const { store, upstream, first, second, third } = history();
        store.missing.add(first);
        const read = await readPendingCommits(store.reader(), third, upstream, 20);
        expect(read.commits.map(commit => commit.sha)).toEqual([third, second]);
        expect(read.reached_upstream).toBe(false);
    });

    it('follows first parents only through a merge', async () => {
        const { store, upstream, first, third } = history();
        const side = store.commit(store.tree([]), [upstream], 'side');
        const merge = store.commit(store.tree([{ name: 'a.ts', sha: store.blob('m') }]), [third, side], 'merge');
        const read = await readPendingCommits(store.reader(), merge, upstream, 20);
        expect(read.commits).toHaveLength(4);
        expect(read.commits.map(commit => commit.sha)).not.toContain(side);
        expect(read.commits.map(commit => commit.sha)).toContain(first);
    });
});

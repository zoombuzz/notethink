const ops = require('./watchops');

describe('classifyPath', () => {
    it.each([
        ['pnpm-lock.yaml', 'install'],
        ['client/extension/pnpm-lock.yaml', 'install'],
        ['client/webview/pnpm-lock.yaml', 'install'],
        ['client/webview/src/notethink-views/pnpm-lock.yaml', 'install'],
        ['pnpm-workspace.yaml', 'install'],
        ['webpack.config.js', 'restart'],
        ['tsconfig.json', 'restart'],
        ['client/extension/tsconfig.json', 'restart'],
        ['client/webview/tsconfig.jest.json', 'restart'],
        ['client/webview/src/notethink-views/tsconfig.json', 'restart'],
        ['package.json', 'package'],
        ['client/webview/package.json', 'package'],
    ])('%s is %s', (rel, expected) => {
        expect(ops.classifyPath(rel)).toBe(expected);
    });

    it.each([
        'README.md',
        'client/extension/src/extension.ts',
        'client/extension/webpack.config.js',
        'node_modules/foo/package.json',
        'client/webview/node_modules/foo/pnpm-lock.yaml',
        'docstech/users/someone/todo.md',
        'client/other/package.json',
        'package-lock.json',
    ])('%s is ignored', (rel) => {
        expect(ops.classifyPath(rel)).toBe('none');
    });

    it('accepts backslash and dot-slash spellings', () => {
        expect(ops.classifyPath('.\\client\\extension\\pnpm-lock.yaml')).toBe('install');
        expect(ops.classifyPath('./webpack.config.js')).toBe('restart');
    });
});

describe('dependencyFingerprint', () => {
    const base = { name: 'x', version: '1.0.0', dependencies: { a: '^1' }, devDependencies: { b: '^2' } };

    it('ignores a version bump and unrelated fields', () => {
        const bumped = { ...base, version: '1.0.1', displayName: 'other', scripts: { watch: 'x' } };
        expect(ops.dependencyFingerprint(JSON.stringify(bumped))).toBe(ops.dependencyFingerprint(JSON.stringify(base)));
    });

    it('ignores key order', () => {
        const reordered = { devDependencies: { b: '^2' }, dependencies: { a: '^1' } };
        expect(ops.dependencyFingerprint(JSON.stringify(reordered))).toBe(ops.dependencyFingerprint(JSON.stringify(base)));
    });

    it('changes when a dependency range, the pnpm block or packageManager changes', () => {
        const before = ops.dependencyFingerprint(JSON.stringify(base));
        expect(ops.dependencyFingerprint(JSON.stringify({ ...base, dependencies: { a: '^2' } }))).not.toBe(before);
        expect(ops.dependencyFingerprint(JSON.stringify({ ...base, pnpm: { overrides: { c: '1' } } }))).not.toBe(before);
        expect(ops.dependencyFingerprint(JSON.stringify({ ...base, packageManager: 'pnpm@12.0.0' }))).not.toBe(before);
    });

    it('treats unparseable text as changed whenever the text differs', () => {
        expect(ops.dependencyFingerprint('{ nope')).not.toBe(ops.dependencyFingerprint('{ nope2'));
    });
});

describe('planBatch', () => {
    const never = () => false;
    const always = () => true;

    it('is none for an empty batch and for unwatched paths', () => {
        expect(ops.planBatch([], never)).toBe('none');
        expect(ops.planBatch(['client/extension/src/a.ts', 'README.md'], never)).toBe('none');
    });

    it('restarts for a config change', () => {
        expect(ops.planBatch(['webpack.config.js'], never)).toBe('restart');
        expect(ops.planBatch(['client/extension/tsconfig.json'], never)).toBe('restart');
    });

    it('installs for a lockfile change', () => {
        expect(ops.planBatch(['client/webview/pnpm-lock.yaml'], never)).toBe('install');
    });

    it('lets install win over restart in one batch', () => {
        expect(ops.planBatch(['webpack.config.js', 'pnpm-lock.yaml', 'tsconfig.json'], never)).toBe('install');
    });

    it('installs for a package.json whose dependencies changed', () => {
        expect(ops.planBatch(['client/webview/package.json'], always)).toBe('install');
        expect(ops.planBatch(['package.json'], always)).toBe('install');
    });

    it('restarts for a root package.json change that is not a dependency change, ignores nested ones', () => {
        expect(ops.planBatch(['package.json'], never)).toBe('restart');
        expect(ops.planBatch(['client/webview/package.json'], never)).toBe('none');
    });

    it('asks depsChanged about the package.json path itself', () => {
        const asked = [];
        ops.planBatch(['client/extension/package.json'], (rel) => { asked.push(rel); return false; });
        expect(asked).toEqual(['client/extension/package.json']);
    });
});

describe('watchDirs and relPath', () => {
    it('lists the root and the three nested package directories', () => {
        expect(ops.watchDirs()).toEqual(['', 'client/extension', 'client/webview', 'client/webview/src/notethink-views']);
    });

    it('joins directory and name', () => {
        expect(ops.relPath('', 'a.json')).toBe('a.json');
        expect(ops.relPath('client/webview', 'a.json')).toBe('client/webview/a.json');
    });
});

describe('createBatcher', () => {
    function fakeTimers() {
        let next = 1;
        const live = new Map();
        return {
            setTimer: (fn, ms) => { const id = next++; live.set(id, { fn, ms }); return id; },
            clearTimer: (id) => { live.delete(id); },
            fire: () => { const [id, t] = [...live][0]; live.delete(id); t.fn(); },
            count: () => live.size,
            delayOfLive: () => [...live.values()][0].ms,
        };
    }

    it('flushes many changes as one batch, de-duplicated', () => {
        const timers = fakeTimers();
        const flushed = [];
        const batcher = ops.createBatcher({ delay: 500, onFlush: (b) => flushed.push(b), ...timers });
        batcher.add('pnpm-lock.yaml');
        batcher.add('webpack.config.js');
        batcher.add('pnpm-lock.yaml');
        expect(flushed).toEqual([]);
        expect(timers.count()).toBe(1);
        expect(timers.delayOfLive()).toBe(500);
        timers.fire();
        expect(flushed).toEqual([['pnpm-lock.yaml', 'webpack.config.js']]);
        expect(batcher.size()).toBe(0);
    });

    it('restarts the quiet period on each change', () => {
        const timers = fakeTimers();
        const batcher = ops.createBatcher({ onFlush: () => {}, ...timers });
        batcher.add('a');
        batcher.add('b');
        expect(timers.count()).toBe(1);
        expect(timers.delayOfLive()).toBe(ops.DEBOUNCE_MS);
    });

    it('starts a new batch after a flush', () => {
        const timers = fakeTimers();
        const flushed = [];
        const batcher = ops.createBatcher({ onFlush: (b) => flushed.push(b), ...timers });
        batcher.add('a');
        timers.fire();
        batcher.add('b');
        timers.fire();
        expect(flushed).toEqual([['a'], ['b']]);
    });

    it('cancel drops pending changes without flushing', () => {
        const timers = fakeTimers();
        const flushed = [];
        const batcher = ops.createBatcher({ onFlush: (b) => flushed.push(b), ...timers });
        batcher.add('a');
        batcher.cancel();
        expect(timers.count()).toBe(0);
        expect(batcher.size()).toBe(0);
        expect(flushed).toEqual([]);
    });
});

/**
 * Decision logic for scripts/watch.mjs, kept free of fs, child processes and real timers so a Jest
 * suite can drive it. CommonJS because the Jest project that runs it transforms .js files and the
 * supervisor imports it as a default import.
 *
 * Actions are ordered by how much work they cost: none < restart < install. A debounced batch of
 * changed paths resolves to the strongest action any one path asks for.
 */

const ACTION_NONE = 'none';
const ACTION_RESTART = 'restart';
const ACTION_INSTALL = 'install';

// the directories holding a package.json, a lockfile or a tsconfig; all are watched non-recursively
const PACKAGE_DIRS = ['', 'client/extension', 'client/webview', 'client/webview/src/notethink-views'];

const DEBOUNCE_MS = 750;

const ACTION_RANK = { [ACTION_NONE]: 0, [ACTION_RESTART]: 1, [ACTION_INSTALL]: 2 };

// package.json fields that change what pnpm installs
const DEPENDENCY_FIELDS = [
    'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
    'peerDependenciesMeta', 'overrides', 'resolutions', 'pnpm', 'packageManager', 'engines',
];

/** Joins a watched directory and a file name into a repo-relative posix path. */
function relPath(dir, name) {
    return dir ? `${dir}/${name}` : name;
}

/** The directories to watch, as repo-relative posix paths ('' is the repo root). */
function watchDirs() {
    return PACKAGE_DIRS.slice();
}

/**
 * Classifies one changed repo-relative path. A package.json is reported as 'package' because whether
 * it means an install depends on its content (see packageJsonAction).
 */
function classifyPath(rel) {
    const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    const slash = norm.lastIndexOf('/');
    const dir = slash === -1 ? '' : norm.slice(0, slash);
    const name = slash === -1 ? norm : norm.slice(slash + 1);
    if (!PACKAGE_DIRS.includes(dir)) { return ACTION_NONE; }
    if (name === 'pnpm-lock.yaml' || name === 'pnpm-workspace.yaml') { return ACTION_INSTALL; }
    if (name === 'package.json') { return 'package'; }
    if (name === 'webpack.config.js') { return dir === '' ? ACTION_RESTART : ACTION_NONE; }
    if (/^tsconfig(\.[\w-]+)*\.json$/.test(name)) { return ACTION_RESTART; }
    return ACTION_NONE;
}

/** A stable string of the package.json fields that change what gets installed. */
function dependencyFingerprint(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (_err) {
        return `unparseable:${text}`;
    }
    const picked = {};
    for (const field of DEPENDENCY_FIELDS) {
        if (parsed && parsed[field] !== undefined) { picked[field] = parsed[field]; }
    }
    return JSON.stringify(picked, (_key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        }
        return value;
    });
}

/**
 * What a package.json change asks for. A dependency change installs; otherwise the root file restarts
 * (webpack.config.js reads its version) and the nested ones do nothing.
 */
function packageJsonAction(rel, deps_changed) {
    if (deps_changed) { return ACTION_INSTALL; }
    return rel === 'package.json' ? ACTION_RESTART : ACTION_NONE;
}

/** The strongest of several actions. */
function strongestAction(actions) {
    let best = ACTION_NONE;
    for (const action of actions) {
        if (ACTION_RANK[action] > ACTION_RANK[best]) { best = action; }
    }
    return best;
}

/**
 * Resolves a batch of changed paths to one action. depsChanged(rel) answers whether a package.json's
 * installable fields differ from the last install.
 */
function planBatch(paths, depsChanged) {
    const actions = [];
    for (const rel of paths) {
        const kind = classifyPath(rel);
        actions.push(kind === 'package' ? packageJsonAction(rel, depsChanged(rel)) : kind);
    }
    return strongestAction(actions);
}

/**
 * Collects changed paths and flushes them once the changes go quiet, so a pull touching many files
 * costs one restart. Timers are injected for tests.
 */
function createBatcher({ delay = DEBOUNCE_MS, onFlush, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let pending = new Set();
    let handle = null;
    function flush() {
        handle = null;
        const batch = [...pending];
        pending = new Set();
        if (batch.length > 0) { onFlush(batch); }
    }
    return {
        add(rel) {
            pending.add(rel);
            if (handle !== null) { clearTimer(handle); }
            handle = setTimer(flush, delay);
        },
        cancel() {
            if (handle !== null) { clearTimer(handle); }
            handle = null;
            pending = new Set();
        },
        size() { return pending.size; },
    };
}

module.exports = {
    ACTION_NONE, ACTION_RESTART, ACTION_INSTALL, DEBOUNCE_MS,
    relPath, watchDirs, classifyPath, dependencyFingerprint, packageJsonAction,
    strongestAction, planBatch, createBatcher,
};

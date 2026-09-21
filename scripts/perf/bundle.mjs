/*
 * Builds the webview bundle a perf run measures, explicitly and by mode.
 *
 * The runner never assumes what `pnpm run build` currently emits: webpack.config.js has changed
 * which React flavour the default build carries before now, and a measurement that silently
 * followed it would compare two different bundles across two runs. Each mode therefore sets its
 * own environment and builds through scripts/perf/webpack.perf.cjs.
 *
 * - `production`: NODE_ENV=production, SELFINSPECT_ENV cleared. webpack mode 'production', so the
 *   bundle is minified and NOTETHINK_DEV is false - the shape `pnpm run package` ships.
 * - `dev`: SELFINSPECT_ENV=dev, NODE_ENV cleared. The shape `pnpm run build` and `pnpm run watch`
 *   produce for the dev host: webpack mode 'none', unminified, NOTETHINK_DEV true. Its React
 *   flavour is whatever webpack.config.js pins through `optimization.nodeEnv`; the runner reads
 *   that from the built bundle rather than asserting it here.
 */
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BUNDLE_MODES = ['production', 'dev'];

// environment overrides per mode; a null value deletes the inherited variable rather than emptying it
const MODE_ENV = {
    production: { NODE_ENV: 'production', SELFINSPECT_ENV: null },
    dev: { NODE_ENV: null, SELFINSPECT_ENV: 'dev' },
};

// the directory a mode's bundle is built into, under the gitignored test-results tree
function bundleDir(repo_root, mode) {
    return join(repo_root, 'test-results', 'perf-bundles', mode);
}

// assemble the child environment for a mode, deleting the keys the mode clears
function bundleEnv(mode, out_dir) {
    const env = { ...process.env, NOTETHINK_PERF_OUT: out_dir };
    for (const [key, value] of Object.entries(MODE_ENV[mode])) {
        if (value === null) { delete env[key]; } else { env[key] = value; }
    }
    return env;
}

/**
 * Run webpack for one mode and resolve once it exits 0, rejecting with its output otherwise.
 * Webpack's own logging is captured rather than inherited so a green build stays quiet and a
 * failed one reports the whole log in the rejection.
 */
function runWebpack(repo_root, mode, out_dir) {
    const webpack_bin = join(repo_root, 'node_modules', '.bin', 'webpack');
    const args = ['--config', join('scripts', 'perf', 'webpack.perf.cjs')];
    return new Promise((resolve, reject) => {
        const child = spawn(webpack_bin, args, { cwd: repo_root, env: bundleEnv(mode, out_dir) });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) { resolve(output); return; }
            reject(new Error(`webpack exited ${code} building the ${mode} bundle:\n${output}`));
        });
    });
}

/**
 * Build (or, with skip_build, reuse) the bundle for `mode` and return where it landed plus the
 * facts a report needs to say which bundle produced a number. `minified` and `react_build` are read
 * back off the built file, so they describe what was measured rather than what was intended.
 */
export async function prepareBundle(repo_root, mode, { skip_build = false } = {}) {
    if (!BUNDLE_MODES.includes(mode)) {
        throw new Error(`unknown bundle mode ${mode}, expected one of ${BUNDLE_MODES.join(', ')}`);
    }
    const out_dir = bundleDir(repo_root, mode);
    const bundle_path = join(out_dir, 'index.js');
    if (skip_build) {
        await access(bundle_path).catch(() => {
            throw new Error(`--no-build was passed but ${bundle_path} does not exist - run once without it`);
        });
    } else {
        await runWebpack(repo_root, mode, out_dir);
    }
    return { mode, out_dir, bundle_path, ...await describeBundle(bundle_path) };
}

/*
 * Read the built bundle back for the two facts that decide how fast it runs. Both are measured off
 * the file rather than inferred from the mode, so the report describes the bundle that produced a
 * number even after webpack.config.js changes underneath.
 *
 * Minification is judged on mean line length: a minified bundle is a handful of very long lines,
 * and its first line is the short license banner, so the first line alone says nothing. The React
 * build is judged on a warning string only react-dom's development build carries.
 */
async function describeBundle(bundle_path) {
    const source = await readFile(bundle_path, 'utf-8');
    const line_count = source.split('\n').length;
    return {
        bytes: source.length,
        minified: source.length / line_count > 5000,
        react_build: source.includes('should have a unique') ? 'development' : 'production',
    };
}

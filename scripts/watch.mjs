#!/usr/bin/env node
/**
 * `pnpm run watch`: runs `webpack --watch` as a child and keeps it current with the files webpack
 * itself never re-reads. webpack watches only its module graph, so an edited webpack.config.js or
 * tsconfig is ignored until the process restarts, and a changed lockfile leaves node_modules stale.
 *
 * - webpack.config.js or tsconfig*.json changes restart webpack.
 * - a lockfile or a package.json dependency change stops webpack, runs `pnpm install --frozen-lockfile`,
 *   then restarts it; a failed install is reported loudly and webpack stays down until the next change.
 * - changes are debounced, so a pull touching many files costs one cycle.
 * - SIGINT and SIGTERM stop the child (its whole process group) before this process exits.
 *
 * The decisions live in scripts/watchops.js. The child's command line is `webpack --watch` with the repo
 * root as cwd, which is how a running watcher is found.
 */
import { spawn } from 'node:child_process';
import { readFileSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ops from './watchops.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KILL_GRACE_MS = 10000;

const installed_fingerprints = new Map();
let child = null;
let stopping_child = false;
let shutting_down = false;
let cycle_running = false;
let queued_batch = [];

function log(message) {
    console.log(`[watch ${new Date().toISOString()}] ${message}`);
}

function logLoud(message) {
    const bar = '!'.repeat(78);
    console.error(`\n${bar}\n[watch ${new Date().toISOString()}] ${message}\n${bar}\n`);
}

function readFingerprint(rel) {
    try {
        return ops.dependencyFingerprint(readFileSync(join(ROOT, rel), 'utf8'));
    } catch (_err) {
        return 'unreadable';
    }
}

function snapshotFingerprints() {
    for (const dir of ops.watchDirs()) {
        const rel = ops.relPath(dir, 'package.json');
        installed_fingerprints.set(rel, readFingerprint(rel));
    }
}

function depsChanged(rel) {
    return installed_fingerprints.get(rel) !== readFingerprint(rel);
}

function startWebpack() {
    // `; exit $?` keeps the shell from exec-ing, so the command line stays `webpack --watch`
    child = spawn('sh', ['-c', 'webpack --watch; exit $?'], {
        cwd: ROOT,
        stdio: 'inherit',
        detached: true,
        env: { ...process.env, PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH}` },
    });
    const started = child;
    log(`webpack --watch started (pid ${started.pid})`);
    started.on('exit', (code, signal) => {
        if (child === started) { child = null; }
        if (stopping_child || shutting_down) { return; }
        log(`webpack exited on its own (code ${code}, signal ${signal}); exiting`);
        process.exit(code ?? 1);
    });
}

function signalGroup(signal) {
    if (!child) { return; }
    try {
        process.kill(-child.pid, signal);
    } catch (_err) {
        // the group is already gone
    }
}

function stopWebpack() {
    if (!child) { return Promise.resolve(); }
    const stopping = child;
    stopping_child = true;
    return new Promise((resolve) => {
        const escalate = setTimeout(() => {
            log('webpack ignored SIGTERM; sending SIGKILL');
            signalGroup('SIGKILL');
        }, KILL_GRACE_MS);
        stopping.on('exit', () => {
            clearTimeout(escalate);
            stopping_child = false;
            resolve();
        });
        signalGroup('SIGTERM');
    });
}

function runInstall() {
    return new Promise((resolve) => {
        log('running pnpm install --frozen-lockfile');
        const install = spawn('pnpm', ['install', '--frozen-lockfile'], { cwd: ROOT, stdio: 'inherit' });
        install.on('error', (err) => {
            logLoud(`could not run pnpm install: ${err.message}`);
            resolve(false);
        });
        install.on('exit', (code) => resolve(code === 0));
    });
}

async function applyBatch(batch) {
    const action = ops.planBatch(batch, depsChanged);
    if (action === ops.ACTION_NONE) { return; }
    log(`${batch.join(', ')} changed: ${action}`);
    await stopWebpack();
    if (shutting_down) { return; }
    if (action === ops.ACTION_INSTALL) {
        const ok = await runInstall();
        if (!ok) {
            logLoud('pnpm install --frozen-lockfile FAILED: webpack is NOT running. '
                + 'Fix the lockfile or package.json (the next change retries) or restart `pnpm run watch`.');
            return;
        }
        snapshotFingerprints();
    }
    if (!shutting_down) { startWebpack(); }
}

async function onBatch(batch) {
    queued_batch.push(...batch);
    if (cycle_running) { return; }
    cycle_running = true;
    try {
        while (queued_batch.length > 0 && !shutting_down) {
            const next = queued_batch;
            queued_batch = [];
            await applyBatch(next);
        }
    } finally {
        cycle_running = false;
    }
}

async function shutDown(signal) {
    if (shutting_down) { return; }
    shutting_down = true;
    log(`${signal} received; stopping webpack`);
    await stopWebpack();
    process.exit(0);
}

snapshotFingerprints();
const batcher = ops.createBatcher({ onFlush: onBatch });
for (const dir of ops.watchDirs()) {
    watch(join(ROOT, dir), { persistent: true }, (_event, name) => {
        if (name) { batcher.add(ops.relPath(dir, String(name))); }
    });
}
process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
startWebpack();

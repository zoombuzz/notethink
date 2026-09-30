#!/usr/bin/env node
/**
 * Host-responsiveness probe for the extension-host parse offload. `pnpm run test-perf` drives the
 * webview bundle in a browser and never touches the extension host, so this measures directly in
 * plain Node, using `node:worker_threads` in place of the real `Worker` global. `parse()` below
 * mirrors `client/extension/src/lib/parseops.ts` byte-for-byte since this script has no build step.
 *
 * Simulates a keystroke storm of re-parses, run inline and offloaded across a worker pool, while a
 * lightweight timer measures the worst gap between its own ticks as a stand-in for an unrelated
 * extension-host request.
 *
 * Run: `node scripts/perf/host-responsiveness.mjs`. Exits non-zero if the offloaded path's worst gap
 * exceeds PING_BUDGET_MS, the <=100ms interleaving criterion for the real Worker implementation.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';

// mirrors client/extension/src/lib/parseops.ts's parse() exactly - same call, same extensions
function parse(text) {
    return fromMarkdown(text, {
        extensions: [gfm(), frontmatter(['yaml', 'toml'])],
        mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml', 'toml'])],
    });
}

// doubles as its own worker entry: off the main thread, parses whatever text it's sent and returns the result
if (!isMainThread) {
    parentPort.on('message', (text) => { parentPort.postMessage(parse(text)); });
}

// synthetic done.md-shaped document: `sections` headed blocks of `lines_per_section` bullet lines each
function buildFixture(sections, lines_per_section) {
    const lines = [];
    for (let s = 0; s < sections; s++) {
        lines.push(`## Story ${s}`);
        for (let l = 0; l < lines_per_section; l++) { lines.push(`- line ${l} of story ${s}: representative body text padding this section out to a realistic width.`); }
    }
    return lines.join('\n');
}

const FIXTURE_400KB = buildFixture(70, 60);
const KEYSTROKE_STORM_SIZE = 8;
const POOL_SIZE = 2;
const PING_INTERVAL_MS = 5;
const PING_BUDGET_MS = 100;

// runs `work` while a timer ticks on this thread; returns the largest gap, the worst-case latency an unrelated request would see
async function measureMaxEventLoopGap(work) {
    const gaps = [];
    let last = performance.now();
    const timer = setInterval(() => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
    }, PING_INTERVAL_MS);
    await work();
    clearInterval(timer);
    return gaps.length > 0 ? Math.max(...gaps) : 0;
}

// the keystroke storm run entirely inline, on the thread doing the measuring - the pre-offload shape
async function runInline(text, count) {
    for (let i = 0; i < count; i++) { parse(text); }
}

// the same storm dispatched across a small worker pool, round-robin, awaiting every job - the ParsePool shape
async function runOffloaded(text, count, pool_size) {
    const workers = Array.from({ length: pool_size }, () => new Worker(fileURLToPath(import.meta.url)));
    try {
        const jobs = Array.from({ length: count }, (_unused, index) => index);
        await Promise.all(jobs.map((_job, index) => {
            const worker = workers[index % pool_size];
            return new Promise((resolve, reject) => {
                worker.once('message', resolve);
                worker.once('error', reject);
                worker.postMessage(text);
            });
        }));
    } finally {
        await Promise.all(workers.map(worker => worker.terminate()));
    }
}

async function main() {
    /*
     * The inline path is synchronous and single-threaded, so its own elapsed time IS the worst-case
     * latency anything else on that thread would see; a ping timer can't measure a blocked event
     * loop, since the block would also stop the ping's own callback from firing.
     */
    const inline_start = performance.now();
    await runInline(FIXTURE_400KB, KEYSTROKE_STORM_SIZE);
    const inline_elapsed = performance.now() - inline_start;

    // the offloaded path yields its own thread between dispatch and answer, so a ping timer here measures something real
    const offloaded_start = performance.now();
    const offloaded_max_gap = await measureMaxEventLoopGap(() => runOffloaded(FIXTURE_400KB, KEYSTROKE_STORM_SIZE, POOL_SIZE));
    const offloaded_elapsed = performance.now() - offloaded_start;

    console.log(`fixture: ${(FIXTURE_400KB.length / 1024).toFixed(0)}KB, ${KEYSTROKE_STORM_SIZE} parses, pool_size=${POOL_SIZE}, ping every ${PING_INTERVAL_MS}ms`);
    console.log(`inline:    ${inline_elapsed.toFixed(0)}ms total - the thread is unavailable to anything else for this entire window`);
    console.log(`offloaded: ${offloaded_elapsed.toFixed(0)}ms total, worst interleaved-ping latency ${offloaded_max_gap.toFixed(1)}ms`);

    if (offloaded_max_gap > PING_BUDGET_MS) {
        console.error(`FAIL: offloaded worst ping gap ${offloaded_max_gap.toFixed(1)}ms exceeds the ${PING_BUDGET_MS}ms interleaving budget`);
        process.exitCode = 1;
        return;
    }
    console.log(`PASS: offloaded worst interleaved-ping latency stays within the ${PING_BUDGET_MS}ms budget (inline would have blocked the thread for the full ${inline_elapsed.toFixed(0)}ms instead)`);
}

if (isMainThread) { await main(); }

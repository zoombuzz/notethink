#!/usr/bin/env node
/**
 * NoteThink performance harness: `pnpm run test-perf`. Drives the real webview bundle in a headless
 * Chromium, posting the exact wire-format messages PanelSession.ts posts, and reports elapsed time
 * and long-task cost per scenario as JSON at test-results/perf.json, checked against
 * scripts/perf/budgets.mjs (a breach exits non-zero). It measures the built bundle and the real
 * message shapes, not a model of either; CI is out of scope since it skips Playwright's browser
 * download.
 *
 * BUNDLE: never inferred from `pnpm run build`'s current output - built fresh into
 * test-results/perf-bundles/<mode>/ so a run never overwrites the dev host's bundle. Default mode
 * is the production/marketplace shape; `--dev-bundle` builds the unminified dev-workflow shape
 * (reports breaches but does not gate on them, since it carries a fixed lazy-compilation cost the
 * production budgets don't account for). A failed scenario still exits non-zero in either mode.
 *
 * MEASUREMENT: a scenario dispatches its messages, then waits for the board to settle (mounted card
 * count reaches the expected total, or the commit probe goes quiet) plus two animation frames. Long
 * tasks come from a buffered PerformanceObserver installed before the bundle evaluates.
 *
 * READING THE NUMBERS: `elapsed_ms` floors at ~50ms (three frames) from the settle definition, so a
 * budget below ~60ms mostly measures the instrument - use `long_task_max_ms` instead.
 * `long_task_max_ms` counts from the first dispatch, not first paint, so it includes the initial
 * mount's own task; check its offset against `board_commit_offsets_ms` before treating a peak as a
 * regression. `board_commits`/`conversions` don't vary with machine load, so trust the count over
 * timing when they disagree.
 *
 * SCENARIOS: folder-progressive-N is a folder board filling via the batched discovery wire (200 is
 * the extension's MAX_AGGREGATE_FILES cap); folder-progressive-50-unbatched is the pre-batching,
 * one-message-per-file control; folder-interactions-N is a settled board taking a click, a caret
 * move and an unbatched file change; single-file-100k/-400k is one kanban file opening then re-sent
 * on a debounced edit; folder-long-files-10 is 10 files at the done.md scale, testing payload size
 * under the batch cap.
 *
 * ADDING A SCENARIO (scripts/perf/scenarios.mjs): reuse an existing factory or return
 * `{ id, label, metric_ids, async run(context) }`; give every measurement a unique metric id via
 * measureStep; build a folder stream with discoveryMessages() rather than by hand, re-reading
 * PanelSession's message grouping since it has changed before; budget it in budgets.mjs only once
 * measured (a timing budget is the measurement plus 20%; a probe count is exact), with the baseline
 * recorded via `--update-baseline`.
 *
 * FLAGS (after the script name): `--dev-bundle`, `--no-build`, `--only <ids>`, `--list`,
 * `--out <path>`, `--update-baseline`. A full run costs several minutes (the 200-file load
 * dominates); use `--only`/`--no-build` while iterating, but run the whole set before trusting a
 * result.
 *
 * Reports print to stdout via console.log; nothing else under scripts/perf/ logs that way.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, hostname, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBundle } from './bundle.mjs';
import { BUDGETS } from './budgets.mjs';
import { launchBrowser, startHarnessServer } from './harness.mjs';
import { SCENARIOS } from './scenarios.mjs';

const PERF_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PERF_DIR, '..', '..');
const DEFAULT_REPORT = join(REPO_ROOT, 'test-results', 'perf.json');
const BASELINE_PATH = join(PERF_DIR, 'baseline.json');
/*
 * Which delivery model the folder scenarios post, recorded in every baseline. A folder number means
 * nothing without it: the same code measures an order of magnitude apart depending on whether
 * discovery arrives one message per file or one per batch, so a ratchet that compares across two
 * values of this is comparing two different products. Change it whenever discoveryMessages changes.
 */
const WIRE_MODEL = 'batched-discovery, text-only folder docs: spinner, one merge update per flushed batch (content omitted), aggregate replace, spinner';

/*
 * What each measured field means, written into the report so the semantics travel with the numbers.
 * A reader who opens perf.json months from now has the JSON and nothing else, and the two facts
 * that have actually misled people - the settle floor under elapsed_ms, and the long-task window
 * opening at the first dispatch rather than at first paint - are invisible in a bare number.
 */
const FIELD_NOTES = {
    elapsed_ms: 'first dispatch until the board settles, then two animation frames. For a single interaction that is DOM count reaching the target; for a progressive folder load it is story_count reaching the target AND commit quiescence; for a progressive single-file load (no merge probe) it is DOM count reaching the target OR commit quiescence. Carries a floor of roughly three frames (~50ms), so a target below ~60ms is measuring the instrument. Use long_task_max_ms at that scale.',
    long_task_max_ms: 'longest single long task in the window. Budgetable on its own, and unaffected by the settle floor.',
    long_task_max_offset_ms: 'when that task began, relative to the FIRST DISPATCH, not to first paint. The first-paint task is therefore counted, making this stricter than a criterion phrased "after the first paint". Read it against board_commit_offsets_ms: a peak sitting on the first commit is the initial mount.',
    board_commit_offsets_ms: 'when each board-level state commit landed, relative to the first dispatch. Correlate with long_task_max_offset_ms to attribute a long task to the commit that caused it.',
    board_commits: 'board-level state commits, from the webview probe. Does not vary with machine load; the webview folds messages landing in one frame, so a busy machine commits fewer, never more.',
    conversions: 'per-doc convertMdastToNoteHierarchy calls, from the merge probe. Does not vary with machine load. Where a timing and a count disagree about a regression, believe the count.',
    cards: 'DOM nodes carrying [data-flip-id] at the end of the measured window. Once a lane is windowed this plateaus at roughly one screenful for any board wider than that; mounted_cards and story_count give the finer-grained reads on a virtualized board.',
    mounted_cards: 'identical reading to cards, named for what it measures under virtualization: DOM nodes currently mounted, not the true story count. A virtualization budget asserts mounted_cards <= visible + overscan here.',
    story_count: 'the merged tree\'s own top-level story count, from the merge probe - unaffected by virtualization, since it reads the data model rather than the DOM. null when the bundle carries no probe or it never ran (single-file mode). This, not cards/mounted_cards, is what a folder-mode settle() actually waits on.',
    stalled: 'true when settle() gave up early because nothing progressed (no new commit, no growing story/card count) for STALL_MS, rather than running out the full settle_timeout_ms. A stalled result is worth investigating as a real regression; a non-stalled timeout just needs more budget or is a genuine slowdown.',
    heap_used_mb: 'JS heap in use once the board settled, via a CDP Performance.getMetrics session (harness.mjs readHeapUsedMb), rounded to 0.1MB. null when the reading failed (a crashed or closed target). Varies enormously with file SHAPE, not just file count: a small number of large files can use far more heap than many small ones of the same total size, since mdast\'s own per-node representation dominates.',
};

function parseArgs(argv) {
    const options = { bundle_mode: 'production', skip_build: false, only: undefined, list: false, out: DEFAULT_REPORT, update_baseline: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        // pnpm forwards a bare `--` separator into argv, and a reader who typed it meant nothing by it
        if (arg === '--') { continue; }
        if (arg === '--dev-bundle') { options.bundle_mode = 'dev'; }
        else if (arg === '--no-build') { options.skip_build = true; }
        else if (arg === '--list') { options.list = true; }
        else if (arg === '--update-baseline') { options.update_baseline = true; }
        else if (arg === '--only') { index += 1; options.only = argv[index]; }
        else if (arg === '--out') { index += 1; options.out = resolve(argv[index]); }
        else { throw new Error(`unknown argument ${arg} - see the header of scripts/perf/run.mjs`); }
    }
    return options;
}

// the machine and tree a number came from, so a baseline is interpretable months later
function describeEnvironment() {
    let commit = 'unknown';
    try {
        commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
    } catch {
        // a tree without git still measures fine; the baseline just cannot name the commit it came from
    }
    const cpu_list = cpus();
    return {
        hostname: hostname(),
        platform: process.platform,
        node: process.version,
        cpu_model: cpu_list.length ? cpu_list[0].model : 'unknown',
        cpu_count: cpu_list.length,
        memory_gb: Math.round(totalmem() / 1024 / 1024 / 1024),
        commit,
    };
}

/**
 * Compare one measurement against its budget. A measurement that errored or never settled is a
 * breach in itself, whatever its numbers say.
 *
 * A probe count of null, meaning the bundle carried no such probe, never breaches: the comparison
 * is false and the field reports as a dash. That is deliberate. A missing probe is an absence of
 * evidence, and failing the gate on it would say the code got worse when nothing was measured.
 */
function checkBudget(metric_id, measurement) {
    const budget = BUDGETS[metric_id];
    const breaches = [];
    if (measurement.error) {
        breaches.push({ metric_id, field: 'error', detail: measurement.error });
        return { budget, breaches };
    }
    if (measurement.settled === false) {
        // a stall (no progress before STALL_MS) is a more actionable finding than a timeout still progressing at the deadline
        const detail = measurement.stalled
            ? `stalled: no progress (commit/story-count) for several seconds - board reached ${measurement.cards} of ${measurement.story_count ?? '?'} cards/stories and stopped changing`
            : `timed out still progressing: board reached ${measurement.cards} cards and ${measurement.story_count ?? '?'} stories at the settle_timeout_ms deadline`;
        breaches.push({ metric_id, field: 'settled', detail });
    }
    if (!budget) { return { budget, breaches }; }
    for (const [field, limit] of Object.entries(budget)) {
        if (measurement[field] > limit) {
            breaches.push({ metric_id, field, limit, measured: measurement[field] });
        }
    }
    return { budget, breaches };
}

/*
 * Resolve --only to a scenario list. An exact scenario or metric id wins outright, because the ids
 * nest (folder-progressive-20 is a prefix of folder-progressive-200) and a substring match would
 * quietly hand back a scenario two orders of magnitude slower than the one asked for. Several ids
 * may be given, comma-separated.
 */
function selectScenarios(only) {
    if (!only) { return SCENARIOS; }
    const wanted = only.split(',').map((term) => term.trim()).filter(Boolean);
    const selected = SCENARIOS.filter((scenario) => wanted.some((term) => matchesScenario(scenario, term)));
    if (selected.length === 0) { throw new Error(`--only ${only} matched no scenario; --list shows them`); }
    return selected;
}

function matchesScenario(scenario, term) {
    if (scenario.id === term || scenario.metric_ids.includes(term)) { return true; }
    const exact_elsewhere = SCENARIOS.some((other) => other.id === term || other.metric_ids.includes(term));
    if (exact_elsewhere) { return false; }
    return scenario.id.includes(term) || scenario.metric_ids.some((id) => id.includes(term));
}

// a Playwright failure carries the whole browser launch log; the report needs the sentence, not the log
function briefError(error) {
    const message = error && error.message ? error.message : String(error);
    return message.split('\n').slice(0, 3).join(' ').slice(0, 400);
}

// run every selected scenario in order, keeping a thrown scenario as a result so the rest still run
async function runScenarios(scenarios, context) {
    const results = [];
    for (const scenario of scenarios) {
        const started = Date.now();
        console.log(`  running ${scenario.id} (${scenario.label})`);
        try {
            const { measurements, facts } = await scenario.run(context);
            results.push({ id: scenario.id, label: scenario.label, status: 'ran', wall_ms: Date.now() - started, facts, measurements });
        } catch (error) {
            const detail = briefError(error);
            console.log(`  ${scenario.id} FAILED: ${detail}`);
            results.push({ id: scenario.id, label: scenario.label, status: 'failed', wall_ms: Date.now() - started, error: detail, measurements: {} });
        }
        console.log(`  ${scenario.id} took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    return results;
}

// fold every scenario's measurements into one metric-keyed map, each carrying its budget and verdict
function collectMetrics(results) {
    const metrics = {};
    const breaches = [];
    for (const result of results) {
        for (const [metric_id, measurement] of Object.entries(result.measurements)) {
            const verdict = checkBudget(metric_id, measurement);
            metrics[metric_id] = { scenario: result.id, ...measurement, budget: verdict.budget || null, breached: verdict.breaches.length > 0 };
            breaches.push(...verdict.breaches);
        }
    }
    return { metrics, breaches };
}

// a probe count, or a dash where the bundle carried no probe to read; a dash is not a zero
function countCell(value) {
    return value === null || value === undefined ? '-' : String(value);
}

function printReport(report) {
    console.log('');
    console.log(`bundle: ${report.bundle.mode} (${report.bundle.react_build} React, ${report.bundle.minified ? 'minified' : 'unminified'}, ${(report.bundle.bytes / 1024 / 1024).toFixed(2)}MB)`);
    console.log('metric                       elapsed_ms   long_tasks   total_ms    max_ms   commits   convs   budget_ms   verdict');
    for (const [metric_id, metric] of Object.entries(report.metrics)) {
        if (metric.error) {
            console.log(`${metric_id.padEnd(28)} ERROR ${metric.error}`);
            continue;
        }
        const budget = metric.budget && metric.budget.elapsed_ms !== undefined ? String(metric.budget.elapsed_ms) : '-';
        const row = [
            metric_id.padEnd(28),
            String(metric.elapsed_ms).padStart(10),
            String(metric.long_task_count).padStart(13),
            String(metric.long_task_total_ms).padStart(10),
            String(metric.long_task_max_ms).padStart(9),
            countCell(metric.board_commits).padStart(9),
            countCell(metric.conversions).padStart(8),
            budget.padStart(11),
            (metric.breached ? '   BREACH' : '   ok'),
        ].join('');
        console.log(row);
    }
    console.log('');
    for (const breach of report.breaches) {
        console.log(`BREACH ${breach.metric_id}.${breach.field}: ${breach.detail || `${breach.measured} over the ${breach.limit} budget`}`);
    }
    if (report.breaches.length > 0 && !report.gates_on_breaches) {
        console.log(`the above are REPORTED, not gated: the budgets are production-bundle numbers and this is the ${report.bundle.mode} bundle.`);
        console.log('an unminified bundle pays more one-time V8 lazy compilation inside the first measurement window, which is a near-constant offset and so hits the smallest scenario hardest. run without --dev-bundle to gate.');
    }
    const unbudgeted = Object.keys(report.metrics).filter((id) => !report.metrics[id].budget);
    if (unbudgeted.length > 0) {
        console.log(`no budget set for: ${unbudgeted.join(', ')}`);
    }
    console.log(`wire: ${report.wire}`);
    console.log('elapsed_ms has a ~50ms settle floor, so assert long_task_max_ms below that; long tasks are counted from the first dispatch, not from first paint (field_notes in the report)');
}

/**
 * Record what this machine measured, so a later ratchet can say what it is ratcheting from.
 *
 * Metrics are merged over whatever the file already holds rather than replacing it, because a
 * `--only` run measures a few of them and must not silently delete the rest. A metric that errored
 * is left as it was: a failed run has nothing to say about it.
 *
 * This file is committed to a public repo, so it keeps only the facts that mean something to
 * someone who has just cloned it: the processor and memory a number came from, the commit, and
 * which bundle. The hostname and the absolute path of the bundle stay in test-results/perf.json,
 * which is local and gitignored, and so does board_commit_offsets_ms, which is a per-run diagnostic
 * running to hundreds of entries rather than anything a later run compares itself against.
 */
async function writeBaseline(report) {
    const existing = await readBaseline();
    const metrics = { ...existing.metrics };
    for (const [metric_id, metric] of Object.entries(report.metrics)) {
        if (metric.error) { continue; }
        metrics[metric_id] = {
            elapsed_ms: metric.elapsed_ms,
            long_task_count: metric.long_task_count,
            long_task_total_ms: metric.long_task_total_ms,
            long_task_max_ms: metric.long_task_max_ms,
            long_task_max_offset_ms: metric.long_task_max_offset_ms,
            board_commits: metric.board_commits,
            conversions: metric.conversions,
            merges: metric.merges,
            story_count: metric.story_count,
        };
    }
    const { hostname: _hostname, ...environment } = report.environment;
    const { path: _path, ...bundle } = report.bundle;
    const baseline = { captured_at: report.generated_at, wire: WIRE_MODEL, environment, bundle, metrics };
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 4)}\n`, 'utf-8');
    console.log(`baseline updated: ${BASELINE_PATH}`);
}

async function readBaseline() {
    try {
        return JSON.parse(await readFile(BASELINE_PATH, 'utf-8'));
    } catch {
        return { metrics: {} };
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.list) {
        for (const scenario of SCENARIOS) { console.log(`${scenario.id}  [${scenario.metric_ids.join(', ')}]  ${scenario.label}`); }
        return 0;
    }
    const scenarios = selectScenarios(options.only);
    console.log(`building the ${options.bundle_mode} webview bundle${options.skip_build ? ' (skipped, reusing the last one)' : ''}`);
    const bundle = await prepareBundle(REPO_ROOT, options.bundle_mode, { skip_build: options.skip_build });
    const server = await startHarnessServer(REPO_ROOT, bundle.bundle_path);
    const browser = await launchBrowser();
    let results;
    try {
        results = await runScenarios(scenarios, { browser, page_url: server.page_url });
    } finally {
        await browser.close();
        await server.close();
    }
    const { metrics, breaches } = collectMetrics(results);
    const scenarios_all_ran = results.every((result) => result.status === 'ran');
    const report = {
        generated_at: new Date().toISOString(),
        wire: WIRE_MODEL,
        field_notes: FIELD_NOTES,
        environment: describeEnvironment(),
        bundle: { mode: bundle.mode, path: bundle.bundle_path, bytes: bundle.bytes, minified: bundle.minified, react_build: bundle.react_build },
        scenarios_run: scenarios.map((scenario) => scenario.id),
        scenarios_skipped: SCENARIOS.filter((scenario) => !scenarios.includes(scenario)).map((scenario) => scenario.id),
        scenarios: results,
        metrics,
        breaches,
        gates_on_breaches: gatesOnBreaches(options.bundle_mode),
        ok: breaches.length === 0 && scenarios_all_ran,
    };
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(report, null, 4)}\n`, 'utf-8');
    printReport(report);
    console.log(`report: ${options.out}`);
    if (options.update_baseline) { await writeBaseline(report); }
    return exitCodeFor(report, scenarios_all_ran);
}

/*
 * Only the production bundle gates on a breach. The budgets are production-bundle numbers, and the
 * dev bundle carries a fixed cost the production one does not: it is unminified and several times
 * larger, so V8 lazily compiles more of the render path inside the first measurement window. That
 * shows up as a near-constant offset rather than one that scales with board size, which is why the
 * smallest scenario is the one it pushes over. Calibrating a second set of budgets for a mode that
 * gates nothing would be surface with no return, and minifying the dev bundle to close the gap
 * would trade away the source maps and watch speed that mode exists to provide.
 */
function gatesOnBreaches(bundle_mode) {
    return bundle_mode === 'production';
}

// a scenario that failed outright is a broken run in either mode; a breach gates only where the budgets apply
function exitCodeFor(report, scenarios_all_ran) {
    if (!scenarios_all_ran) { return 1; }
    return report.gates_on_breaches && report.breaches.length > 0 ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
});

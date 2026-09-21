/*
 * Per-metric performance budgets, asserted by scripts/perf/run.mjs.
 *
 * A budget is an upper bound: a measurement above it is a breach and the run exits non-zero. ANY
 * field a measurement reports can be budgeted, and only the fields present are checked. So
 * `{ elapsed_ms: 200 }` and `{ elapsed_ms: 200, long_task_max_ms: 50 }` are both valid, and
 * `long_task_max_ms` stands on its own where one blocking render is the thing a story cares about.
 *
 * WRITING A NEW CRITERION: below roughly 50ms, write it against `long_task_max_ms`, not
 * `elapsed_ms`. Every elapsed figure here carries a floor of about three animation frames from the
 * settle definition (page-agent.js header), so a sub-60ms elapsed target is mostly measuring the
 * instrument. The long task has no such floor. The same header records that the long-task window
 * opens at the first dispatch rather than at first paint, which makes it stricter than a criterion
 * phrased "after the first paint"; check that before reading a first-commit peak as a breach.
 *
 * TIMINGS AND COUNTS ARE BOUNDED DIFFERENTLY. A timing gets headroom because a machine under load
 * measures a fifth slower than an idle one. A count does not: `board_commits` and `conversions`
 * come from the webview's own probes, and on a given tree they are the same number on any machine,
 * so they are budgeted at exactly what the code does today. That makes them the sharpest thing
 * here - `folder-merge-50: conversions 1` is the whole incremental-merge guarantee in one line, and
 * `folder-load-200: conversions 200` says a 200-file load converts each doc once rather than
 * re-converting every doc on every message. A count budget that starts failing is a real behaviour
 * change, never noise, so investigate it before touching the number.
 *
 * WHERE THE TIMINGS COME FROM. Each is a measured baseline plus 20%, never a guess, taken from
 * the SLOWEST capture seen when the budget was last calibrated rather than the luckiest: a quiet
 * machine and a busy one differ by a fifth on a folder load, and a budget calibrated to a quiet run
 * fails on a busy one for no reason anybody can act on. baseline.json beside this file records the
 * most recent capture, with the processor and commit that produced it; `--update-baseline` rewrites
 * it from a run, so it tracks the tree while these bounds only move when someone moves them.
 *
 * THESE ARE PRODUCTION-BUNDLE NUMBERS, AND ONLY THE PRODUCTION RUN GATES ON THEM. `--dev-bundle`
 * reports its breaches and exits zero. The dev bundle is unminified and several times larger, so V8
 * lazily compiles more of the render path inside the first measurement window; measured against
 * production that is a near-constant offset (about +145ms at 20 files falling to +103ms at 200)
 * rather than a cost that scales with the board, which is why it pushes only the smallest scenario
 * over. Do not add a second set of dev budgets to close it: a calibrated number for a mode that
 * gates nothing is surface with no return. Do not minify the dev bundle either, which would trade
 * away the source maps and watch speed that mode exists to provide.
 *
 * EVERY FOLDER BUDGET WAS RE-BASELINED ON 2026-09-18 AGAINST THE BATCHED WIRE. The scenarios had
 * been posting one message per file after the extension started batching discovery, so the numbers
 * they produced described a delivery model the product no longer used; correcting that moved every
 * folder-load figure by an order of magnitude. baseline.json records which wire a capture came from
 * in its `wire` field, and a ratchet must not compare across two values of it.
 *
 * The kanban-perf-harness story carries an earlier baseline, measured 2026-07-07 with a prototype
 * rather than this runner. It is NOT comparable to the folder-load numbers here for the same
 * reason: it measured the pre-batching wire. folder-load-50-unbatched is the metric that continues
 * that series.
 *
 * RATCHETING THEM DOWN. Each optimisation story in the performance cycle lowers the budgets it
 * claims to improve, in the same commit as the optimisation, and records the new baseline. A
 * budget is never raised to make a run green: a number that has got worse is the finding.
 *
 * A COMMIT BUDGET IS THE WIRE, NOT THE MACHINE. The ceiling is one commit per posted message: the
 * webview folds messages that land in the same animation frame, so a busy machine commits FEWER
 * times, never more. Each folder-load budget is therefore the message count its delivery produces
 * (a 200-file discovery posts ten batch flushes plus the aggregate, so ten), not the smaller number
 * a lucky run measures. folder-load-200 sits at the 15 the coalescing story targets.
 *
 * THE INTERACTION TIMINGS ARE THE NOISY ONES. They are small numbers sitting a frame or two above
 * the settle floor, so a machine that is busy for one frame moves them by a quarter: across ten
 * captures on one tree, folder-click-50 ranged 144 to 192ms and folder-merge-50 105 to 161ms, with
 * the extremes landing in a run taken while webpack was still finishing. Their bounds are set from
 * the slowest of those, which is why they look loose next to the median. Their sharp assertion is
 * the count beside them - a click that starts converting docs, or a merge that converts more than
 * one, breaches on the first run whatever the machine was doing.
 *
 * Below about 50ms, budget `long_task_max_ms` rather than `elapsed_ms`. The settle definition puts
 * a floor of roughly three animation frames under every elapsed time, so an interaction that gets
 * genuinely fast stops moving that number while the blocking render it removed is still visible in
 * the long-task figures (page-agent.js header). single-file-edit-100k is already at that floor:
 * its budget is four frames rather than its measurement plus 20%, which would sit under the floor
 * and breach on one frame of jitter.
 */

export const BUDGETS = {
    'folder-load-20': { elapsed_ms: 485, board_commits: 2, conversions: 20 },
    'folder-load-50': { elapsed_ms: 1015, board_commits: 3, conversions: 50 },
    'folder-load-100': { elapsed_ms: 3070, board_commits: 6, conversions: 100 },
    'folder-load-200': { elapsed_ms: 13180, board_commits: 15, conversions: 200 },
    'folder-load-50-unbatched': { elapsed_ms: 8060, board_commits: 50, conversions: 50 },
    'folder-load-10x400k': { elapsed_ms: 13240, board_commits: 10, conversions: 10 },
    'folder-click-50': { elapsed_ms: 230, board_commits: 0, conversions: 0 },
    'folder-selection-50': { elapsed_ms: 151, board_commits: 0, conversions: 0 },
    'folder-merge-50': { elapsed_ms: 194, board_commits: 1, conversions: 1 },
    'folder-click-200': { elapsed_ms: 540, board_commits: 0, conversions: 0 },
    'folder-selection-200': { elapsed_ms: 570, board_commits: 0, conversions: 0 },
    'folder-merge-200': { elapsed_ms: 265, board_commits: 1, conversions: 1 },
    'single-file-load-100k': { elapsed_ms: 730, board_commits: 1, conversions: 0 },
    'single-file-edit-100k': { elapsed_ms: 68, board_commits: 1, conversions: 0 },
    'single-file-load-400k': { elapsed_ms: 1350, board_commits: 1, conversions: 0 },
    'single-file-edit-400k': { elapsed_ms: 161, board_commits: 1, conversions: 0 },
};

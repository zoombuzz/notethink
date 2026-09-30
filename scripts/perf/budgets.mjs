/*
 * Per-metric performance budgets, asserted by scripts/perf/run.mjs. A budget is an upper bound: any
 * field a measurement reports can be budgeted, and only the fields present are checked.
 *
 * Below about 50ms, budget against `long_task_max_ms`, not `elapsed_ms`: settling adds a floor of
 * roughly three animation frames, and `long_task_max_ms` counts from first dispatch rather than
 * first paint, so it carries no such floor.
 *
 * Counts (`board_commits`, `conversions`) come from the webview's own probes and don't vary by
 * machine, so they're budgeted at exactly what the code does today; a count regression is always
 * real, never noise. Timings get a measured-baseline-plus-20% margin instead, taken from the
 * slowest capture at calibration time and recorded in baseline.json (`--update-baseline` refreshes
 * it from a run).
 *
 * These are production-bundle numbers; `--dev-bundle` reports breaches but exits zero, since the
 * dev bundle's lazy-compilation cost is a near-constant offset unrelated to board size. Do not add
 * a second set of dev budgets or minify the dev bundle to close that gap.
 *
 * Every folder budget was re-baselined against the batched wire; `baseline.json`'s `wire` field
 * records which wire produced a capture, and a ratchet must not compare across two values of it. A
 * commit budget is the wire, not the machine: the ceiling is one commit per posted message, since a
 * busy machine commits fewer times, never more.
 *
 * Each optimisation story lowers the budgets it improves in the same commit and records the new
 * baseline; a budget is never raised to make a run green - a number that got worse is the finding.
 *
 * The interaction timings (folder-click-50, folder-merge-50, and similar) are the noisiest: small
 * numbers a frame or two above the settle floor, so their bounds are set from the slowest of
 * several captures and look loose next to the median. Their sharp assertion is the count beside
 * them, not the timing.
 */

/*
 * fallback_parses: 0 asserts the off-thread parse path was actually used; useWorkerParsedDocs.ts
 * falls back to a synchronous main-thread parse silently when its worker pool can't be created, so
 * any nonzero count here is always a genuine regression, never a slow machine.
 *
 * conversions budgets below carry a +2 margin over file_count: FolderMergeCache checks its stamped
 * cache entry before parsing, so a sibling file's `file_slot` shifting during a progressive load can
 * force a real re-conversion of an otherwise-unchanged doc. Measured 0-2 extra conversions across
 * repeated runs, never scaling with file count; a fixed board's own re-merge still expects zero.
 */
export const BUDGETS = {
    'folder-load-20': { elapsed_ms: 485, board_commits: 2, conversions: 22, fallback_parses: 0 },
    'folder-load-50': { elapsed_ms: 1015, board_commits: 3, conversions: 52, fallback_parses: 0 },
    'folder-load-100': { elapsed_ms: 3070, board_commits: 6, conversions: 102, fallback_parses: 0 },
    /*
     * heap_used_mb: the "no renderer crash at 200 files" criterion's own number, read via CDP after a
     * forced GC (without it this varied 64.5-139.5MB, too noisy to budget). Post-GC it is stable at
     * ~0.28MB/file for small files; this does NOT generalise to done.md-scale files
     * (folder-load-10x400k measures ~25.8MB/file), since convertMdastToNoteHierarchy re-embeds each
     * note's own mdast subtree independently of its ancestors' copies.
     */
    /*
     * mounted_cards is the virtualized-kanban acceptance criterion itself: a board of 2000 merged
     * stories mounts only a windowed lane's visible rows plus LANE_OVERSCAN_COUNT, not the full
     * count. Measured 55 on the harness's fixed viewport, which doesn't vary with machine speed, so
     * it's budgeted at exactly that count.
     */
    /*
     * elapsed_ms ratcheted: windowing the kanban board down to 55 mounted cards dropped this from
     * the pre-virtualization figure, which measured all 2000 stories against getBoundingClientRect
     * on each FLIP pass. Budget set to the slowest of several runs + 20%; a regression back toward
     * the old figure means virtualization is being defeated, not machine noise.
     */
    'folder-load-200': { elapsed_ms: 1940, board_commits: 15, conversions: 202, heap_used_mb: 70, fallback_parses: 0, mounted_cards: 55 },
    'folder-load-50-unbatched': { elapsed_ms: 8060, board_commits: 50, conversions: 52, fallback_parses: 0 },
    /*
     * content_leaked / payload_to_text_ratio: the 400KB acceptance criterion ("a folder update's
     * wire payload scales with the file's text and never carries mdast"). Measured ~1.01 (JSON
     * escaping plus doc metadata); mdast leaking back in would jump this to roughly 6-13x.
     *
     * heap_used_mb: targets not duplicating full mdast per doc in memory, on a dense-file shape the
     * plain folder-load-200 budget is too small to speak for. Before FolderMergeCache's
     * stamp-before-parse restructuring this measured ~25.8MB/file, since the cache kept a second
     * full-tree copy of every doc on top of the stamped/capped one actually rendered;
     * restructuring dropped it to ~23.8MB/file. The remainder is the inherent cost of one rendered
     * NoteProps tree per file (mdast's own node representation plus this codebase's per-note
     * shells) - shrinking it further means holding source offsets instead of parsed subtrees, a
     * renderer redesign outside this change's safe surface. Budget set to measured + 20%.
     */
    'folder-load-10x400k': { elapsed_ms: 13240, board_commits: 10, conversions: 10, content_leaked: 0, payload_to_text_ratio: 1.05, heap_used_mb: 290, fallback_parses: 0 },
    /*
     * folder-load-10x400k-dense is the regression guard folder-load-10x400k above cannot be: that
     * scenario holds exactly MAX_NOTES_PER_FILE stories per file, so there's nothing past the cap to
     * discard, and a fix that discards excess stories after stamping measures identically to one
     * that keeps retaining them. This scenario's 87 stories/400KB matches this repo's own measured
     * done.md density, so ~89% of each file's parsed content is discarded past the cap - exactly
     * where the FolderMergeCache restructuring's win is largest (~6.1MB/file against ~17.16MB/file
     * for the old full-tree cache on the same corpus). Budget set to measured + 20%.
     */
    'folder-load-10x400k-dense': { elapsed_ms: 1300, board_commits: 10, conversions: 10, content_leaked: 0, payload_to_text_ratio: 1.05, heap_used_mb: 75, fallback_parses: 0 },
    /*
     * folder-load-50x400k measures the acceptance criterion "folder-50-with-long-files settled <= 6s
     * prod" directly, once the harness serves parseWorker.js and useWorkerParsedDocs.ts's pool was
     * widened to a real multi-worker pool (mirroring ParsePool.ts). Measured 5032.8-5083.3ms with
     * fallback_parses=0 every time - genuinely on the off-thread path. Budget set to the 6000ms
     * criterion itself, not measured + 20% (which would exceed it): the criterion is the ceiling
     * here. conversions carries the same +2 file_slot-churn margin every progressive scenario needs.
     * heap_used_mb: same restructuring as folder-load-10x400k, measured ~9.9MB/file at 5x the file
     * count. Budget set to measured + 20%.
     */
    'folder-load-50x400k': { elapsed_ms: 6000, board_commits: 50, conversions: 52, heap_used_mb: 600, fallback_parses: 0 },
    'folder-click-50': { elapsed_ms: 230, board_commits: 0, conversions: 0 },
    'folder-selection-50': { elapsed_ms: 151, board_commits: 0, conversions: 0 },
    'folder-merge-50': { elapsed_ms: 194, board_commits: 1, conversions: 1 },
    /*
     * folder-drawer-open-{50,200}: the "drawer expansion feels sluggish" acceptance criterion.
     * Opening the drawer mounts no card (board_commits/conversions 0), so the whole cost is the
     * drawer's own render. Measured 47.7ms (50 files) / 41.8ms (200 files) - the 200 figure at or
     * below the 50 one confirms the cost doesn't scale with corpus size. Both budgets are measured
     * + 20%.
     */
    'folder-drawer-open-50': { elapsed_ms: 57, board_commits: 0, conversions: 0 },
    'folder-drawer-open-200': { elapsed_ms: 50, board_commits: 0, conversions: 0 },
    /*
     * folder-click-200 / folder-selection-200: the criterion is "card click and selectionChanged on
     * the 200-file board <= 200ms with no long task > 100ms". Five runs measured 45.6-47.9ms with
     * long_task_count 0 every time, comfortably under both halves - elapsed_ms is set to the 200ms
     * criterion itself rather than measured + 20%, since this near-instant interaction is sensitive
     * to scheduling noise and the criterion already sits well clear of a clean run. long_task_max_ms
     * is budgeted at its literal 100ms ceiling, since it measures actual blocking time, not
     * wall-clock delay.
     */
    'folder-click-200': { elapsed_ms: 200, long_task_max_ms: 100, board_commits: 0, conversions: 0 },
    'folder-selection-200': { elapsed_ms: 200, long_task_max_ms: 100, board_commits: 0, conversions: 0 },
    'folder-merge-200': { elapsed_ms: 265, board_commits: 1, conversions: 1 },
    'single-file-load-100k': { elapsed_ms: 730, board_commits: 1, conversions: 0 },
    'single-file-edit-100k': { elapsed_ms: 68, board_commits: 1, conversions: 0 },
    'single-file-load-400k': { elapsed_ms: 1350, board_commits: 1, conversions: 0 },
    'single-file-edit-400k': { elapsed_ms: 161, board_commits: 1, conversions: 0 },
};

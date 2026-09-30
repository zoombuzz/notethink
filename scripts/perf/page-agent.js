/**
 * Browser-side instrumentation for the perf runner (scripts/perf/run.mjs), installed via
 * page.addInitScript so the long-task observer is recording before the bundle evaluates.
 *
 * Everything a scenario measures happens inside this file: Playwright's structured argument walk
 * hangs for minutes on a large mdast graph, so payloads cross the boundary once, as a JSON
 * string, parsed here rather than passed as an object.
 */
(() => {
    // frames to wait after the card count is reached, so the measurement spans the commit that follows it
    const SETTLE_FRAMES = 2;

    // consecutive quiet frames (no new commit) before a windowed load counts as settled
    const QUIET_FRAMES = 6;

    // no progress for this long => stalled: long enough past one discovery flush + jitter, short enough to fail fast
    const STALL_MS = 5000;

    // round to one decimal so a JSON report stays readable without pretending to sub-microsecond accuracy
    function round(value) {
        return Math.round(value * 10) / 10;
    }

    /** the instrumentation itself: staged messages, observed long tasks, and the measured operations a scenario drives */
    class PerfAgent {
        constructor() {
            this.staged = [];
            this.long_tasks = [];
            this.observer_error = undefined;
            this.installLongTaskObserver();
        }

        /** record every long task the page produces; a browser without the entry type reports why instead of failing the run */
        installLongTaskObserver() {
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.long_tasks.push({ start: entry.startTime, duration: entry.duration });
                    }
                });
                observer.observe({ type: 'longtask', buffered: true });
            } catch (error) {
                this.observer_error = String(error);
            }
        }

        nextFrame() {
            return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
        }

        countCards() {
            return document.querySelectorAll('[data-flip-id]').length;
        }

        /** parse one JSON payload of wire messages and hold it for dispatchStaged; returns how many arrived */
        stage(json) {
            this.staged = JSON.parse(json);
            return this.staged.length;
        }

        // total board commits recorded (the mirror array only ever grows); 0 if the bundle carries no probe
        commitCount() {
            const commits = globalThis.__notethinkBoardCommits;
            return Array.isArray(commits) ? commits.length : 0;
        }

        // live probe object, returned by reference (not a snapshot); the module mutates it in place
        readMergeProbe() {
            return globalThis.__notethink_conversion_probe || null;
        }

        /**
         * Waits until the board has settled, then SETTLE_FRAMES more frames. Returns `{ reached,
         * stalled }`: `stalled` true means progress stopped for STALL_MS; both false means the
         * timeout ran out still progressing.
         *
         * `use_quiescence` (progressive loads only) picks the settle definition: with a merge probe
         * active (folder mode), settled requires `story_count >= expected_cards` AND QUIET_FRAMES of
         * quiescence SINCE that count was reached - an OR would let a gap between discovery batches
         * win early. With no merge probe (single-file mode), it's DOM count reaching
         * `expected_cards` OR (at least one card mounted AND quiescence). The mounted-card guard is
         * load-bearing: without it, quiescence alone reaches QUIET_FRAMES against the zero-card
         * "Loading..." shell and reports settled before the file has even parsed.
         */
        async settle(expected_cards, settle_timeout_ms, use_quiescence) {
            const deadline = performance.now() + settle_timeout_ms;
            const merge_probe = this.readMergeProbe();
            let reached = false;
            let stalled = false;
            let quiet_streak = 0;
            let last_commit_count = this.commitCount();
            let last_progress_metric = use_quiescence ? last_commit_count : this.countCards();
            let last_progress_at = performance.now();
            while (!reached && !stalled && performance.now() < deadline) {
                await this.nextFrame();
                if (!use_quiescence) {
                    const cards = this.countCards();
                    if (cards !== last_progress_metric) { last_progress_metric = cards; last_progress_at = performance.now(); }
                    else if (performance.now() - last_progress_at > STALL_MS) { stalled = true; break; }
                    reached = cards >= expected_cards;
                    continue;
                }
                const commit_count = this.commitCount();
                if (commit_count > 0 && commit_count === last_commit_count) { quiet_streak += 1; }
                else { quiet_streak = 0; last_commit_count = commit_count; }
                const using_story_probe = merge_probe && merge_probe.merges > 0;
                const progress_metric = using_story_probe ? merge_probe.story_count : commit_count;
                if (progress_metric !== last_progress_metric) { last_progress_metric = progress_metric; last_progress_at = performance.now(); }
                else if (performance.now() - last_progress_at > STALL_MS) { stalled = true; break; }
                if (using_story_probe) {
                    if (merge_probe.story_count >= expected_cards && quiet_streak >= QUIET_FRAMES) { reached = true; }
                } else {
                    const cards = this.countCards();
                    if (cards >= expected_cards || (cards > 0 && quiet_streak >= QUIET_FRAMES)) { reached = true; }
                }
            }
            for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) {
                await this.nextFrame();
            }
            return { reached, stalled };
        }

        /**
         * The board-level state commits that landed inside a measured window, from the webview's own
         * probe (client/webview/src/lib/boardCommitProbe.ts), which the harness enables before the
         * bundle evaluates. Returns how many, and where each one fell relative to the start of the
         * measurement so a long task can be attributed to the commit that caused it. A null count
         * means the bundle carries no probe, which is a different fact from zero commits and must
         * not read as one.
         *
         * The window is selected by each entry's own `at`, so a scenario that measures several
         * things on one board attributes each commit to the step it happened in without clearing
         * the array between them. Clearing would lose exactly that.
         */
        countBoardCommits(started, finished) {
            const commits = globalThis.__notethinkBoardCommits;
            if (!Array.isArray(commits)) { return { board_commits: null, board_commit_offsets_ms: null }; }
            const inside = commits.filter((commit) => commit.at >= started && commit.at < finished);
            return {
                board_commits: inside.length,
                board_commit_offsets_ms: inside.map((commit) => round(commit.at - started)),
            };
        }

        /**
         * A reading of the merge probe (notethink-views' mergeAggregateRoot), which counts the
         * per-doc conversions and the merges a board actually performed. The module mutates one
         * object in place and exposes no reset on the global, so a measurement takes a before and
         * after reading and reports the difference. null when the bundle carries no probe.
         */
        readConversionProbe() {
            const probe = globalThis.__notethink_conversion_probe;
            if (!probe) { return null; }
            return { conversions: probe.conversions, merges: probe.merges };
        }

        // the work a measured window caused, as a delta between two probe readings
        conversionDelta(before, after) {
            if (!before || !after) { return { conversions: null, merges: null }; }
            return { conversions: after.conversions - before.conversions, merges: after.merges - before.merges };
        }

        /**
         * A reading of the parse-mode probe: whether a folder doc's parse went to a worker or fell
         * back to the main thread. Before/after delta, like readConversionProbe, since the module
         * mutates one object in place. null when the bundle carries no probe.
         */
        readParseModeProbe() {
            const probe = globalThis.__notethink_parse_mode_probe;
            if (!probe) { return null; }
            return { worker_parses: probe.worker_parses, fallback_parses: probe.fallback_parses };
        }

        // the parses a measured window caused, as a delta between two probe readings
        parseModeDelta(before, after) {
            if (!before || !after) { return { worker_parses: null, fallback_parses: null }; }
            return { worker_parses: after.worker_parses - before.worker_parses, fallback_parses: after.fallback_parses - before.fallback_parses };
        }

        /**
         * The long tasks that started inside a measured window, summarised.
         *
         * long_task_max_offset_ms is where the longest one began, relative to the start of the
         * measurement, so it can be read against board_commit_offsets_ms. A long task landing just
         * after a commit is the work that commit caused; one landing nowhere near a commit is
         * something else, and that difference is what decides whose code owns it.
         *
         * THE WINDOW OPENS AT THE FIRST DISPATCH, NOT AT FIRST PAINT. The task that produces the
         * first paint is therefore counted, which makes this measure stricter than a criterion
         * written as "no long task after the first paint": on a small folder the peak IS the first
         * commit's mount, and it is reported. Read a peak whose offset sits at the first commit as
         * a first-paint cost before reading it as a violation of an after-first-paint rule. The
         * choice is deliberate - the initial mount is real work a user waits through - but it means
         * the number and such a criterion are not the same quantity.
         */
        summariseLongTasks(started, finished) {
            const inside = this.long_tasks.filter((task) => task.start >= started && task.start < finished);
            let total = 0;
            let longest = { duration: 0, start: started };
            for (const task of inside) {
                total += task.duration;
                if (task.duration > longest.duration) { longest = task; }
            }
            return {
                long_task_count: inside.length,
                long_task_total_ms: round(total),
                long_task_max_ms: round(longest.duration),
                long_task_max_offset_ms: round(longest.start - started),
            };
        }

        /**
         * Times `action` plus the settle that follows it, and describes the board afterward.
         * `expected_cards` undefined means "whatever is on screen once `action` returns"
         * (dispatchMessage, clickCard); a caller naming a bigger target (dispatchStaged) passes it
         * explicitly plus `use_quiescence`, since a windowed board may never DOM-count its way there.
         */
        async measure(action, { expected_cards, settle_timeout_ms, use_quiescence = false }) {
            const conversions_before = this.readConversionProbe();
            const parse_mode_before = this.readParseModeProbe();
            const started = performance.now();
            await action();
            const target_cards = expected_cards === undefined ? this.countCards() : expected_cards;
            const { reached, stalled } = await this.settle(target_cards, settle_timeout_ms, use_quiescence);
            const finished = performance.now();
            const mounted_cards = this.countCards();
            const merge_probe = this.readMergeProbe();
            return {
                elapsed_ms: round(finished - started),
                settled: reached,
                // true when settle() gave up on STALL_MS lack of progress, rather than running the full timeout
                stalled,
                cards: mounted_cards,
                // same as `cards` but named for virtualization: mounted DOM nodes, not the story count
                mounted_cards,
                // merged tree's story count - null with no probe (single-file mode); what settle() waits on for a folder load
                story_count: merge_probe ? merge_probe.story_count : null,
                ...this.countBoardCommits(started, finished),
                ...this.conversionDelta(conversions_before, this.readConversionProbe()),
                ...this.parseModeDelta(parse_mode_before, this.readParseModeProbe()),
                ...this.summariseLongTasks(started, finished),
                observer_error: this.observer_error,
            };
        }

        /**
         * Dispatch every staged message, yielding a frame between them. The extension posts one
         * message per discovered file and the renderer paints between them, so a frame per message
         * is what a real progressive load does; dispatching them in one task would let React batch
         * the whole load into a single render and measure something the product never does.
         *
         * That is a model of what PanelSession does today, and it is the half of the picture a
         * webview-side coalescing change cannot move: one message per frame is already one commit
         * per frame, so the queue has nothing to fold. The story that batches discovery posts on the
         * extension side has to change this dispatch to match, or the harness will keep measuring
         * the old traffic pattern and report no improvement where there is one.
         */
        async dispatchStaged(options) {
            const messages = this.staged;
            return this.measure(async () => {
                for (const message of messages) {
                    window.dispatchEvent(new MessageEvent('message', { data: message }));
                    await this.nextFrame();
                }
            }, { ...options, use_quiescence: true });
        }

        /**
         * Dispatches a single JSON-encoded message and measures the board's response.
         * `expected_cards` is dropped: the only messages sent this way (selectionChanged, a one-file
         * merge, an edit re-send) add no new story, so the target is whatever is already on screen.
         */
        async dispatchMessage(json, options) {
            const message = JSON.parse(json);
            return this.measure(async () => {
                window.dispatchEvent(new MessageEvent('message', { data: message }));
            }, { ...options, expected_cards: undefined });
        }

        /**
         * Clicks the headline of the card at `index` in DOM order. `index` addresses the currently
         * MOUNTED cards, same as `[data-flip-id]`; a windowed board narrows what's reachable, but a
         * scenario always clicks index 0 on an already-settled board. `expected_cards` is dropped,
         * as in dispatchMessage: a click adds no card.
         */
        async clickCard(index, options) {
            const cards = document.querySelectorAll('[data-flip-id]');
            const card = cards[index];
            if (!card) {
                throw new Error(`no card at index ${index}, the board holds ${cards.length}`);
            }
            const target = card.querySelector('[role="rowheader"]') || card;
            return this.measure(async () => { target.click(); }, { ...options, expected_cards: undefined });
        }

        /**
         * Clicks an element by its `data-testid` and measures the board's response - the route a
         * drawer-open measurement drives. Same "nothing new mounts" target as clickCard/dispatchMessage.
         */
        async clickTestId(testid, options) {
            const target = document.querySelector(`[data-testid="${testid}"]`);
            if (!target) {
                throw new Error(`no element with data-testid="${testid}"`);
            }
            return this.measure(async () => { target.click(); }, { ...options, expected_cards: undefined });
        }
    }

    // the one global the runner addresses, constructed here so the observer is recording before the bundle evaluates
    window.__perf = new PerfAgent();
})();

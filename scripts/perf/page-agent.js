/**
 * Browser-side instrumentation for the perf runner (scripts/perf/run.mjs).
 *
 * Installed with page.addInitScript, so the long-task observer is recording before the webview
 * bundle evaluates and a scenario can attribute load-time long tasks as well as interaction ones.
 * The observer is buffered, so entries dispatched before it was constructed still arrive.
 *
 * Everything a scenario measures happens inside this file, for one reason: Playwright's structured
 * argument walk hangs for minutes on a large mdast graph, so payloads cross the boundary once, as a
 * JSON string, and are parsed here. The node side then only ever passes small option objects.
 *
 * Settle is the story's definition: wait for the `[data-flip-id]` card count to reach the expected
 * number, then two more animation frames. An interaction passes its current card count as the
 * expected one, so the first frame after the action is the one the blocking render delays, and the
 * elapsed time is that render.
 *
 * That definition puts a floor of roughly three animation frames, about 50ms, under every
 * elapsed_ms, settle frames included. It is the right measure for a load and for an interaction at
 * today's scale, and the wrong one below that floor: an optimisation that takes a click under 50ms
 * has to be asserted on long_task_max_ms, which no frame boundary quantises.
 *
 * A measurement also carries three counts read from the webview's own probes: board_commits, the
 * board-level state commits a window produced; and conversions and merges, the per-doc parses and
 * whole-tree merges it caused. These are what a batching, coalescing or caching change moves
 * directly, and unlike elapsed time none of them depends on how fast the machine is, so they are
 * the honest thing to assert when a timing is within noise of its budget.
 */
(() => {
    // frames to wait after the card count is reached, so the measurement spans the commit that follows it
    const SETTLE_FRAMES = 2;

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

        /**
         * Wait until the board holds `expected_cards` cards, then SETTLE_FRAMES further frames.
         * Returns whether the count was reached, so a scenario that timed out is reported as
         * unsettled rather than silently contributing a meaningless elapsed time.
         */
        async settle(expected_cards, settle_timeout_ms) {
            const deadline = performance.now() + settle_timeout_ms;
            let reached = false;
            while (!reached && performance.now() < deadline) {
                await this.nextFrame();
                reached = this.countCards() >= expected_cards;
            }
            for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) {
                await this.nextFrame();
            }
            return reached;
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

        /** time `action` plus the settle that follows it, and describe what the board looked like afterwards */
        async measure(action, { expected_cards, settle_timeout_ms }) {
            const conversions_before = this.readConversionProbe();
            const started = performance.now();
            await action();
            const settled = await this.settle(expected_cards, settle_timeout_ms);
            const finished = performance.now();
            return {
                elapsed_ms: round(finished - started),
                settled,
                cards: this.countCards(),
                ...this.countBoardCommits(started, finished),
                ...this.conversionDelta(conversions_before, this.readConversionProbe()),
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
            }, options);
        }

        /** dispatch a single JSON-encoded message and measure the board's response to it */
        async dispatchMessage(json, options) {
            const message = JSON.parse(json);
            return this.measure(async () => {
                window.dispatchEvent(new MessageEvent('message', { data: message }));
            }, options);
        }

        /** click the headline of the card at `index` in DOM order, the route folder-click-focus drives */
        async clickCard(index, options) {
            const cards = document.querySelectorAll('[data-flip-id]');
            const card = cards[index];
            if (!card) {
                throw new Error(`no card at index ${index}, the board holds ${cards.length}`);
            }
            const target = card.querySelector('[role="rowheader"]') || card;
            return this.measure(async () => { target.click(); }, options);
        }
    }

    // the one global the runner addresses, constructed here so the observer is recording before the bundle evaluates
    window.__perf = new PerfAgent();
})();

/**
 * DiscoveryLogDetails describes one folder-discovery run, for the info-level timing log.
 * - method: findFiles on a scheme with a search provider, or the readDirectory walk otherwise
 * - dirs_walked: set only by the walk, which is the only path that visits directories one at a time
 */
export interface DiscoveryLogDetails {
    method: 'findFiles' | 'walk';
    scheme: string;
    discovered_count: number;
    dirs_walked?: number;
    elapsed_ms: number;
}

/**
 * Decides whether folder discovery searches via vscode.workspace.findFiles or walks the tree with
 * readDirectory. `file:` and `vscode-remote:` (Remote-SSH) both register a search provider that
 * honours a RelativePattern; every other scheme falls back to the walk, including `vscode-vfs:`
 * (a static content provider with no search provider of its own) and any scheme not met yet. The
 * caller still falls back to the walk if a findFiles call actually throws, since this is an
 * inference about the scheme, not a guarantee.
 */
export function resolveDiscoveryMethod(scheme: string): 'findFiles' | 'walk' {
    return scheme === 'file' || scheme === 'vscode-remote' ? 'findFiles' : 'walk';
}

// never includes a path: the folder path is already logged elsewhere, at the cap-hit and walk-cap-hit lines
export function formatDiscoveryLogLine(details: DiscoveryLogDetails): string {
    const dirs_part = details.dirs_walked === undefined ? '' : `, walked ${details.dirs_walked} directories`;
    return `discovery via ${details.method} (scheme ${details.scheme}): found ${details.discovered_count} docs in ${details.elapsed_ms}ms${dirs_part}`;
}

// floor between progress ticks during folder discovery, so a 4800-directory walk posts tens of messages, not thousands
const DISCOVERY_PROGRESS_THROTTLE_MS = 250;

/**
 * Throttles a progress callback to at most once per DISCOVERY_PROGRESS_THROTTLE_MS: `tick` drops a call
 * landing inside the window since the last one went out, `final` always sends regardless of timing, so
 * the walk's or load's last tick is never silently dropped. `now` is injectable for a deterministic test.
 */
export function createThrottledProgressSender<T>(
    send: (value: T) => void,
    now: () => number = Date.now,
): { tick: (value: T) => void; final: (value: T) => void } {
    let last_sent_at: number | undefined;
    return {
        tick: (value: T): void => {
            const current = now();
            if (last_sent_at !== undefined && current - last_sent_at < DISCOVERY_PROGRESS_THROTTLE_MS) { return; }
            last_sent_at = current;
            send(value);
        },
        final: (value: T): void => { send(value); },
    };
}

/**
 * Options for drainWorklist.
 * - concurrency: max items processed at once
 * - max_items: hard cap on items started, regardless of how many remain queued
 * - isStopped: checked before every new item starts, never mid-flight; once true, no further item
 *   starts and no further onItemProcessed call fires, even for one already in flight
 * - onItemProcessed: fires once per item that finishes while the drain is still live
 */
export interface DrainWorklistOptions {
    concurrency: number;
    max_items: number;
    isStopped?: () => boolean;
    onItemProcessed?: (processed_count: number) => void;
}

/**
 * Result of drainWorklist.
 * - processed_count: items that finished processing (started and settled)
 * - capped: whether max_items was reached before the worklist drained
 * - stopped: whether isStopped reported true before the worklist drained
 */
export interface DrainWorklistResult {
    processed_count: number;
    capped: boolean;
    stopped: boolean;
}

/**
 * Drains a worklist that can grow while it drains, such as a directory tree walk where visiting
 * one directory discovers its children. Up to `concurrency` items are processed at once; `process`
 * returns the items a finished one adds back to the list, so a later generation is picked up by
 * whichever worker next has room, rather than only the workers that started it. Processing order
 * across items is not guaranteed, so neither `process` nor the caller may depend on it; only the
 * final counts are deterministic. `process` must never reject: a worklist item that fails its own
 * operation reports that failure itself and resolves with no children, so one bad item cannot
 * strand the pool.
 *
 * Stops taking new items, without aborting ones already in flight, the moment `max_items` have
 * started or `isStopped` reports true. An item already running still finishes, but its children are
 * then discarded rather than queued, so a superseded drain winds down instead of growing forever.
 */
export async function drainWorklist<T>(
    initial_items: Array<T>,
    process: (item: T) => Promise<Array<T>>,
    options: DrainWorklistOptions,
): Promise<DrainWorklistResult> {
    const stack: Array<T> = [...initial_items];
    let started = 0;
    let processed_count = 0;
    let active = 0;
    let capped = false;
    let stopped = false;
    return new Promise<DrainWorklistResult>(resolve => {
        const finishIfIdle = (): void => {
            if (active === 0) { resolve({ processed_count, capped, stopped }); }
        };
        const pump = (): void => {
            while (!stopped && !capped && active < options.concurrency && stack.length > 0) {
                if (options.isStopped?.()) { stopped = true; break; }
                if (started >= options.max_items) { capped = true; break; }
                const item = stack.pop() as T;
                started++;
                active++;
                process(item).then(children => {
                    processed_count++;
                    active--;
                    // re-checked here, not only in the loop above: isStopped may have flipped while this item was in flight
                    stopped = stopped || options.isStopped?.() === true;
                    if (!stopped) { options.onItemProcessed?.(processed_count); }
                    if (!stopped && !capped) { stack.push(...children); }
                    pump();
                    finishIfIdle();
                });
            }
            finishIfIdle();
        };
        pump();
    });
}

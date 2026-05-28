import Debug from "debug";
import { useCallback, useEffect, useRef, useState } from "react";

const debug = Debug("nodejs:notethink-views:usePendingWork");

// delay-then-show policy: the spinner only becomes visible after `pending` has been continuously true for ≥150 ms; once shown, it stays visible for ≥250 ms. The 10 s safety net auto-clears any individual mark whose matching clear never arrives (dropped echo, unfinished extension work)
export const PENDING_WORK_SHOW_DELAY_MS = 150;
export const PENDING_WORK_MIN_VISIBLE_MS = 250;
export const PENDING_WORK_SAFETY_NET_MS = 10000;

export interface UsePendingWorkApi {
    pending: boolean;
    markPending: (key: string) => void;
    clearPending: (key: string) => void;
    clearAll: () => void;
}

interface PendingWorkOptions {
    showDelayMs?: number;
    minVisibleMs?: number;
    safetyNetMs?: number;
}

/**
 * Pending-work coordinator with a delay-then-show + min-visibility + safety-net policy.
 *
 * The hook tracks a set of outstanding work keys. The boolean `pending` flips on after
 * the underlying set has been continuously non-empty for ≥ showDelayMs (default 150 ms),
 * and remains true for at least minVisibleMs (default 250 ms) once shown. Fast operations
 * that finish under showDelayMs never flash the spinner; slow operations show it for the
 * duration. Each key is auto-cleared after safetyNetMs (default 10 s) so a dropped echo
 * from the extension cannot hang the spinner indefinitely.
 *
 * `clearAll()` is exposed so tests can release every key (including the safety-net timer)
 * synchronously during teardown, without waiting for the 10 s timeout.
 *
 * Returns snake_case `pending` (a hook return value) alongside camelCase `markPending` /
 * `clearPending` / `clearAll` (function names) per CODING_STANDARDS.md hook conventions.
 */
// eslint-disable-next-line max-lines-per-function -- the hook coordinates four interrelated timers (show-delay, hide-delay with min-visibility, per-key safety nets) over a shared mutable state; splitting into sub-hooks would expose those refs across module boundaries without making the policy easier to read
export function usePendingWork(options: PendingWorkOptions = {}): UsePendingWorkApi {
    const show_delay_ms = options.showDelayMs ?? PENDING_WORK_SHOW_DELAY_MS;
    const min_visible_ms = options.minVisibleMs ?? PENDING_WORK_MIN_VISIBLE_MS;
    const safety_net_ms = options.safetyNetMs ?? PENDING_WORK_SAFETY_NET_MS;

    const [pending, setPending] = useState<boolean>(false);

    // active keys + per-key safety-net timers
    const active_keys_ref = useRef<Set<string>>(new Set());
    const safety_timers_ref = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // show-delay timer (set when the active-set goes 0 -> 1; cleared if the set empties before it fires)
    const show_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // when did pending most-recently flip true (ms epoch); undefined while pending=false
    const shown_at_ref = useRef<number | undefined>(undefined);
    // hide-delay timer (set when the active-set drains while pending=true and we still owe min-visibility)
    const hide_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // schedule pending=true after show_delay_ms if the active set is still non-empty at that point
    const scheduleShow = useCallback((): void => {
        if (show_timer_ref.current !== undefined) { return; }
        if (hide_timer_ref.current !== undefined) {
            // a pending hide is overridden by fresh work — keep pending=true, drop the hide
            clearTimeout(hide_timer_ref.current);
            hide_timer_ref.current = undefined;
        }
        show_timer_ref.current = setTimeout(() => {
            show_timer_ref.current = undefined;
            if (active_keys_ref.current.size === 0) { return; }
            shown_at_ref.current = Date.now();
            setPending(true);
        }, show_delay_ms);
    }, [show_delay_ms]);

    // schedule pending=false honouring the min-visibility window if the spinner is already shown
    const scheduleHide = useCallback((): void => {
        if (show_timer_ref.current !== undefined) {
            // pending was never reached; cancel the scheduled show and stay hidden
            clearTimeout(show_timer_ref.current);
            show_timer_ref.current = undefined;
            return;
        }
        if (shown_at_ref.current === undefined) {
            // pending wasn't shown — nothing to hide
            setPending(false);
            return;
        }
        const elapsed = Date.now() - shown_at_ref.current;
        const remaining = Math.max(0, min_visible_ms - elapsed);
        if (remaining === 0) {
            shown_at_ref.current = undefined;
            setPending(false);
            return;
        }
        if (hide_timer_ref.current !== undefined) { return; }
        hide_timer_ref.current = setTimeout(() => {
            hide_timer_ref.current = undefined;
            if (active_keys_ref.current.size > 0) {
                // late mark arrived while we were waiting to hide — leave pending=true
                return;
            }
            shown_at_ref.current = undefined;
            setPending(false);
        }, remaining);
    }, [min_visible_ms]);

    const markPending = useCallback((key: string): void => {
        const was_empty = active_keys_ref.current.size === 0;
        if (active_keys_ref.current.has(key)) {
            // re-mark of same key: refresh the safety-net timer but don't disturb the show/hide state
            const existing = safety_timers_ref.current.get(key);
            if (existing) { clearTimeout(existing); }
        } else {
            active_keys_ref.current.add(key);
        }
        debug('markPending %s (size=%d)', key, active_keys_ref.current.size);
        const safety_timer = setTimeout(() => {
            debug('safety-net auto-clearing key %s after %d ms', key, safety_net_ms);
            safety_timers_ref.current.delete(key);
            // call the same path clearPending takes; inline to avoid the safety timer holding a stale closure on clearPending
            if (!active_keys_ref.current.has(key)) { return; }
            active_keys_ref.current.delete(key);
            if (active_keys_ref.current.size === 0) {
                scheduleHide();
            }
        }, safety_net_ms);
        safety_timers_ref.current.set(key, safety_timer);
        if (was_empty) {
            scheduleShow();
        }
    }, [safety_net_ms, scheduleShow, scheduleHide]);

    const clearPending = useCallback((key: string): void => {
        if (!active_keys_ref.current.has(key)) { return; }
        active_keys_ref.current.delete(key);
        const safety_timer = safety_timers_ref.current.get(key);
        if (safety_timer) {
            clearTimeout(safety_timer);
            safety_timers_ref.current.delete(key);
        }
        debug('clearPending %s (size=%d)', key, active_keys_ref.current.size);
        if (active_keys_ref.current.size === 0) {
            scheduleHide();
        }
    }, [scheduleHide]);

    const clearAll = useCallback((): void => {
        debug('clearAll (clearing %d keys)', active_keys_ref.current.size);
        active_keys_ref.current.clear();
        for (const timer of safety_timers_ref.current.values()) { clearTimeout(timer); }
        safety_timers_ref.current.clear();
        if (show_timer_ref.current !== undefined) {
            clearTimeout(show_timer_ref.current);
            show_timer_ref.current = undefined;
        }
        if (hide_timer_ref.current !== undefined) {
            clearTimeout(hide_timer_ref.current);
            hide_timer_ref.current = undefined;
        }
        shown_at_ref.current = undefined;
        setPending(false);
    }, []);

    // unmount cleanup so a tearing-down hook can't fire a timer into a dead component
    useEffect(() => () => {
        for (const timer of safety_timers_ref.current.values()) { clearTimeout(timer); }
        safety_timers_ref.current.clear();
        if (show_timer_ref.current !== undefined) { clearTimeout(show_timer_ref.current); }
        if (hide_timer_ref.current !== undefined) { clearTimeout(hide_timer_ref.current); }
    }, []);

    return { pending, markPending, clearPending, clearAll };
}

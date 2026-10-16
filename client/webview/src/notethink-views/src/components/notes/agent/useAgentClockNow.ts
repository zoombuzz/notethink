import { useEffect, useState } from "react";

// a since-start clock only needs to redraw once a minute to stay honest, not on every render
const AGENT_CLOCK_TICK_MS = 60 * 1000;

/**
 * The current time in ms, ticking once a minute while `active`. A session row only needs this at
 * all for the since-start clock mode; every other mode reads `started_at`/`updated_at`/`active_ms`
 * off the session itself and never calls this with `active` true, so the row pays nothing beyond
 * one state read. The interval is cleared on unmount and whenever `active` turns false, so a card
 * that scrolls out of the kanban board's render window (or switches away from since-start) stops
 * ticking rather than running in the background.
 */
export function useAgentClockNow(active: boolean): number {
    const [now_ms, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        if (!active) { return; }
        const interval = setInterval(() => setNowMs(Date.now()), AGENT_CLOCK_TICK_MS);
        return () => clearInterval(interval);
    }, [active]);
    return now_ms;
}

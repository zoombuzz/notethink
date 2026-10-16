/**
 * The gap-sum a vendor reader builds `active_ms` from: one shared pure function, so Claude Code,
 * Codex and Grok agree on what "active" means rather than each reader carrying its own copy of the
 * same loop. A reader calls this with every timestamp its own transcript carries (several files'
 * worth, for Claude Code's main transcript plus its subagents'); everything else - which field holds
 * the timestamp, how a tool call or a usage record is found - stays reader-specific.
 */

// a gap this long or shorter between two events counts as active; a longer gap is left out entirely
export const AGENT_ACTIVE_IDLE_GAP_MS = 5 * 60 * 1000;

/**
 * The sum of the gaps between consecutive events, in time order, leaving out any gap over
 * `idle_gap_ms` entirely rather than capping it: a single long-running tool call with nothing
 * recorded in between reads as idle for that stretch, the same as a chat left open overnight. An
 * undefined or unparseable timestamp is dropped before gaps are computed, and the surviving ones are
 * sorted first, since a reader's own timestamps do not always arrive in write order (a subagent
 * transcript read as a second file). Zero or one surviving timestamp has no gap to sum, so this
 * answers zero.
 */
export function activeMsFromTimestamps(timestamps: ReadonlyArray<string | undefined>, idle_gap_ms: number = AGENT_ACTIVE_IDLE_GAP_MS): number {
    const sorted_ms = timestamps
        .filter((timestamp): timestamp is string => timestamp !== undefined)
        .map((timestamp) => Date.parse(timestamp))
        .filter((ms) => !Number.isNaN(ms))
        .sort((a, b) => a - b);
    let active_ms = 0;
    for (let i = 1; i < sorted_ms.length; i++) {
        const gap = sorted_ms[i] - sorted_ms[i - 1];
        if (gap <= idle_gap_ms) { active_ms += gap; }
    }
    return active_ms;
}

import { AGENT_ACTIVE_IDLE_GAP_MS, activeMsFromTimestamps } from './agentclockops';

const BASE = Date.parse('2026-09-18T08:00:00Z');
const iso = (offset_ms: number): string => new Date(BASE + offset_ms).toISOString();

describe('activeMsFromTimestamps', () => {
    it('answers zero for no timestamps', () => {
        expect(activeMsFromTimestamps([])).toBe(0);
    });

    it('answers zero for a single timestamp, which has no gap to sum', () => {
        expect(activeMsFromTimestamps([iso(0)])).toBe(0);
    });

    it('sums a gap exactly at the threshold', () => {
        const timestamps = [iso(0), iso(AGENT_ACTIVE_IDLE_GAP_MS)];
        expect(activeMsFromTimestamps(timestamps)).toBe(AGENT_ACTIVE_IDLE_GAP_MS);
    });

    it('excludes a gap one millisecond over the threshold entirely', () => {
        const timestamps = [iso(0), iso(AGENT_ACTIVE_IDLE_GAP_MS + 1)];
        expect(activeMsFromTimestamps(timestamps)).toBe(0);
    });

    it('sums several in-threshold gaps and drops an over-threshold one in between', () => {
        const one_minute = 60 * 1000;
        const timestamps = [iso(0), iso(one_minute), iso(one_minute * 2), iso(one_minute * 2 + AGENT_ACTIVE_IDLE_GAP_MS + one_minute), iso(one_minute * 3 + AGENT_ACTIVE_IDLE_GAP_MS + one_minute)];
        // two 1-minute gaps count, the long middle gap is dropped, the trailing 1-minute gap counts
        expect(activeMsFromTimestamps(timestamps)).toBe(one_minute * 3);
    });

    it('sorts out-of-order timestamps before computing gaps, since a reader can hand them in across more than one file', () => {
        const timestamps = [iso(60_000), iso(0)];
        expect(activeMsFromTimestamps(timestamps)).toBe(60_000);
    });

    it('drops undefined and unparseable timestamps before computing gaps', () => {
        const timestamps = [iso(0), undefined, 'not-a-date', iso(60_000)];
        expect(activeMsFromTimestamps(timestamps)).toBe(60_000);
    });

    it('honours a caller-supplied threshold instead of the default', () => {
        const timestamps = [iso(0), iso(60_000)];
        expect(activeMsFromTimestamps(timestamps, 30_000)).toBe(0);
    });
});

import type { AgentApiCall } from './vendors/agentvendorops';
import { addActivityUsage, emptyActivityUsage, type ActivityUsage } from '../types/AgentActivity';

/**
 * One model id's price, shipped as data because this extension has no outbound network access in
 * production: a runtime fetch of a vendor's pricing page is not an option, so the table is read once
 * by a human and committed. `source` and `read_at` make that reading auditable, so a stale row is a
 * fact a later session can check rather than a guess baked silently into a dollar figure.
 * - model_id: matched exactly against `AgentApiCall.model_id`; never fuzzy or prefix matched, because
 *   a neighbour's rate applied to an unrecognised id would be a wrong number presented as a real one
 * - input_per_million_usd, output_per_million_usd, cache_read_per_million_usd,
 *   cache_write_per_million_usd: the off-peak (or only) rate
 * - source: the pricing page this row was read from
 * - read_at: the ISO date (YYYY-MM-DD) the figures were read, so staleness is auditable
 * - peak: present only for a vendor that publishes a time-windowed rate (DeepSeek); a call whose
 *   measured span touches one of `hours` on one of `days` is priced from this block instead
 * - peak.days: 0-6, matching Date.getUTCDay() (0 = Sunday)
 * - peak.hours: half-open [start_hour_utc, end_hour_utc) ranges
 */
export interface AgentPriceRow {
    model_id: string;
    input_per_million_usd: number;
    output_per_million_usd: number;
    cache_read_per_million_usd: number;
    cache_write_per_million_usd: number;
    source: string;
    read_at: string;
    peak?: {
        input_per_million_usd: number;
        output_per_million_usd: number;
        cache_read_per_million_usd: number;
        cache_write_per_million_usd: number;
        days: number[];
        hours: Array<[number, number]>;
    };
}

const ANTHROPIC_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const ANTHROPIC_READ_AT = '2026-09-22';
const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/pricing';
const OPENAI_READ_AT = '2026-09-22';
const GROK_SOURCE = 'https://docs.x.ai/docs/models';
const GROK_READ_AT = '2026-09-22';
const DEEPSEEK_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing';
const DEEPSEEK_READ_AT = '2026-09-22';

// DeepSeek's peak window is Monday-Friday, 01:00-04:00 and 06:00-10:00 UTC, per DEEPSEEK_SOURCE; Chinese public holidays are ignored, a known, accepted source of imprecision
const DEEPSEEK_PEAK_DAYS = [1, 2, 3, 4, 5];
const DEEPSEEK_PEAK_HOURS: Array<[number, number]> = [[1, 4], [6, 10]];

/**
 * The shipped price table. Cache-write rows use each vendor's own concept of "first time this
 * content was billed": Anthropic's 5-minute cache-write multiplier (its most common cache duration),
 * OpenAI and Grok's plain input rate (their caching carries no separate write charge, only a
 * discounted read), and DeepSeek's cache-miss rate (billing a cache write is exactly billing an
 * ordinary, not-yet-cached input token). A row with no documented cache discount at all (most
 * discontinued OpenAI completions models) prices a cache read at the base input rate rather than
 * inventing a discount the vendor never published.
 *
 * The grok-* rows price every Grok call: `grokops.ts` never publishes Grok's own `costUsdTicks` as
 * `vendor_cost_usd`, because no source confirms its unit, so a Grok figure is an estimate like any
 * other vendor's. Grok CLI sessions record `grok-4.x-build` ids that xAI's pricing page does not list;
 * each is priced at its base `grok-4.x` rate by an explicit row of its own, operator decision 2026-09-23.
 *
 * A model whose vendor publishes a context-length-tiered rate (Grok's under/over 200k split) is
 * priced here at its lower, more-common tier; `AgentApiCall` carries no context-length field for this
 * module to key a second tier on, so the same accepted-imprecision treatment as the peak-hour
 * simplification applies: real sessions are overwhelmingly under the tier boundary.
 */
export const AGENT_PRICE_TABLE: AgentPriceRow[] = [
    // --- Anthropic Claude, current generation ---
    { model_id: 'claude-fable-5-1', input_per_million_usd: 10, output_per_million_usd: 50, cache_read_per_million_usd: 0.25, cache_write_per_million_usd: 12.5, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-mythos-5-1', input_per_million_usd: 10, output_per_million_usd: 50, cache_read_per_million_usd: 0.25, cache_write_per_million_usd: 12.5, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-fable-5', input_per_million_usd: 10, output_per_million_usd: 50, cache_read_per_million_usd: 1, cache_write_per_million_usd: 12.5, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-mythos-5', input_per_million_usd: 10, output_per_million_usd: 50, cache_read_per_million_usd: 1, cache_write_per_million_usd: 12.5, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-opus-5-5', input_per_million_usd: 4, output_per_million_usd: 20, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 5, source: ANTHROPIC_SOURCE, read_at: '2026-09-23' },
    { model_id: 'claude-opus-5', input_per_million_usd: 5, output_per_million_usd: 25, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 6.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-sonnet-5', input_per_million_usd: 2, output_per_million_usd: 10, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 2.5, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-haiku-4-5', input_per_million_usd: 1, output_per_million_usd: 5, cache_read_per_million_usd: 0.1, cache_write_per_million_usd: 1.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-haiku-4-5-20251001', input_per_million_usd: 1, output_per_million_usd: 5, cache_read_per_million_usd: 0.1, cache_write_per_million_usd: 1.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    // --- Anthropic Claude, legacy generation still billable (dateless aliases resolve to the newest dated snapshot per minor version) ---
    { model_id: 'claude-opus-4-8', input_per_million_usd: 5, output_per_million_usd: 25, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 6.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-opus-4-7', input_per_million_usd: 5, output_per_million_usd: 25, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 6.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-opus-4-6', input_per_million_usd: 5, output_per_million_usd: 25, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 6.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-opus-4-5', input_per_million_usd: 5, output_per_million_usd: 25, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 6.25, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-opus-4-1', input_per_million_usd: 15, output_per_million_usd: 75, cache_read_per_million_usd: 1.5, cache_write_per_million_usd: 18.75, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-opus-4', input_per_million_usd: 15, output_per_million_usd: 75, cache_read_per_million_usd: 1.5, cache_write_per_million_usd: 18.75, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-sonnet-4-6', input_per_million_usd: 3, output_per_million_usd: 15, cache_read_per_million_usd: 0.3, cache_write_per_million_usd: 3.75, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-sonnet-4-5', input_per_million_usd: 3, output_per_million_usd: 15, cache_read_per_million_usd: 0.3, cache_write_per_million_usd: 3.75, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-sonnet-4-5-20250929', input_per_million_usd: 3, output_per_million_usd: 15, cache_read_per_million_usd: 0.3, cache_write_per_million_usd: 3.75, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-sonnet-4', input_per_million_usd: 3, output_per_million_usd: 15, cache_read_per_million_usd: 0.3, cache_write_per_million_usd: 3.75, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    { model_id: 'claude-haiku-3-5', input_per_million_usd: 0.8, output_per_million_usd: 4, cache_read_per_million_usd: 0.08, cache_write_per_million_usd: 1, source: ANTHROPIC_SOURCE, read_at: ANTHROPIC_READ_AT },
    // --- OpenAI, current API lineup (reached via Codex) ---
    { model_id: 'gpt-6-astra', input_per_million_usd: 10, output_per_million_usd: 50, cache_read_per_million_usd: 1, cache_write_per_million_usd: 10, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.6-sol', input_per_million_usd: 4, output_per_million_usd: 20, cache_read_per_million_usd: 0.4, cache_write_per_million_usd: 4, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.6-terra', input_per_million_usd: 2, output_per_million_usd: 12, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 2, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.6-luna', input_per_million_usd: 0.2, output_per_million_usd: 1.2, cache_read_per_million_usd: 0.02, cache_write_per_million_usd: 0.2, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.6-cyber', input_per_million_usd: 12.5, output_per_million_usd: 75, cache_read_per_million_usd: 1.25, cache_write_per_million_usd: 12.5, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.5', input_per_million_usd: 5, output_per_million_usd: 30, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 5, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.5-pro', input_per_million_usd: 30, output_per_million_usd: 180, cache_read_per_million_usd: 30, cache_write_per_million_usd: 30, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.5-cyber', input_per_million_usd: 12.5, output_per_million_usd: 75, cache_read_per_million_usd: 1.25, cache_write_per_million_usd: 12.5, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.4', input_per_million_usd: 2.5, output_per_million_usd: 15, cache_read_per_million_usd: 0.25, cache_write_per_million_usd: 2.5, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.4-mini', input_per_million_usd: 0.75, output_per_million_usd: 4.5, cache_read_per_million_usd: 0.075, cache_write_per_million_usd: 0.75, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.4-nano', input_per_million_usd: 0.2, output_per_million_usd: 1.25, cache_read_per_million_usd: 0.02, cache_write_per_million_usd: 0.2, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.4-pro', input_per_million_usd: 30, output_per_million_usd: 180, cache_read_per_million_usd: 30, cache_write_per_million_usd: 30, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.3-codex', input_per_million_usd: 1.75, output_per_million_usd: 14, cache_read_per_million_usd: 0.175, cache_write_per_million_usd: 1.75, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.2', input_per_million_usd: 1.75, output_per_million_usd: 14, cache_read_per_million_usd: 0.175, cache_write_per_million_usd: 1.75, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.2-pro', input_per_million_usd: 21, output_per_million_usd: 168, cache_read_per_million_usd: 21, cache_write_per_million_usd: 21, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5.1', input_per_million_usd: 1.25, output_per_million_usd: 10, cache_read_per_million_usd: 0.125, cache_write_per_million_usd: 1.25, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5', input_per_million_usd: 1.25, output_per_million_usd: 10, cache_read_per_million_usd: 0.125, cache_write_per_million_usd: 1.25, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5-mini', input_per_million_usd: 0.25, output_per_million_usd: 2, cache_read_per_million_usd: 0.025, cache_write_per_million_usd: 0.25, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5-nano', input_per_million_usd: 0.05, output_per_million_usd: 0.4, cache_read_per_million_usd: 0.005, cache_write_per_million_usd: 0.05, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-5-pro', input_per_million_usd: 15, output_per_million_usd: 120, cache_read_per_million_usd: 15, cache_write_per_million_usd: 15, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    // --- OpenAI, earlier lineup still billable ---
    { model_id: 'gpt-4.1', input_per_million_usd: 2, output_per_million_usd: 8, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 2, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-4.1-mini', input_per_million_usd: 0.4, output_per_million_usd: 1.6, cache_read_per_million_usd: 0.1, cache_write_per_million_usd: 0.4, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-4.1-nano', input_per_million_usd: 0.1, output_per_million_usd: 0.4, cache_read_per_million_usd: 0.025, cache_write_per_million_usd: 0.1, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-4o', input_per_million_usd: 2.5, output_per_million_usd: 10, cache_read_per_million_usd: 1.25, cache_write_per_million_usd: 2.5, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'gpt-4o-mini', input_per_million_usd: 0.15, output_per_million_usd: 0.6, cache_read_per_million_usd: 0.075, cache_write_per_million_usd: 0.15, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'o3', input_per_million_usd: 2, output_per_million_usd: 8, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 2, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'o3-pro', input_per_million_usd: 20, output_per_million_usd: 80, cache_read_per_million_usd: 20, cache_write_per_million_usd: 20, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'o3-mini', input_per_million_usd: 1.1, output_per_million_usd: 4.4, cache_read_per_million_usd: 0.55, cache_write_per_million_usd: 1.1, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'o4-mini', input_per_million_usd: 1.1, output_per_million_usd: 4.4, cache_read_per_million_usd: 0.275, cache_write_per_million_usd: 1.1, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'o1', input_per_million_usd: 15, output_per_million_usd: 60, cache_read_per_million_usd: 7.5, cache_write_per_million_usd: 15, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    { model_id: 'o1-pro', input_per_million_usd: 150, output_per_million_usd: 600, cache_read_per_million_usd: 150, cache_write_per_million_usd: 150, source: OPENAI_SOURCE, read_at: OPENAI_READ_AT },
    // --- xAI Grok, priced at the under-200k-token tier ---
    { model_id: 'grok-4.7', input_per_million_usd: 2, output_per_million_usd: 6, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 2, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.6', input_per_million_usd: 2, output_per_million_usd: 6, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 2, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.5', input_per_million_usd: 2, output_per_million_usd: 6, cache_read_per_million_usd: 0.3, cache_write_per_million_usd: 2, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.7-build', input_per_million_usd: 2, output_per_million_usd: 6, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 2, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.6-build', input_per_million_usd: 2, output_per_million_usd: 6, cache_read_per_million_usd: 0.5, cache_write_per_million_usd: 2, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.5-build', input_per_million_usd: 2, output_per_million_usd: 6, cache_read_per_million_usd: 0.3, cache_write_per_million_usd: 2, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.3', input_per_million_usd: 1.25, output_per_million_usd: 2.5, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 1.25, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.20-0309-reasoning', input_per_million_usd: 1.25, output_per_million_usd: 2.5, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 1.25, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.20-0309-non-reasoning', input_per_million_usd: 1.25, output_per_million_usd: 2.5, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 1.25, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-4.20-multi-agent-0309', input_per_million_usd: 1.25, output_per_million_usd: 2.5, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 1.25, source: GROK_SOURCE, read_at: GROK_READ_AT },
    { model_id: 'grok-build-0.1', input_per_million_usd: 1, output_per_million_usd: 2, cache_read_per_million_usd: 0.2, cache_write_per_million_usd: 1, source: GROK_SOURCE, read_at: GROK_READ_AT },
    // --- DeepSeek, priced because a Claude Code transcript can carry a DeepSeek model id, peak/off-peak per api-docs.deepseek.com ---
    {
        model_id: 'deepseek-flash', input_per_million_usd: 0.15, output_per_million_usd: 0.6, cache_read_per_million_usd: 0.003, cache_write_per_million_usd: 0.15,
        source: DEEPSEEK_SOURCE, read_at: DEEPSEEK_READ_AT,
        peak: { input_per_million_usd: 0.3, output_per_million_usd: 1.2, cache_read_per_million_usd: 0.006, cache_write_per_million_usd: 0.3, days: DEEPSEEK_PEAK_DAYS, hours: DEEPSEEK_PEAK_HOURS },
    },
    {
        model_id: 'deepseek-v4-pro', input_per_million_usd: 0.66, output_per_million_usd: 1.98, cache_read_per_million_usd: 0.022, cache_write_per_million_usd: 0.66,
        source: DEEPSEEK_SOURCE, read_at: DEEPSEEK_READ_AT,
        peak: { input_per_million_usd: 1.32, output_per_million_usd: 3.96, cache_read_per_million_usd: 0.044, cache_write_per_million_usd: 1.32, days: DEEPSEEK_PEAK_DAYS, hours: DEEPSEEK_PEAK_HOURS },
    },
];

/**
 * Whether a timestamp falls inside one of a row's peak windows. `hours` entries are half-open, so a
 * call landing exactly on `end_hour_utc` is off-peak, matching how the vendor documents the boundary.
 */
function isInPeakWindow(iso: string, peak: NonNullable<AgentPriceRow['peak']>): boolean {
    const at = new Date(iso);
    const day = at.getUTCDay();
    const hour = at.getUTCHours();
    if (!peak.days.includes(day)) {
        return false;
    }
    return peak.hours.some(([start, end]) => hour >= start && hour < end);
}

/**
 * Whether a call's span touches a row's peak window. A real call's span is seconds to low minutes
 * long (`span_start_at` is the previous transcript record's own timestamp), so a span can only ever
 * straddle a peak boundary by a few minutes either side; it cannot practically bridge the 2+ hour gap
 * between DeepSeek's two daily windows. Checking `at` and `span_start_at` each against the window
 * independently therefore catches every real case without walking the interval hour by hour, which
 * would be solving a multi-day scheduling problem no real call shape ever presents.
 */
function spanTouchesPeakWindow(call: AgentApiCall, peak: NonNullable<AgentPriceRow['peak']>): boolean {
    if (isInPeakWindow(call.at, peak)) {
        return true;
    }
    return call.span_start_at !== undefined && isInPeakWindow(call.span_start_at, peak);
}

/**
 * Prices one API call from the table, falling back to "unpriced" for a model id the table does not
 * carry rather than guessing at a similarly-named row's rate: a wrong price presented as a real
 * number is worse than an honest gap. A vendor-supplied figure always wins over the table, because it
 * reflects whatever billing arrangement (subscription, negotiated rate, promotional credit) the table
 * cannot see; every table-priced call is labelled an estimate for the same reason.
 */
export function priceCall(call: AgentApiCall, table: ReadonlyArray<AgentPriceRow> = AGENT_PRICE_TABLE): ActivityUsage {
    const usage: ActivityUsage = {
        input_tokens: call.input_tokens,
        output_tokens: call.output_tokens,
        cache_read_tokens: call.cache_read_tokens,
        cache_write_tokens: call.cache_write_tokens,
        is_estimate: true,
    };
    if (call.vendor_cost_usd !== undefined) {
        return { ...usage, cost_usd: call.vendor_cost_usd, is_estimate: false };
    }
    const row = table.find((r) => r.model_id === call.model_id);
    if (row === undefined) {
        return usage;
    }
    const rates = row.peak !== undefined && spanTouchesPeakWindow(call, row.peak) ? row.peak : row;
    const cost_usd = (call.input_tokens * rates.input_per_million_usd
        + call.output_tokens * rates.output_per_million_usd
        + call.cache_read_tokens * rates.cache_read_per_million_usd
        + call.cache_write_tokens * rates.cache_write_per_million_usd) / 1_000_000;
    return { ...usage, cost_usd };
}

/** prices and sums a session's calls; the summed `is_estimate` is true when any call was table-priced (`addActivityUsage`'s OR semantics), false only when every call carried its own vendor figure */
export function priceCalls(calls: ReadonlyArray<AgentApiCall>, table?: ReadonlyArray<AgentPriceRow>): ActivityUsage {
    return calls.reduce((total, call) => addActivityUsage(total, priceCall(call, table)), emptyActivityUsage());
}

/**
 * One priced call, or one priced run of consecutive calls once a session's own call count would make
 * an entry-per-call list unbounded: `at` is the entry's own (or, for a run, its last call's) own
 * timestamp, which is what a caller weighing usage against a story-editing turn's own timestamp needs.
 */
export interface AgentPricedUsageEntry {
    at: string;
    usage: ActivityUsage;
}

/**
 * A session's calls, priced individually and kept in write order, so a caller can attribute usage to
 * whichever story a turn near `at` bound to - `AgentApiCall` carries no story of its own, only what
 * `AgentAnalyser.ts`'s write calls (a separate, later-computed list) supply. Bounded to `max_entries`:
 * a session past that count is folded into that many equal-sized consecutive runs instead, each summed
 * with `priceCalls` and dated by its own last call, so the list never grows with an unusually long
 * session the way the raw call list otherwise would (PATTERNS.md > Bounded lists say they are bounded).
 */
export function pricePerCallBounded(calls: ReadonlyArray<AgentApiCall>, max_entries: number, table?: ReadonlyArray<AgentPriceRow>): AgentPricedUsageEntry[] {
    if (calls.length <= max_entries) {
        return calls.map((call) => ({ at: call.at, usage: priceCall(call, table) }));
    }
    const run_size = Math.ceil(calls.length / max_entries);
    const entries: AgentPricedUsageEntry[] = [];
    for (let start = 0; start < calls.length; start += run_size) {
        const run = calls.slice(start, start + run_size);
        entries.push({ at: run[run.length - 1].at, usage: priceCalls(run, table) });
    }
    return entries;
}

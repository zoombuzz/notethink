import { AGENT_PRICE_TABLE, priceCall, priceCalls, pricePerCallBounded, type AgentPriceRow } from './agentpricingops';
import type { AgentApiCall } from './vendors/agentvendorops';

// a synthetic table, independent of AGENT_PRICE_TABLE's real (and drifting) vendor rates
const TEST_TABLE: AgentPriceRow[] = [
    {
        model_id: 'test-model-flat',
        input_per_million_usd: 10,
        output_per_million_usd: 20,
        cache_read_per_million_usd: 1,
        cache_write_per_million_usd: 5,
        source: 'https://example.test/pricing',
        read_at: '2026-01-01',
    },
    {
        model_id: 'test-model-peaked',
        input_per_million_usd: 10,
        output_per_million_usd: 20,
        cache_read_per_million_usd: 1,
        cache_write_per_million_usd: 5,
        source: 'https://example.test/pricing',
        read_at: '2026-01-01',
        peak: {
            input_per_million_usd: 100,
            output_per_million_usd: 200,
            cache_read_per_million_usd: 10,
            cache_write_per_million_usd: 50,
            days: [1, 2, 3, 4, 5],
            hours: [[1, 4], [6, 10]],
        },
    },
];

function makeCall(overrides: Partial<AgentApiCall>): AgentApiCall {
    return {
        model_id: 'test-model-flat',
        at: '2026-09-22T12:00:00.000Z',
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
        cache_write_tokens: 1_000_000,
        ...overrides,
    };
}

describe('priceCall', () => {
    it('prices a known model with no peak window at its base rate', () => {
        const usage = priceCall(makeCall({}), TEST_TABLE);
        // 1M * $10 + 1M * $20 + 1M * $1 + 1M * $5 = $36
        expect(usage.cost_usd).toBe(36);
        expect(usage.input_tokens).toBe(1_000_000);
        expect(usage.output_tokens).toBe(1_000_000);
        expect(usage.cache_read_tokens).toBe(1_000_000);
        expect(usage.cache_write_tokens).toBe(1_000_000);
        expect(usage.is_estimate).toBe(true);
    });

    it('prices a call whose at falls inside the peak window at the peak rate', () => {
        // Wednesday 2026-09-23 02:00 UTC is inside days [1..5] hours [1,4)
        const usage = priceCall(makeCall({ model_id: 'test-model-peaked', at: '2026-09-23T02:00:00.000Z' }), TEST_TABLE);
        // 1M * $100 + 1M * $200 + 1M * $10 + 1M * $50 = $360
        expect(usage.cost_usd).toBe(360);
    });

    it('prices a call whose at falls outside the peak window at the base rate', () => {
        // Wednesday 2026-09-23 12:00 UTC is outside both [1,4) and [6,10)
        const usage = priceCall(makeCall({ model_id: 'test-model-peaked', at: '2026-09-23T12:00:00.000Z' }), TEST_TABLE);
        expect(usage.cost_usd).toBe(36);
    });

    it('prices at peak when span_start_at falls inside the peak window even though at does not', () => {
        const usage = priceCall(makeCall({
            model_id: 'test-model-peaked',
            span_start_at: '2026-09-23T03:59:00.000Z',
            at: '2026-09-23T12:00:00.000Z',
        }), TEST_TABLE);
        expect(usage.cost_usd).toBe(360);
    });

    it('leaves an unknown model id unpriced but keeps its token counts', () => {
        const usage = priceCall(makeCall({ model_id: 'no-such-model' }), TEST_TABLE);
        expect(usage.cost_usd).toBeUndefined();
        expect(usage.input_tokens).toBe(1_000_000);
        expect(usage.output_tokens).toBe(1_000_000);
        expect(usage.cache_read_tokens).toBe(1_000_000);
        expect(usage.cache_write_tokens).toBe(1_000_000);
    });

    it('uses the vendor-supplied cost verbatim and marks it not an estimate, ignoring the table', () => {
        const usage = priceCall(makeCall({ vendor_cost_usd: 1.23 }), TEST_TABLE);
        expect(usage.cost_usd).toBe(1.23);
        expect(usage.is_estimate).toBe(false);
    });
});

describe('priceCalls', () => {
    it('sums several calls, treating any table-priced call as making the total an estimate', () => {
        const calls: AgentApiCall[] = [
            makeCall({ vendor_cost_usd: 2 }),
            makeCall({ model_id: 'test-model-flat' }),
        ];
        const usage = priceCalls(calls, TEST_TABLE);
        expect(usage.cost_usd).toBe(2 + 36);
        expect(usage.input_tokens).toBe(2_000_000);
        expect(usage.output_tokens).toBe(2_000_000);
        expect(usage.cache_read_tokens).toBe(2_000_000);
        expect(usage.cache_write_tokens).toBe(2_000_000);
        // one call carried its own vendor figure and one was table-priced, so the sum is still labelled an estimate
        expect(usage.is_estimate).toBe(true);
    });

    it('starts from empty usage and returns it unchanged for no calls', () => {
        const usage = priceCalls([], TEST_TABLE);
        expect(usage.input_tokens).toBe(0);
        expect(usage.output_tokens).toBe(0);
        expect(usage.cache_read_tokens).toBe(0);
        expect(usage.cache_write_tokens).toBe(0);
        expect(usage.cost_usd).toBeUndefined();
        expect(usage.is_estimate).toBe(true);
    });
});

describe('pricePerCallBounded', () => {
    it('returns one priced entry per call, in order, when the count is within the bound', () => {
        const calls: AgentApiCall[] = [
            makeCall({ at: '2026-09-22T12:00:00.000Z', input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }),
            makeCall({ at: '2026-09-22T12:05:00.000Z', input_tokens: 0, output_tokens: 1_000_000, cache_read_tokens: 0, cache_write_tokens: 0 }),
        ];
        const entries = pricePerCallBounded(calls, 10, TEST_TABLE);
        expect(entries).toEqual([
            { at: '2026-09-22T12:00:00.000Z', usage: priceCall(calls[0], TEST_TABLE) },
            { at: '2026-09-22T12:05:00.000Z', usage: priceCall(calls[1], TEST_TABLE) },
        ]);
    });

    it('folds an over-bound session into that many equal-sized consecutive runs, each dated by its own last call', () => {
        const calls: AgentApiCall[] = Array.from({ length: 5 }, (_, i) => makeCall({ at: `2026-09-22T12:0${i}:00.000Z`, input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }));
        const entries = pricePerCallBounded(calls, 2, TEST_TABLE);
        // 5 calls folded into 2 runs of ceil(5/2)=3: [0,1,2] and [3,4]
        expect(entries).toHaveLength(2);
        expect(entries[0]).toEqual({ at: '2026-09-22T12:02:00.000Z', usage: priceCalls(calls.slice(0, 3), TEST_TABLE) });
        expect(entries[1]).toEqual({ at: '2026-09-22T12:04:00.000Z', usage: priceCalls(calls.slice(3, 5), TEST_TABLE) });
        // every call's tokens still land somewhere: nothing is dropped by the folding, only grouped
        const total_input = entries.reduce((sum, entry) => sum + entry.usage.input_tokens, 0);
        expect(total_input).toBe(5_000_000);
    });

    it('returns an empty list for no calls', () => {
        expect(pricePerCallBounded([], 10, TEST_TABLE)).toEqual([]);
    });
});

describe('AGENT_PRICE_TABLE', () => {
    it('ships a non-empty, sourced and dated real table covering Claude and OpenAI models', () => {
        expect(AGENT_PRICE_TABLE.length).toBeGreaterThan(0);
        for (const row of AGENT_PRICE_TABLE) {
            expect(row.source.length).toBeGreaterThan(0);
            expect(row.read_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        expect(AGENT_PRICE_TABLE.some((row) => row.model_id.includes('claude'))).toBe(true);
        expect(AGENT_PRICE_TABLE.some((row) => row.model_id.includes('gpt'))).toBe(true);
    });

    it('prices claude-opus-5-5 at its own rate, so its sessions are not left unpriced and drop the story total', () => {
        const usage = priceCall({ model_id: 'claude-opus-5-5', at: '2026-09-23T10:00:00.000Z', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 });
        expect(usage.cost_usd).toBeCloseTo(4 + 20 + 0.2 + 5);
        expect(usage.is_estimate).toBe(true);
    });

    it.each(['grok-4.5', 'grok-4.6', 'grok-4.7'])('prices the %s-build id the Grok CLI records at its base model rate', (base_id) => {
        const tokens = { at: '2026-09-23T10:00:00.000Z', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 };
        const build_usage = priceCall({ model_id: `${base_id}-build`, ...tokens });
        expect(build_usage.cost_usd).toBeDefined();
        expect(build_usage.cost_usd).toBeCloseTo(priceCall({ model_id: base_id, ...tokens }).cost_usd!);
    });
});

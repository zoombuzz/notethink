import { test, expect, type Frame } from '@playwright/test';
import { AVAILABLE_STATE, capturedMessagesOfType, getUserMediaCalls, openFramedViewer, provideWebviewChunkConfig, pushAudioState } from '../helpers/audio-frame';

/*
 * Real capture in Chromium: the browser's fake microphone (a periodic beep), granted without a prompt, feeds
 * the real AudioWorklet in a viewer framed with allow="microphone". The harness has no extension host, so this
 * covers the webview's half, from getUserMedia to the audioChunk messages; the upload of those chunks to the
 * endpoint runs in the extension host and is covered by audioops.test.ts and AudioCaptureCoordinator.test.ts.
 */

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

const CHUNK_BYTES = 64000;
const CHUNK_MS = 2000;

interface ChunkSummary {
    chunk_index: number;
    started_at: string;
    bytes: number;
    nonzero_samples: number;
}

// the chunks posted so far, summarised in the frame so the PCM itself never crosses into the test
async function chunkSummaries(frame: Frame): Promise<ChunkSummary[]> {
    return frame.evaluate(() => (window as unknown as { __captured_messages: Array<Record<string, unknown>> }).__captured_messages
        .filter((m) => m.type === 'audioChunk')
        .map((m) => {
            const pcm = m.pcm as Uint8Array;
            const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
            return {
                chunk_index: m.chunk_index as number,
                started_at: m.started_at as string,
                bytes: pcm.byteLength,
                nonzero_samples: samples.reduce((count, s) => count + (s !== 0 ? 1 : 0), 0),
            };
        }));
}

test.describe('Audio capture from a fake microphone', () => {

    test('pressing record captures 2 s PCM chunks in order, and stopping ends capture with no further chunks', async ({ page }) => {
        test.setTimeout(60000);
        await provideWebviewChunkConfig(page);
        const frame = await openFramedViewer(page, 'microphone');
        await pushAudioState(frame, AVAILABLE_STATE);
        const toggle = frame.locator('[data-testid="audio-toggle"]');
        await expect(toggle).toBeVisible({ timeout: 5000 });
        expect(await getUserMediaCalls(frame)).toBe(0);

        await toggle.click();
        expect((await capturedMessagesOfType(frame, 'audioToggle')).at(-1)).toEqual({ type: 'audioToggle', enabled: true });
        await pushAudioState(frame, { ...AVAILABLE_STATE, enabled: true });

        await expect.poll(async () => capturedMessagesOfType(frame, 'audioCaptureStatus'), { timeout: 10000 })
            .toContainEqual({ type: 'audioCaptureStatus', capturing: true });
        expect(await getUserMediaCalls(frame)).toBe(1);
        await expect.poll(async () => (await chunkSummaries(frame)).length, { timeout: 20000 }).toBeGreaterThanOrEqual(3);

        const chunks = await chunkSummaries(frame);
        expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
        for (const chunk of chunks) {
            expect(chunk.bytes).toBe(CHUNK_BYTES);
            expect(chunk.nonzero_samples).toBeGreaterThan(0);
            expect(new Date(chunk.started_at).toISOString()).toBe(chunk.started_at);
        }
        const starts = chunks.map((c) => Date.parse(c.started_at));
        for (let i = 1; i < starts.length; i++) {
            expect(starts[i] - starts[i - 1]).toBe(CHUNK_MS);
        }

        await toggle.click();
        expect((await capturedMessagesOfType(frame, 'audioToggle')).at(-1)).toEqual({ type: 'audioToggle', enabled: false });
        await pushAudioState(frame, AVAILABLE_STATE);
        await expect.poll(async () => (await capturedMessagesOfType(frame, 'audioCaptureStatus')).at(-1), { timeout: 5000 })
            .toEqual({ type: 'audioCaptureStatus', capturing: false });
        const count_at_stop = (await chunkSummaries(frame)).length;
        // longer than one chunk period, so a capture still running would have posted another chunk
        await page.waitForTimeout(CHUNK_MS + 1000);
        expect((await chunkSummaries(frame)).length).toBe(count_at_stop);
        expect(await getUserMediaCalls(frame)).toBe(1);
    });
});

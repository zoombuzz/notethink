import { test, expect } from '@playwright/test';
import { AVAILABLE_STATE, capturedMessagesOfType, frameAllowsMicrophone, getUserMediaCalls, openFramedViewer, pushAudioState, settle } from '../helpers/audio-frame';

/*
 * The header bar's audio control inside a framed viewer: it appears only where the frame's permissions policy
 * allows the microphone, and shows a refused microphone's whole error name.
 */

test.describe('Audio control appears only where the frame can capture', () => {

    test('a frame without allow="microphone" shows no audio control and never calls getUserMedia', async ({ page }) => {
        const frame = await openFramedViewer(page);
        expect(await frameAllowsMicrophone(frame)).toBe(false);
        await pushAudioState(frame, AVAILABLE_STATE);
        await settle(frame);
        await expect(frame.locator('[data-testid="audio-control"]')).toHaveCount(0);
        await expect(frame.locator('[data-testid="audio-toggle"]')).toHaveCount(0);
        expect(await getUserMediaCalls(frame)).toBe(0);
        // the same verdict a desktop VS Code webview reaches, whose iframes carry no microphone in their allow lists
        expect(await capturedMessagesOfType(frame, 'audioFrameCheck')).toEqual([{ type: 'audioFrameCheck', verdict: 'policy-refuses' }]);
    });

    test('a frame with allow="microphone" shows the toggle without calling getUserMedia, and a press asks to start', async ({ page }) => {
        const frame = await openFramedViewer(page, 'microphone');
        expect(await frameAllowsMicrophone(frame)).toBe(true);
        await pushAudioState(frame, AVAILABLE_STATE);
        const toggle = frame.locator('[data-testid="audio-toggle"]');
        await expect(toggle).toBeVisible({ timeout: 5000 });
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(await getUserMediaCalls(frame)).toBe(0);
        await toggle.click();
        expect(await capturedMessagesOfType(frame, 'audioToggle')).toEqual([{ type: 'audioToggle', enabled: true }]);
    });

    test('the extension reporting the feature unavailable hides the control even in an allowing frame', async ({ page }) => {
        const frame = await openFramedViewer(page, 'microphone');
        await pushAudioState(frame, { ...AVAILABLE_STATE, available: false });
        await settle(frame);
        await expect(frame.locator('[data-testid="audio-control"]')).toHaveCount(0);
    });
});

test.describe('Audio control error text', () => {

    for (const width of [1280, 600]) {
        test(`shows the whole error name in the header bar, not cut off, at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 720 });
            const frame = await openFramedViewer(page, 'microphone');
            await pushAudioState(frame, { ...AVAILABLE_STATE, error_name: 'NotAllowedError' });
            const error = frame.locator('[data-testid="audio-error"]');
            await expect(error).toHaveText('Microphone unavailable: NotAllowedError', { timeout: 5000 });
            const widths = await error.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
            expect(widths.scroll).toBeLessThanOrEqual(widths.client);
        });
    }
});

import { test, expect, type Frame } from '@playwright/test';
import { AVAILABLE_STATE, capturedMessagesOfType, openFramedViewer, pushAudioState, settle } from '../helpers/audio-frame';

/*
 * The header bar's recording indicator. The viewer is framed with allow="microphone", so the control renders,
 * and owner is false throughout so no capture starts: these tests are about what the user sees. Each toggle
 * press is answered with the state the extension would send back.
 */

const NOT_OWNER = { ...AVAILABLE_STATE, owner: false };
const DOT = '[data-testid="audio-recording-dot"]';

/**
 * VS Code's default themes: the dot's colour (editorError.foreground) and the header bar's background
 * (breadcrumb.background falls back to editor.background, which is what these themes set).
 */
const THEMES = [
    { name: 'dark', error: '#f14c4c', background: '#1f1f1f' },
    { name: 'light', error: '#e51400', background: '#ffffff' },
    { name: 'high contrast dark', error: '#f48771', background: '#000000' },
    { name: 'high contrast light', error: '#b5200d', background: '#ffffff' },
];

// milliseconds from dispatching a state message until the dot is present (or absent), measured inside the frame
async function msUntilDot(frame: Frame, state: Record<string, unknown>, present: boolean): Promise<number> {
    return frame.evaluate(({ s, want, selector }) => new Promise<number>((resolve) => {
        const start = performance.now();
        const done = (): boolean => (document.querySelector(selector) !== null) === want;
        const observer = new MutationObserver(() => {
            if (done()) { observer.disconnect(); resolve(performance.now() - start); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'audioState', state: s } }));
        if (done()) { observer.disconnect(); resolve(performance.now() - start); }
    }), { s: state, want: present, selector: DOT });
}

test.describe('Recording indicator', () => {

    test('pressing the toggle on shows the dot within 100 ms, and pressing it off removes it within 100 ms', async ({ page }) => {
        const frame = await openFramedViewer(page, 'microphone');
        await pushAudioState(frame, NOT_OWNER);
        const toggle = frame.locator('[data-testid="audio-toggle"]');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(frame.locator(DOT)).toHaveCount(0);

        await toggle.click();
        expect((await capturedMessagesOfType(frame, 'audioToggle')).at(-1)).toEqual({ type: 'audioToggle', enabled: true });
        expect(await msUntilDot(frame, { ...NOT_OWNER, enabled: true }, true)).toBeLessThan(100);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toHaveText('Stop recording');

        await toggle.click();
        expect((await capturedMessagesOfType(frame, 'audioToggle')).at(-1)).toEqual({ type: 'audioToggle', enabled: false });
        expect(await msUntilDot(frame, NOT_OWNER, false)).toBeLessThan(100);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(toggle).toHaveText('Record audio');
    });

    test('the toggle works from the keyboard, and the status region announces "Recording audio"', async ({ page }) => {
        const frame = await openFramedViewer(page, 'microphone');
        await pushAudioState(frame, NOT_OWNER);
        const toggle = frame.locator('[data-testid="audio-toggle"]');
        const status = frame.locator('[data-testid="audio-status"]');
        await expect(status).toHaveAttribute('role', 'status');
        await expect(status).toHaveText('');

        await toggle.focus();
        await page.keyboard.press('Enter');
        expect((await capturedMessagesOfType(frame, 'audioToggle')).at(-1)).toEqual({ type: 'audioToggle', enabled: true });
        await pushAudioState(frame, { ...NOT_OWNER, enabled: true });
        await expect(status).toHaveText('Recording audio');
        // the dot itself is decorative, so the words in the live region are what a screen reader reads
        await expect(frame.locator(DOT)).toHaveAttribute('aria-hidden', 'true');

        await page.keyboard.press('Space');
        expect((await capturedMessagesOfType(frame, 'audioToggle')).at(-1)).toEqual({ type: 'audioToggle', enabled: false });
    });

    test('the dot pulses normally and is still, not hidden, under reduced motion', async ({ page }) => {
        const frame = await openFramedViewer(page, 'microphone');
        await pushAudioState(frame, { ...NOT_OWNER, enabled: true });
        const dot = frame.locator(DOT);
        await expect(dot).toBeVisible();
        expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
        await settle(frame);
        const still = await dot.evaluate((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return { animation: style.animationName, opacity: style.opacity, width: box.width, height: box.height };
        });
        expect(still.animation).toBe('none');
        expect(still.opacity).toBe('1');
        expect(still.width).toBeGreaterThan(0);
        expect(still.height).toBeGreaterThan(0);
    });

    for (const theme of THEMES) {
        test(`the dot holds at least 3:1 contrast against the header bar in the ${theme.name} theme`, async ({ page }) => {
            const frame = await openFramedViewer(page, 'microphone');
            await frame.evaluate((t) => {
                const root = document.documentElement.style;
                root.setProperty('--vscode-editorError-foreground', t.error);
                root.setProperty('--vscode-editor-background', t.background);
                root.setProperty('--vscode-breadcrumb-background', t.background);
            }, theme);
            await pushAudioState(frame, { ...NOT_OWNER, enabled: true });
            await expect(frame.locator(DOT)).toBeVisible();
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const ratio = await frame.evaluate((selector) => {
                const rgb = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
                const luminance = ([r, g, b]: number[]): number => {
                    const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
                    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
                };
                const dot = document.querySelector(selector)!;
                const bar = document.querySelector('[data-testid="view-toolbar"]')!;
                const fg = luminance(rgb(getComputedStyle(dot).backgroundColor));
                const bg = luminance(rgb(getComputedStyle(bar).backgroundColor));
                return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
            }, DOT);
            test.info().annotations.push({ type: 'contrast', description: `${theme.name}: ${ratio.toFixed(2)}:1` });
            expect(ratio).toBeGreaterThanOrEqual(3);
        });
    }
});

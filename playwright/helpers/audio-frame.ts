import { expect, type Frame, type Page } from '@playwright/test';
import { injectDocsFromFixture } from './inject-docs';

/*
 * Helpers for the audio specs. frame.html puts the viewer harness in a cross-origin iframe, as VS Code puts a
 * webview, so the frame's permissions policy comes from the iframe's allow list alone. The harness has no
 * extension host, so a spec pushes the audioState the extension would send and reads what the viewer posts.
 */

const HARNESS_HOST = '127.0.0.1';
const WEBVIEW_DIST = '/client/webview/dist/';

export const AVAILABLE_STATE = { available: true, enabled: false, owner: true, capturing: false, dropped_count: 0 };

/**
 * What the viewer frame exposes to a spec.
 * - __gum_calls: getUserMedia calls since the frame loaded, counted by countGetUserMedia
 * - __captured_messages: every message the viewer posted to the extension, recorded by the harness
 */
export interface AudioFrameWindow {
    __gum_calls: number;
    __captured_messages: Array<Record<string, unknown> & { type?: string }>;
}

// counts getUserMedia calls in every frame, so a spec can assert how often the microphone was asked for
export async function countGetUserMedia(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const w = window as unknown as AudioFrameWindow;
        w.__gum_calls = 0;
        const devices = navigator.mediaDevices;
        if (devices && typeof devices.getUserMedia === 'function') {
            const original = devices.getUserMedia.bind(devices);
            devices.getUserMedia = (constraints?: MediaStreamConstraints) => {
                w.__gum_calls++;
                return original(constraints);
            };
        }
    });
}

/**
 * Gives the viewer frame the chunk config the extension writes into a real webview, including the worklet
 * URL capture loads, with the harness's own bundle directory as the public path.
 */
export async function provideWebviewChunkConfig(page: Page): Promise<void> {
    await page.addInitScript(({ host, dist }) => {
        if (location.hostname !== host) { return; }
        (window as unknown as { __notethinkChunkConfig: unknown }).__notethinkChunkConfig = {
            publicPath: dist,
            nonce: '',
            audio_worklet_url: `${dist}audioWorklet.js`,
        };
    }, { host: HARNESS_HOST, dist: WEBVIEW_DIST });
}

export async function pushAudioState(frame: Frame, state: Record<string, unknown>): Promise<void> {
    await frame.evaluate((s) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'audioState', state: s } }));
    }, state);
}

// two animation frames: React has committed whatever the last message changed, and it has been painted
export async function settle(frame: Frame): Promise<void> {
    await frame.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export async function capturedMessagesOfType(frame: Frame, type: string): Promise<Array<Record<string, unknown>>> {
    return frame.evaluate((t) => (window as unknown as AudioFrameWindow).__captured_messages.filter((m) => m.type === t), type);
}

export async function getUserMediaCalls(frame: Frame): Promise<number> {
    return frame.evaluate(() => (window as unknown as AudioFrameWindow).__gum_calls);
}

export async function openFramedViewer(page: Page, allow?: string): Promise<Frame> {
    await countGetUserMedia(page);
    await page.goto(`/playwright/harness/frame.html${allow === undefined ? '' : `?allow=${encodeURIComponent(allow)}`}`);
    const frame = await (await page.waitForSelector('#viewer')).contentFrame();
    expect(frame).not.toBeNull();
    await frame!.waitForURL(new RegExp(HARNESS_HOST.replace(/\./g, '\\.')));
    await frame!.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    await injectDocsFromFixture(frame!, 'basic.md');
    await expect(frame!.locator('[data-testid="view-toolbar"]')).toBeVisible({ timeout: 5000 });
    return frame!;
}

export async function frameAllowsMicrophone(frame: Frame): Promise<boolean | undefined> {
    return frame.evaluate(() => {
        const doc = document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } };
        return doc.featurePolicy?.allowsFeature('microphone');
    });
}

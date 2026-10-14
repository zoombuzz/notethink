import type { Page } from '@playwright/test';

export async function sendCommand(page: Page, command: string, payload: Record<string, unknown> = {}): Promise<void> {
    await page.evaluate(({ command, payload }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'command', command, ...payload },
        }));
    }, { command, payload });
}

// the discovery-start / discovery-settled signal, the same message PanelSession posts around a folder scan
export async function sendPendingChange(page: Page, key: string, on: boolean): Promise<void> {
    await page.evaluate(({ key, on }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'pendingChange', key, on },
        }));
    }, { key, on });
}

/**
 * One discoveryProgress tick, the same message PanelSession posts (throttled) during a folder scan:
 * 'walking' carries dirs_walked/files_found, 'loading' carries files_loaded/files_total.
 */
export async function sendDiscoveryProgress(page: Page, progress: { phase: 'walking' | 'loading'; dirs_walked?: number; files_found?: number; files_loaded?: number; files_total?: number }): Promise<void> {
    await page.evaluate((progress) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'discoveryProgress', ...progress },
        }));
    }, progress);
}

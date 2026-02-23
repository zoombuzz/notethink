import { Page } from '@playwright/test';

export async function sendCommand(page: Page, command: string, payload: Record<string, unknown> = {}) {
    await page.evaluate(({ command, payload }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'command', command, ...payload },
        }));
    }, { command, payload });
}

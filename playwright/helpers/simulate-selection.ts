import type { Page } from '@playwright/test';

export async function simulateSelectionChanged(
    page: Page,
    docPath: string,
    position: number,
): Promise<void> {
    await page.evaluate(({ docPath, from }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'selectionChanged',
                docPath,
                selection: { head: from, anchor: from },
            },
        }));
    }, { docPath, from: position });
}

export async function simulateRangeSelectionChanged(
    page: Page,
    docPath: string,
    head: number,
    anchor: number,
): Promise<void> {
    await page.evaluate(({ docPath, head, anchor }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'selectionChanged',
                docPath,
                selection: { head, anchor },
            },
        }));
    }, { docPath, head, anchor });
}

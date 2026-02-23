import { Page } from '@playwright/test';

interface CapturedMessage {
    type: string;
    from?: number;
    to?: number;
    docId?: string;
    docPath?: string;
    [key: string]: unknown;
}

export async function getCapturedMessages(page: Page): Promise<CapturedMessage[]> {
    return page.evaluate(() => (window as any).__captured_messages);
}

export async function clearCapturedMessages(page: Page): Promise<void> {
    await page.evaluate(() => { (window as any).__captured_messages = []; });
}

export async function findRevealMessage(page: Page): Promise<CapturedMessage | undefined> {
    const messages = await getCapturedMessages(page);
    return messages.find(m => m.type === 'revealRange');
}

export async function getRevealOrSelectMessages(page: Page): Promise<CapturedMessage[]> {
    const messages = await getCapturedMessages(page);
    return messages.filter(m => m.type === 'revealRange' || m.type === 'selectRange');
}

export async function findSelectRangeMessage(page: Page): Promise<CapturedMessage | undefined> {
    const messages = await getCapturedMessages(page);
    return messages.find(m => m.type === 'selectRange');
}

import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { clearCapturedMessages, getCapturedMessages } from '../helpers/capture-messages';
import { fixtureOffsetOf } from '../helpers/fixtures';
import { sendCommand } from '../helpers/send-command';
import { simulateRangeSelectionChanged, simulateSelectionChanged, simulateSelectionCleared } from '../helpers/simulate-selection';

const FIXTURE = 'virtual-caret.md';
const UNMAPPABLE_FIXTURE = 'editor-caret-unmappable.md';

/*
 * The editor's caret in a production build. The `chromium-production` project serves the minified bundle
 * with NOTETHINK_DEV false, so what runs here is what a user's VS Code runs: the viewer draws the caret
 * the text editor reports, in a title or a linetag value, and takes no keys, posts no edit and arms
 * nothing on a click. The typing prototype is exercised against the dev bundle in virtual-caret.spec.ts.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function openBoard(page: Page): Promise<string> {
    const { path: doc_path } = await injectDocsFromFixture(page, FIXTURE);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    return doc_path;
}

// the theme variables a VS Code theme would set, with the cursor colour the caret follows
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
    await page.evaluate((mode) => {
        const light = mode === 'light';
        document.body.className = light ? 'vscode-light' : 'vscode-dark';
        const root = document.documentElement.style;
        root.setProperty('--vscode-editor-background', light ? '#ffffff' : '#1e1e1e');
        root.setProperty('--vscode-editor-foreground', light ? '#333333' : '#d4d4d4');
        root.setProperty('--vscode-editorCursor-foreground', light ? '#123456' : '#abcdef');
    }, theme);
}

// every scrolled element by its index in the document, plus the window's own offset; unscrolled elements add nothing
async function scrollOffsets(page: Page): Promise<string> {
    return page.evaluate(() => Array.from(document.querySelectorAll('*'))
        .map((el, index) => (el.scrollTop || el.scrollLeft ? `${index}:${el.scrollTop},${el.scrollLeft}` : ''))
        .filter(Boolean).join('|') + `@${window.scrollY}`);
}

// linetag values render in a production build only while showLinetagsInHeadlines is on, which the card drawer sets
async function showLinetagValues(page: Page): Promise<void> {
    await page.getByTestId('card-settings-button').click();
    await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
    await page.getByTestId('card-node-allcards').click();
    const box = page.getByTestId('setting-control-showLinetagsInHeadlines');
    await box.click();
    await expect(box).toBeChecked();
    await page.getByTestId('card-settings-button').click();
}

async function messageTypes(page: Page): Promise<string[]> {
    return (await getCapturedMessages(page)).map(message => message.type);
}

test.describe('The editor caret in a production build', () => {

    test('is a production bundle: the typing prototype is absent', async ({ page }) => {
        await harness(page);
        await openBoard(page);
        await expect(page.getByTestId('virtual-caret-input')).toHaveCount(0);
    });

    test('draws in a title and in a linetag value, takes no keys and relays nothing', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        const caret = page.getByTestId('virtual-caret');
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'Plain title') + 5);
        await expect(caret).toHaveAttribute('data-caret-field', 'title');
        await expect(caret).toHaveAttribute('data-caret-offset', '5');
        const title_box = (await page.locator('[data-vc-title]:has-text("Plain title")').boundingBox())!;
        const caret_box = (await caret.boundingBox())!;
        expect(caret_box.x).toBeGreaterThan(title_box.x + 10);
        expect(caret_box.x).toBeLessThan(title_box.x + title_box.width - 10);
        // values are not rendered by default, so there is nowhere to draw a caret in one
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'doing') + 2);
        await expect(page.locator('[data-vc-linetag]')).toHaveCount(0);
        await expect(caret).toHaveCount(0);
        await showLinetagValues(page);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'doing') + 2);
        await expect(caret).toHaveAttribute('data-caret-field', 'status');
        await expect(caret).toHaveAttribute('data-caret-offset', '2');

        // keys typed in the view change nothing: no text, no edit, no caret move
        await clearCapturedMessages(page);
        const text_before = await page.locator('body').innerText();
        await page.keyboard.type('hello');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Home');
        await expect(caret).toHaveAttribute('data-caret-offset', '2');
        expect(await page.locator('body').innerText()).toBe(text_before);
        const types = await messageTypes(page);
        expect(types).not.toContain('editText');
        expect(types).not.toContain('selectRange');
    });

    test('a click arms no caret and posts no edit', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionCleared(page, doc_path);
        await expect(page.getByTestId('virtual-caret')).toHaveCount(0);
        await clearCapturedMessages(page);
        await page.locator('[data-vc-title]:has-text("Plain title")').click();
        await page.keyboard.type('x');
        await expect(page.getByTestId('virtual-caret')).toHaveCount(0);
        expect(await messageTypes(page)).not.toContain('editText');
    });

    test('hides for a range, outside titles and values, and when the editor releases the selection', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        const caret = page.getByTestId('virtual-caret');
        const start = fixtureOffsetOf(FIXTURE, 'Plain title');
        await simulateSelectionChanged(page, doc_path, start + 5);
        await expect(caret).toHaveCount(1);
        await simulateRangeSelectionChanged(page, doc_path, start + 5, start + 2);
        await expect(caret).toHaveCount(0);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'description of the plain title') + 4);
        await expect(caret).toHaveCount(0);
        await simulateSelectionChanged(page, doc_path, start + 5);
        await expect(caret).toHaveCount(1);
        await simulateSelectionCleared(page, doc_path);
        await expect(caret).toHaveCount(0);
    });

    test('draws nothing in a title with an entity or an autolink, and still draws in a plain one', async ({ page }) => {
        await harness(page);
        const { path: doc_path } = await injectDocsFromFixture(page, UNMAPPABLE_FIXTURE);
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        const caret = page.getByTestId('virtual-caret');
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(UNMAPPABLE_FIXTURE, 'Plain title') + 5);
        await expect(caret).toHaveCount(1);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(UNMAPPABLE_FIXTURE, 'Tom &amp;') + 2);
        await expect(caret).toHaveCount(0);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(UNMAPPABLE_FIXTURE, 'See <https') + 2);
        await expect(caret).toHaveCount(0);
    });

    test('never moves focus, scrolls the view or changes the focused card', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'Plain title') + 5);
        await expect(page.getByTestId('virtual-caret')).toHaveCount(1);
        // a focused card shows no linetag values in production, so the caret's selection cannot change what is on screen
        const focused_before = await page.locator('[data-vc-linetag]').allTextContents();
        expect(focused_before).toEqual([]);
        const active_before = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement as HTMLElement | null)?.dataset?.testid);
        const scroll_before = await scrollOffsets(page);
        // the caret settles and blinks for a while with nothing else happening
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement as HTMLElement | null)?.dataset?.testid)).toBe(active_before);
        expect(await scrollOffsets(page)).toBe(scroll_before);
        expect(await page.locator('[data-vc-linetag]').allTextContents()).toEqual(focused_before);
    });

    test('follows the theme\'s cursor colour in light and dark, and blinks', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'Plain title') + 5);
        const caret = page.getByTestId('virtual-caret');
        await setTheme(page, 'dark');
        await expect(caret).toHaveCSS('background-color', 'rgb(171, 205, 239)');
        await setTheme(page, 'light');
        await expect(caret).toHaveCSS('background-color', 'rgb(18, 52, 86)');
        expect(await caret.evaluate(el => getComputedStyle(el).animationName)).not.toBe('none');
        await expect(caret).toHaveCSS('pointer-events', 'none');
    });

    for (const view of ['document', 'line', 'kanban']) {
        test(`draws in the ${view} view`, async ({ page }) => {
            await harness(page);
            const doc_path = await openBoard(page);
            await sendCommand(page, 'setViewType', { viewType: view });
            await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
            await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'Plain title') + 5);
            await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '5');
            for (const theme of ['light', 'dark'] as const) {
                await setTheme(page, theme);
                const title_box = (await page.locator('[data-vc-title]:has-text("Plain title")').first().boundingBox())!;
                const caret_box = (await page.getByTestId('virtual-caret').boundingBox())!;
                expect(caret_box.x).toBeGreaterThan(title_box.x);
                expect(caret_box.x).toBeLessThan(title_box.x + title_box.width);
            }
        });
    }
});

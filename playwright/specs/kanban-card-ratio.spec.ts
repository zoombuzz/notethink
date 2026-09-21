import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * The shape a card comes out at side by side, driven in the browser against the real bundle.
 *
 * The ratio setting is a claim about the CARD, not about the lane around it: a board set to 1 : 1.4 must
 * draw cards 1.4 times as tall as they are wide. A card reaches that height by clipping its own body to
 * whatever is left of the target once its heading and attribute rows are taken off, so the claim can only
 * be checked where text really reflows and a clip really applies, which is a browser and not jsdom. What
 * the hook does with a measurement is asked of the hook directly, in useColumnWidth.test.ts.
 *
 * The fixture is the one with a card far too tall for any target and a card far too short for one, so
 * both halves of the rule are on the same board.
 */

// the tall card, which every target clips, and the one-line card, which no target reaches
const CLIPPED_CARD = 'Long Story';
const SHORT_CARD = 'Short Story';

// how far off the target a card may land, as a fraction: a couple of subpixel roundings, nothing structural
const RATIO_TOLERANCE = 0.02;

// the same for a stacked card's solved width, which carries the probe's rounding as well as its own
const WIDTH_TOLERANCE = 0.03;

async function setupKanbanBoard(page: Page, fixture: string): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, fixture);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

async function openKanbanSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('setting-row-kanbanCardRatio')).toBeVisible();
}

/** the card carrying that heading, which is the box the ratio is a claim about */
function cardNamed(page: Page, heading: string): Locator {
    return page.locator('[data-column-card-id]').filter({ has: page.getByRole('heading', { name: heading }) });
}

/** the drawn box of that card, border box included, since that is what the clip is measured against */
async function cardShape(page: Page, heading: string): Promise<{ width: number; height: number }> {
    return cardNamed(page, heading).evaluate((card) => {
        const rect = card.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
}

/** how far the card's drawn shape sits from the target, as a fraction of the target */
async function ratioError(page: Page, heading: string, ratio: number): Promise<number> {
    const shape = await cardShape(page, heading);
    if (shape.width === 0) { return 1; }
    return Math.abs(shape.height / shape.width - ratio) / ratio;
}

/** the width the stacked solve gave that card, read off the custom property the board hands it */
async function solvedCardWidth(page: Page, heading: string): Promise<number> {
    return cardNamed(page, heading).evaluate((card) => parseFloat((card as HTMLElement).style.getPropertyValue('--nt-card-width')) || 0);
}

/** put an orientation at the workspace scope before the board first renders, so the first probe runs under it */
async function seedOrientation(page: Page, orientation: string): Promise<void> {
    await page.evaluate((value) => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings?: () => void };
        harness.__nt_settings.workspace.orientation = value;
        harness.__nt_publishSettings?.();
    }, orientation);
}

test.describe('Kanban card ratio', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /*
     * What the setting promises. Side by side the ratio used to reach the lane and stop there: no target
     * height reached the card, so its body clipped at its own width instead and a board asked for 1 : 1.4
     * drew cards nearer 1 : 1.5, moving the lane far more than it moved the card.
     */
    test('a clipped card stands at the target ratio, and a short one is left short', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 800 });
        await setupKanbanBoard(page, 'manual-expand.md');
        await openKanbanSettings(page);

        for (const ratio of [1, 2]) {
            await page.selectOption('[data-testid="setting-control-kanbanCardRatio"]', `${ratio}`);
            // the card has more to say than any of these targets, so it is the clip that lands it on the ratio
            await expect(cardNamed(page, CLIPPED_CARD).getByRole('button', { name: /show more/i }).first()).toBeVisible();
            await expect.poll(() => ratioError(page, CLIPPED_CARD, ratio)).toBeLessThan(RATIO_TOLERANCE);

            // the clip applies only to a body that overflows, so a one-line card keeps its own height
            const short = await cardShape(page, SHORT_CARD);
            expect(short.height).toBeLessThan(short.width * ratio * 0.5);
        }
    });

    /*
     * The measurement that decides a stacked card's width has to be independent of the clip that height
     * produces, or the two chase each other: the probe clones the live cards, so a clone that kept its inline
     * max-height would be reading back the height the last solve handed it. Expanding the tall card takes
     * the live clip away without touching a word of the content, so the probe must answer the same.
     */
    test('the probe reads the same cards whether the live board is clipped or not', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 800 });
        await seedOrientation(page, 'rows');
        await setupKanbanBoard(page, 'manual-expand.md');
        await openKanbanSettings(page);
        await expect.poll(() => solvedCardWidth(page, CLIPPED_CARD)).toBeGreaterThan(0);
        // the first reading says nothing unless the board really is carrying a clip for the probe to read
        await expect(cardNamed(page, CLIPPED_CARD).getByRole('button', { name: /show more/i }).first()).toBeVisible();
        const while_clipped = await solvedCardWidth(page, CLIPPED_CARD);

        // dispatched rather than clicked: stacked, the wordy card is several screens wide and the bar sits off-screen
        await cardNamed(page, CLIPPED_CARD).getByRole('button', { name: /show more/i }).first().dispatchEvent('click');
        await expect(page.getByRole('button', { name: /show less/i })).toBeAttached();

        // the model is cached against the cards and the layout, so an orientation round trip is what re-probes
        await page.selectOption('[data-testid="setting-control-orientation"]', 'columns');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'columns');
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');

        await expect.poll(async () => {
            return Math.abs(await solvedCardWidth(page, CLIPPED_CARD) - while_clipped) / while_clipped;
        }).toBeLessThan(WIDTH_TOLERANCE);
    });
});

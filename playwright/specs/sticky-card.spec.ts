import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
// mirrors STICKY_FALLBACK_HUE in StickyNote.tsx: the hue of a sticky with no project to take its colour from
const STICKY_FALLBACK_HUE = '52';

/*
 * The sticky card and the view's default card type, driven in the browser against the real bundle.
 *
 * Jest proves the hue arithmetic and the registry resolution. What only a browser can show is that the lane
 * really gives up its card surface to the paper, that the paper and its curled corner are painted, that the
 * theme class VS Code stamps on the body changes them, and that the Kanban setting lands in the drawer where
 * its view puts it and changes what Auto draws.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

/** a folder kanban of two projects whose files both vote sticky, so every card is a sticky with a project */
async function stickyFolderBoard(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'card-sticky-kanban-a.md', doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
        { fixture: 'card-sticky-kanban-b.md', doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await expect(page.locator('[data-auto-selected-viewtype="kanban"]')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();
}

/** a single-file kanban on Auto with no nt_card, so the view's default decides the card, and no note has a project */
async function singleFileKanban(page: Page): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

async function openViewSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

async function openCardSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('card-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

async function workspaceSettings(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => (window as unknown as { __nt_settings: { workspace: Record<string, unknown> } }).__nt_settings.workspace);
}

/** what the card element and its paper actually paint, read from computed style */
async function surfaces(card: Locator): Promise<Record<string, string>> {
    return card.evaluate((el) => {
        const paper = el.firstElementChild as HTMLElement;
        const card_style = getComputedStyle(el);
        const paper_style = getComputedStyle(paper);
        return {
            card_background: card_style.backgroundColor,
            card_border: card_style.borderTopWidth,
            card_shadow: card_style.boxShadow,
            card_clip: card_style.clipPath,
            card_overflow: card_style.overflow,
            paper_image: paper_style.backgroundImage,
            paper_colour: paper_style.getPropertyValue('--sticky-paper').trim(),
            flap: getComputedStyle(paper, '::after').content,
        };
    });
}

test.describe('Sticky card', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    test('a sticky in a project takes its hue, and the lane gives up its card surface to the paper', async ({ page }) => {
        await stickyFolderBoard(page);
        const alpha = page.locator('[data-card-type="sticky"]').filter({ hasText: 'Alpha one' });
        const beta = page.locator('[data-card-type="sticky"]').filter({ hasText: 'Beta one' });
        const alpha_hue = await alpha.getAttribute('data-sticky-hue');
        const beta_hue = await beta.getAttribute('data-sticky-hue');
        // two projects, two hues, and neither is the yellow reserved for a note with no project
        expect(alpha_hue).not.toBe(beta_hue);
        expect(alpha_hue).not.toBe(STICKY_FALLBACK_HUE);
        expect(beta_hue).not.toBe(STICKY_FALLBACK_HUE);

        const painted = await surfaces(alpha);
        expect(painted.card_background).toBe('rgba(0, 0, 0, 0)');
        expect(painted.card_border).toBe('0px');
        expect(painted.card_shadow).toBe('none');
        // nothing on the card may clip, or the focus ring and the hanging line numbers would crop
        expect(painted.card_clip).toBe('none');
        expect(painted.card_overflow).toBe('visible');
        expect(painted.paper_image).toContain('linear-gradient');
        expect(painted.paper_colour.startsWith(`hsl(${alpha_hue} `)).toBe(true);
        expect(painted.flap).not.toBe('none');
    });

    test('the theme class VS Code stamps on the body pales the paper and lightens the project pill', async ({ page }) => {
        await stickyFolderBoard(page);
        const alpha = page.locator('[data-card-type="sticky"]').filter({ hasText: 'Alpha one' });
        const pill = alpha.getByTestId('origin-project-pill');
        const dark = await surfaces(alpha);
        const dark_pill = await pill.evaluate(el => getComputedStyle(el).backgroundColor);

        await page.evaluate(() => { document.body.className = 'vscode-light'; });

        await expect.poll(async () => (await surfaces(alpha)).paper_colour).not.toBe(dark.paper_colour);
        expect((await surfaces(alpha)).paper_colour).toContain('90%');
        await expect.poll(async () => pill.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(dark_pill);
    });

    test('a focused sticky draws its ring on the uncropped card', async ({ page }) => {
        await stickyFolderBoard(page);
        const first = page.locator('[data-card-type="sticky"]').first();
        await first.click();
        // the module class names are hashed in the bundle, so focus is read from the state the card publishes
        await expect(first).toHaveAttribute('aria-current', 'true');
        const ring = await first.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
        expect(ring.style).not.toBe('none');
        expect(ring.width).not.toBe('0px');
    });

    test('stickies draw in the document and line views as well as kanban', async ({ page }) => {
        // neither file declares a view, so the folder opens as a document and the files vote sticky
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'card-sticky-a.md', doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'card-sticky-b.md', doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await expect(page.locator('[data-auto-selected-viewtype="document"]')).toHaveCount(1, { timeout: 5000 });
        const in_document = page.locator('[data-card-type="sticky"]').first();
        await expect(in_document).toBeVisible();
        expect((await surfaces(in_document)).paper_image).toContain('linear-gradient');
        // the document view's heading margin stays out of the paper, and stacked stickies stand apart
        const layout = await page.locator('[data-card-type="sticky"]').evaluateAll(cards => cards.slice(0, 2).map(card => {
            const paper = (card.firstElementChild as HTMLElement).getBoundingClientRect();
            const heading = card.querySelector('h1, h2, h3, h4, h5, h6');
            return {
                paper_top: paper.top,
                paper_bottom: paper.bottom,
                heading_margin: heading ? getComputedStyle(heading).marginTop : 'no heading',
            };
        }));
        expect(layout[0].heading_margin).toBe('0px');
        expect(layout[1].paper_top).toBeGreaterThan(layout[0].paper_bottom);

        await openViewSettings(page);
        await page.getByTestId('view-radio-line').click();
        await expect(page.locator('[data-flip-column-id]').first()).toBeVisible({ timeout: 5000 });
        const in_line = page.locator('[data-card-type="sticky"]').first();
        await expect(in_line).toBeVisible();
        expect((await surfaces(in_line)).paper_image).toContain('linear-gradient');
    });
});

test.describe('Default card type as a Kanban view setting', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
        await singleFileKanban(page);
    });

    test('the setting follows the other Kanban rows as a dropdown showing Card', async ({ page }) => {
        await openViewSettings(page);
        const drawer = page.getByTestId('settings-drawer-grid');
        const row_keys = await drawer.locator('[data-testid^="setting-row-"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));
        const default_row = row_keys.indexOf('setting-row-kanbanDefaultCardType');
        expect(default_row).toBe(row_keys.indexOf('setting-row-kanbanAnimateTransitions') + 1);
        expect(default_row).toBeLessThan(row_keys.indexOf('setting-row-orientation'));
        await expect(drawer.getByTestId('setting-pill-kanbanDefaultCardType')).toHaveText('Kanban');

        const control = drawer.getByTestId('setting-control-kanbanDefaultCardType');
        await expect(control).toBeVisible();
        await expect(control).toHaveValue('card');
        // every renderable card is offered, because a view may default to any of them
        await expect(control.locator('option')).toHaveText(['Card', 'Sticky', 'Agent']);
    });

    test('choosing Sticky makes Auto draw yellow stickies, and the card tab says so', async ({ page }) => {
        await expect(page.locator('[data-card-type="sticky"]')).toHaveCount(0);
        await openViewSettings(page);
        await page.getByTestId('setting-control-kanbanDefaultCardType').selectOption('sticky');

        // round-trip order, so a failure names the broken link: write, render, label
        await expect.poll(async () => (await workspaceSettings(page)).kanbanDefaultCardType).toBe('sticky');
        const sticky = page.locator('[data-card-type="sticky"]').first();
        await expect(sticky).toBeVisible({ timeout: 5000 });
        // a single file carries no project, so the paper is the fallback yellow
        await expect(sticky).toHaveAttribute('data-sticky-hue', STICKY_FALLBACK_HUE);
        await expect(page.getByTestId('card-settings-button')).toContainText('Auto');
        await expect(page.getByTestId('card-settings-button')).toContainText('Sticky');
    });

    test('a card type pinned on the card tab still wins over the view default', async ({ page }) => {
        await openViewSettings(page);
        await page.getByTestId('setting-control-kanbanDefaultCardType').selectOption('sticky');
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible({ timeout: 5000 });

        await openCardSettings(page);
        await page.getByTestId('card-radio-card').click();
        await expect.poll(async () => page.locator('[data-card-type="sticky"]').count()).toBe(0);
    });
});

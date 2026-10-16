import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

interface DrawerTarget { name: string; tab_testid: string; drawer_testid: string; }

// every drawer reachable from a single-file view; Files needs folder mode and Collisions needs an actual collision
const DRAWERS: DrawerTarget[] = [
    { name: 'settings', tab_testid: 'view-settings-button', drawer_testid: 'settings-drawer-grid' },
    { name: 'cards', tab_testid: 'card-settings-button', drawer_testid: 'card-settings-drawer-grid' },
    { name: 'jump', tab_testid: 'breadcrumb-leaf', drawer_testid: 'jump-drawer-grid' },
];

// the drawers always mounted in a single-file view, Collisions included even though DRAWERS has no tab for it
const ALWAYS_MOUNTED_DRAWER_GRIDS = ['settings-drawer-grid', 'card-settings-drawer-grid', 'collisions-drawer-grid', 'jump-drawer-grid'];

// a drawer's inner .drawer box, the single element the 0fr grid trick sizes and clips
function innerDrawerBox(page: Page, drawer_testid: string): Locator {
    return page.getByTestId(drawer_testid).locator('> div').first();
}

// a closed drawer's inner .drawer box collapses to true zero height, taking its text, close button and shadow with it
async function expectDrawerFullyClosed(page: Page, drawer_testid: string): Promise<void> {
    await expect(page.getByTestId(drawer_testid)).toHaveAttribute('data-open', 'false');
    const box = await innerDrawerBox(page, drawer_testid).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBe(0);
}

// the 150ms slide transition plus the re-frame effect's own settle margin (see DRAWER_SETTLE_FALLBACK_MS)
const DRAWER_SETTLE_WAIT_MS = 500;

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function openDrawer(page: Page, target: DrawerTarget): Promise<void> {
    const tab = page.getByTestId(target.tab_testid);
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId(target.drawer_testid)).toHaveAttribute('data-open', 'true');
    await page.waitForTimeout(DRAWER_SETTLE_WAIT_MS);
}

async function closeDrawer(page: Page, target: DrawerTarget): Promise<void> {
    await page.getByTestId(target.tab_testid).click();
    await expect(page.getByTestId(target.drawer_testid)).toHaveAttribute('data-open', 'false');
    await page.waitForTimeout(DRAWER_SETTLE_WAIT_MS);
}

test.describe('Drawer overlay', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
    });

    for (const target of DRAWERS) {
        test(`opening the ${target.name} drawer leaves the first note's bounding box unchanged`, async ({ page }) => {
            const first_note = page.locator('[role="row"]').first();
            const before = await first_note.boundingBox();
            expect(before).not.toBeNull();

            await openDrawer(page, target);

            const after = await first_note.boundingBox();
            expect(after).not.toBeNull();
            expect(after!.x).toBeCloseTo(before!.x, 0);
            expect(after!.y).toBeCloseTo(before!.y, 0);
            expect(after!.width).toBeCloseTo(before!.width, 0);
        });

        test(`closing the ${target.name} drawer does not move the view`, async ({ page }) => {
            const first_note = page.locator('[role="row"]').first();
            const before = await first_note.boundingBox();
            expect(before).not.toBeNull();

            await openDrawer(page, target);
            await closeDrawer(page, target);

            const after = await first_note.boundingBox();
            expect(after).not.toBeNull();
            expect(after!.x).toBeCloseTo(before!.x, 0);
            expect(after!.y).toBeCloseTo(before!.y, 0);
            expect(after!.width).toBeCloseTo(before!.width, 0);
        });
    }

    test('a note selected low enough to be covered stays fully visible below the settings drawer once it opens', async ({ page }) => {
        const { path } = await injectDocsFromFixture(page, 'basic.md');
        // focuses the document's first note, which sits immediately below the toolbar - exactly where an open drawer lands
        await simulateSelectionChanged(page, path, 2);
        await expect(page.locator('[role="row"][aria-current="true"]')).toBeVisible({ timeout: 5000 });
        const focused_note = page.locator('[role="row"][aria-current="true"]');

        const settings: DrawerTarget = DRAWERS[0];
        await openDrawer(page, settings);

        const drawer_box = await page.getByTestId(settings.drawer_testid).boundingBox();
        const note_box = await focused_note.boundingBox();
        expect(drawer_box).not.toBeNull();
        expect(note_box).not.toBeNull();
        // fully below the drawer's bottom edge, not merely not-overlapping by a sliver
        expect(note_box!.y).toBeGreaterThanOrEqual(drawer_box!.y + drawer_box!.height);
        // and still on screen - a correction that scrolled it away entirely would also "clear" the drawer
        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();
        expect(note_box!.y).toBeLessThan(viewport!.height);
        await expect(focused_note).toBeVisible();
    });

    test('closing the settings drawer after a re-frame does not move the view further', async ({ page }) => {
        const { path } = await injectDocsFromFixture(page, 'basic.md');
        await simulateSelectionChanged(page, path, 2);
        await expect(page.locator('[role="row"][aria-current="true"]')).toBeVisible({ timeout: 5000 });
        const focused_note = page.locator('[role="row"][aria-current="true"]');

        const settings: DrawerTarget = DRAWERS[0];
        await openDrawer(page, settings);
        const framed_box = await focused_note.boundingBox();
        expect(framed_box).not.toBeNull();

        await closeDrawer(page, settings);
        const closed_box = await focused_note.boundingBox();
        expect(closed_box).not.toBeNull();
        expect(closed_box!.y).toBeCloseTo(framed_box!.y, 0);
    });

    test('with every drawer closed, none shows text or a close button, and the board sits reachable underneath', async ({ page }) => {
        for (const drawer_testid of ALWAYS_MOUNTED_DRAWER_GRIDS) {
            await expectDrawerFullyClosed(page, drawer_testid);
        }

        // the point just below the toolbar, where a leaked drawer strip would otherwise sit, resolves to the board
        const toolbar_box = await page.getByTestId('view-toolbar').boundingBox();
        expect(toolbar_box).not.toBeNull();
        const hit = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return el ? { testid: el.getAttribute('data-testid'), is_drawer: el.closest('[data-testid$="-drawer-grid"]') !== null } : null;
        }, { x: toolbar_box!.x + 10, y: toolbar_box!.y + toolbar_box!.height + 5 });
        expect(hit).not.toBeNull();
        expect(hit!.is_drawer).toBe(false);
    });

    for (const target of DRAWERS) {
        test(`with the ${target.name} drawer open, it is the only one visible`, async ({ page }) => {
            await openDrawer(page, target);

            const open_box = await innerDrawerBox(page, target.drawer_testid).boundingBox();
            expect(open_box).not.toBeNull();
            expect(open_box!.height).toBeGreaterThan(0);

            for (const other_testid of ALWAYS_MOUNTED_DRAWER_GRIDS) {
                if (other_testid === target.drawer_testid) { continue; }
                await expectDrawerFullyClosed(page, other_testid);
            }
        });
    }
});

import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { injectActivity } from '../helpers/inject-activity';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const NOTETHINK_TODO = 'notethink/docstech/users/alex.stanhope/todo.md';
const NOTEGIT_TODO = 'notegit/docstech/users/alex.stanhope/todo.md';

/*
 * The story progress pie, driven in the browser against the real bundle and a synthetic activity
 * snapshot. Jest proves where each percentage comes from and the card wiring; what only a browser
 * shows is that the pie really draws beside the headline in every card type, takes a new snapshot's
 * value live, and falls back to the story's own task boxes when no coordinator entry exists.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function pinCardType(page: Page, card_type: string): Promise<void> {
    await page.evaluate((type) => {
        const harness = window as unknown as { __nt_settings: { workspace: { cards: Record<string, Record<string, unknown>> } }; __nt_publishSettings: () => void };
        harness.__nt_settings.workspace.cards.allcards = { ...harness.__nt_settings.workspace.cards.allcards, cardType: type };
        harness.__nt_publishSettings();
    }, card_type);
}

async function folderBoard(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'activity-todo-notethink.md', doc_path: `${WORKSPACE_ROOT}/${NOTETHINK_TODO}`, relative_path: NOTETHINK_TODO },
        { fixture: 'activity-todo-notegit.md', doc_path: `${WORKSPACE_ROOT}/${NOTEGIT_TODO}`, relative_path: NOTEGIT_TODO },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
}

/** the pie inside the headline row whose story title carries this text, whatever card type draws it */
function pieFor(page: Page, headline: string): Locator {
    return page.locator('[role="rowheader"]').filter({ hasText: headline }).getByTestId('story-progress-pie').first();
}

test.describe('Story progress pie', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    test('shows the coordinator percentage beside the headline, and moves when a new snapshot arrives', async ({ page }) => {
        await folderBoard(page);
        await injectActivity(page, { sessions: [], progress: [{ story_id: 'agent-activity-card', pct: 62 }] });
        const pie = pieFor(page, 'Agent activity card');
        await expect(pie).toHaveAttribute('data-pct', '62');
        await expect(pie).toHaveAttribute('data-source', 'coordinator');
        await expect(pie).toHaveAttribute('aria-label', '62% complete');
        await expect(pie).toHaveAttribute('title', '62% complete (coordinator estimate)');
        await injectActivity(page, { sessions: [], progress: [{ story_id: 'agent-activity-card', pct: 81 }] });
        await expect(pie).toHaveAttribute('data-pct', '81');
        await expect(pie).toHaveAttribute('aria-label', '81% complete');
    });

    test('falls back to the ticked task count when the coordinator has no entry for the story', async ({ page }) => {
        await folderBoard(page);
        await injectActivity(page, { sessions: [], progress: [{ story_id: 'agent-activity-card', pct: 62 }] });
        const other = pieFor(page, 'Kanban card ratio height');
        await expect(other).toHaveAttribute('data-source', 'tasks');
        await expect(other).toHaveAttribute('data-pct', '0');
        await expect(other).toHaveAttribute('title', '0% complete (0 of 1 tasks ticked)');
    });

    test('draws on no story that is not in flight', async ({ page }) => {
        await folderBoard(page);
        await injectActivity(page, { sessions: [], progress: [{ story_id: 'agent-activity-card', pct: 62 }] });
        await expect(pieFor(page, 'Agent activity card')).toBeVisible();
        await expect(pieFor(page, 'Story nobody can declare')).toHaveCount(0);
    });

    for (const card_type of ['card', 'sticky', 'agent']) {
        test(`draws the pie on the ${card_type} card`, async ({ page }) => {
            await pinCardType(page, card_type);
            await folderBoard(page);
            await injectActivity(page, { sessions: [], progress: [{ story_id: 'agent-activity-card', pct: 40 }] });
            const pie = pieFor(page, 'Agent activity card');
            await expect(pie).toHaveAttribute('data-pct', '40');
            // the pie sits in a card of the pinned type, which the full card marks only by the absence of a type of its own
            if (card_type !== 'card') {
                await expect(page.locator(`[data-card-type="${card_type}"]`).filter({ has: pie }).first()).toBeVisible();
            }
        });
    }

    for (const card_type of ['card', 'sticky', 'agent']) {
        test(`on the ${card_type} card the pie is the pill's colour, size and line`, async ({ page }) => {
            await pinCardType(page, card_type);
            await folderBoard(page);
            await injectActivity(page, { sessions: [], progress: [{ story_id: 'agent-activity-card', pct: 100 }] });
            const row = page.locator('[role="rowheader"]').filter({ hasText: 'Agent activity card' }).first();
            const pie = row.getByTestId('story-progress-pie');
            const pill = row.getByTestId('origin-project-pill');
            await expect(pie).toHaveAttribute('data-pill-matched', 'true');
            const pill_colour = await pill.evaluate(el => getComputedStyle(el).backgroundColor);
            const wedge_colour = await pie.locator('circle').nth(1).evaluate(el => getComputedStyle(el).stroke);
            expect(wedge_colour).toBe(pill_colour);
            const pie_box = (await pie.boundingBox())!;
            const pill_box = (await pill.boundingBox())!;
            expect(Math.abs((pie_box.y + pie_box.height / 2) - (pill_box.y + pill_box.height / 2))).toBeLessThanOrEqual(1);
            expect(Math.abs(pie_box.height - pill_box.height)).toBeLessThanOrEqual(1);
        });
    }
});

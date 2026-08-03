import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { sendCommand } from '../helpers/send-command';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Manual expansion is keyed on the note's stable_id, so a descendant whose id churned on every edit above
 * it would silently drop out of the view's view_expanded_ids and collapse a card the user had opened. A
 * descendant derives an ordinal child path under its story root (`${story}:1`), so only a sibling insert
 * or remove within the story moves it: growing an earlier sibling's body leaves the expanded note's
 * identity, and therefore its expansion, alone.
 *
 * The view is drilled into the story so its `####` children render as the top-level notes - only top-level
 * notes clip, so that is what gives a descendant a "Show more" bar of its own. The edit arrives as a full
 * doc re-injection over the same path, the way the extension echoes an edited file back, because the
 * harness has no extension host to apply an editText and echo it.
 */

const FIXTURE = 'drill-expand.md';
const DOC_PATH = `/workspace/${FIXTURE}`;

// locate a heading in a fixture so the simulated caret lands inside it without a hand-counted offset
function fixtureOffsetOf(fixture: string, needle: string): number {
    const text = fs.readFileSync(path.join(__dirname, '..', 'fixtures', fixture), 'utf-8');
    const offset = text.indexOf(needle);
    if (offset < 0) { throw new Error(`fixture ${fixture} contains no ${needle}`); }
    return offset;
}

test.describe('Manual expand survives an edit to an earlier sibling', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function drillIntoStory(page: Page): Promise<void> {
        await injectDocsFromFixture(page, FIXTURE);
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        // put the caret in the story headline so the deepest focused note is the story drillIn scopes to
        await simulateSelectionChanged(page, DOC_PATH, fixtureOffsetOf(FIXTURE, '### Parent Story') + 4);
        await expect(page.getByRole('heading', { name: 'Parent Story' })).toBeVisible({ timeout: 5000 });
        await sendCommand(page, 'navigate', { direction: 'drillIn' });
        // scoped to the story: its ## epic is off screen and the #### children are the top-level notes
        await expect(page.getByRole('heading', { name: 'Delivery Epic' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Second Child' })).toBeVisible();
    }

    async function expandSecondChild(page: Page): Promise<void> {
        // only the tall descendant clips, so the single "Show more" bar on screen is its own
        const show_more = page.getByRole('button', { name: /show more/i });
        await expect(show_more).toHaveCount(1, { timeout: 5000 });
        await show_more.click();
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
    }

    test('growing an earlier sibling keeps the expanded descendant expanded', async ({ page }) => {
        await drillIntoStory(page);
        await expandSecondChild(page);

        await injectDocsFromFixture(page, 'drill-expand-grown.md', DOC_PATH);
        // the earlier sibling really did grow, so every offset below it in the story moved
        await expect(page.getByText('grown line 8 added to the first child by the edit')).toBeVisible({ timeout: 5000 });

        // the descendant kept its identity across the re-parse, so it kept its place in view_expanded_ids
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /show more/i })).toHaveCount(0);
    });
});

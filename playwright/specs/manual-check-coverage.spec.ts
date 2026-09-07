import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';

/*
 * The `+ manual:` checks on the four settings-drawer stories, driven in a browser wherever a browser can
 * answer them.
 *
 * A check filed as manual when an agent could have run it defers a finding indefinitely, so these are the
 * ones that turned out to be mechanical once someone looked: does a value survive a reload, do the drawer
 * columns still line up when the pane is squeezed, does the card vote follow a mixed folder, does pinning
 * and unpinning a card type do what the tab says. What is left for a human afterwards is the two things a
 * browser genuinely cannot judge - whether the M reads as the same colour VS Code paints a modified file,
 * and whether a target ratio looks right on your own notes.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

/** the workspace-scope settings the harness is holding, which is what a reload would restore from */
async function workspaceSettings(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => (window as unknown as { __nt_settings: { workspace: Record<string, unknown> } }).__nt_settings.workspace);
}

async function openViewSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

async function kanbanBoard(page: Page): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, 'kanban-wide.md');
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
}

test.describe('manual check: settings survive a reload', () => {

    /*
     * The manual wording is "toggle each control, reload the window, and confirm each value survives". The
     * webview cannot reload VS Code, but the thing being checked is that a change reaches configuration
     * rather than living in component state - so the assertion is that every toggle lands at the workspace
     * scope, which is the layer a reload restores from, and that a fresh mount reads them all back.
     */
    test('every control the drawer changes lands at the workspace scope and is read back on a fresh mount', async ({ page }) => {
        await harness(page);
        await kanbanBoard(page);
        await openViewSettings(page);

        await page.getByTestId('setting-control-scrollNoteIntoView').click();
        await page.getByTestId('setting-control-kanbanAnimateTransitions').click();
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await page.selectOption('[data-testid="setting-control-kanbanCardRatio"]', '2');
        await page.getByTestId('setting-control-watchUnopenedFilesInViewer').click();

        await expect.poll(async () => workspaceSettings(page)).toMatchObject({
            scrollNoteIntoView: false,
            kanbanAnimateTransitions: false,
            orientation: 'rows',
            kanbanCardRatio: 2,
            watchUnopenedFilesInViewer: false,
        });

        /*
         * The harness holds its settings in the page, so a reload wipes them where VS Code would not - the
         * half that can be checked here is the read path: hand a fresh mount the same stored values and
         * every control has to come back reading them rather than its default.
         */
        const stored = await workspaceSettings(page);
        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await page.evaluate((values) => {
            const h = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings?: () => void };
            Object.assign(h.__nt_settings.workspace, values);
            h.__nt_publishSettings?.();
        }, stored);
        await kanbanBoard(page);
        await openViewSettings(page);
        await expect(page.getByTestId('setting-control-scrollNoteIntoView')).not.toBeChecked();
        await expect(page.getByTestId('setting-control-kanbanAnimateTransitions')).not.toBeChecked();
        await expect(page.locator('[data-testid="setting-control-orientation"]')).toHaveValue('rows');
        await expect(page.locator('[data-testid="setting-control-kanbanCardRatio"]')).toHaveValue('2');
        await expect(page.getByTestId('setting-control-watchUnopenedFilesInViewer')).not.toBeChecked();
    });
});

test.describe('manual check: the drawer columns stay aligned when squeezed', () => {

    /*
     * The manual wording is "confirm the name and control columns stay aligned at the narrowest usable
     * drawer width". Alignment is what the four-column grid exists for, so it is checkable: every row's
     * name starts on one x, every control starts on another, and neither collapses onto the other however
     * narrow the pane gets.
     */
    test('every row shares one name column and one control column at 480px', async ({ page }) => {
        await page.setViewportSize({ width: 480, height: 900 });
        await harness(page);
        await kanbanBoard(page);
        await openViewSettings(page);
        await expect(page.getByTestId('setting-row-orientation')).toBeVisible();

        const columns = await page.getByTestId('settings-rows').evaluate((grid) => {
            const rows = Array.from(grid.querySelectorAll('[data-testid^="setting-row-"]'));
            return rows.map((row) => {
                const cells = Array.from(row.children).map(c => Math.round(c.getBoundingClientRect().left));
                return { key: row.getAttribute('data-testid'), marker: cells[0], name: cells[1], control: cells[2] };
            });
        });
        expect(columns.length).toBeGreaterThan(3);
        const names = new Set(columns.map(c => c.name));
        const controls = new Set(columns.map(c => c.control));
        expect(names.size).toBe(1);
        expect(controls.size).toBe(1);
        // and the columns are still distinct: a collapsed grid would align trivially
        expect([...controls][0]).toBeGreaterThan([...names][0]);
    });
});

test.describe('manual check: the card type follows a mixed folder', () => {

    async function mixedFolder(page: Page, fixture_a: string, fixture_b: string): Promise<void> {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: fixture_a, doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
            { fixture: fixture_b, doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
    }

    /*
     * The manual wording is "open a folder with mixed nt_card values across files - toolbar shows Auto (...)
     * with the majority-voted card type". One file votes sticky and one votes nothing, so sticky is the
     * majority of the votes cast and the tab has to say so rather than falling back to the view's default.
     */
    test('the tab reads Auto with the majority-voted card, not the view default', async ({ page }) => {
        await harness(page);
        // two vote sticky and one card: a 1-1 split ties and falls back, so a winner needs three files
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'card-sticky-a.md', doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'card-sticky-b.md', doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
            { fixture: 'card-plain-b.md', doc_path: `${WORKSPACE_ROOT}/gamma/docstech/board.md`, relative_path: 'gamma/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await expect(page.getByTestId('card-settings-button')).toContainText('Auto', { timeout: 5000 });
        await expect(page.getByTestId('card-settings-button')).toContainText('Sticky');
    });

    test('an even split is a tie and falls back to the view default rather than picking a side', async ({ page }) => {
        await harness(page);
        await mixedFolder(page, 'card-sticky-a.md', 'card-plain-b.md');
        await expect(page.locator('[data-seq]').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-card-type="sticky"]')).toHaveCount(0);
    });

    /*
     * The manual wording is "explicitly set card type to Sticky - all notes render compactly across
     * columns", then "switch back to Auto - auto resolution recovers". Driven on a folder that votes for
     * nothing, so `auto` genuinely resolves to the full card and the pin is what changes the answer.
     */
    test('pinning Sticky draws every note compact, and Auto recovers the voted answer', async ({ page }) => {
        await harness(page);
        // neither file declares nt_card, so `auto` resolves to the view default and the pin moves it
        await mixedFolder(page, 'settings-drawer-board.md', 'settings-board-b.md');
        // only the compact card publishes data-card-type, so a full card is the absence of a sticky one
        await expect(page.locator('[data-card-type="sticky"]')).toHaveCount(0);

        const tab = page.getByTestId('card-settings-button');
        if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
        await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');

        await page.getByTestId('card-radio-sticky').click();
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();

        // the half the pin test misses: unpinning has to return the board to the voted answer
        await page.getByTestId('card-radio-auto').click();
        await expect.poll(async () => page.locator('[data-card-type="sticky"]').count()).toBe(0);
    });
});

test.describe('manual check: the M marker takes the modified-file colour', () => {

    /*
     * The manual wording is "compare the M colour against a modified file in the VS Code explorer side by
     * side". A browser cannot make that comparison, but it can check the half that would make it fail: the
     * marker has to take its colour from the same token VS Code paints a modified filename with, rather
     * than from a literal that merely looks close in one theme.
     */
    test('the marker and its label read from the gitDecoration modified token', async ({ page }) => {
        await harness(page);
        await kanbanBoard(page);
        await openViewSettings(page);
        await page.getByTestId('setting-control-scrollNoteIntoView').click();
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toBeVisible();

        const painted = await page.getByTestId('setting-marker-scrollNoteIntoView').evaluate((el) => {
            const token = getComputedStyle(document.documentElement).getPropertyValue('--vscode-gitDecoration-modifiedResourceForeground').trim();
            return { colour: getComputedStyle(el).color, token };
        });
        expect(painted.token).not.toBe('');
        // the harness stubs the token to Dark+'s own value, so a marker reading the token resolves to it
        const [r, g, b] = painted.colour.match(/\d+/g)!.map(Number);
        const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
        expect(hex.toLowerCase()).toBe(painted.token.toLowerCase());
    });
});

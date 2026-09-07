import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { pointerDrag } from '../helpers/pointer-drag';

/*
 * The view settings tab, driven in the browser against the real bundle.
 *
 * These four cases are the ones the drawer's design turns on, and three of them are about the same
 * rule seen from different sides: the "Save as a new view type" offer follows the row's owning-type
 * pill and needs no per-setting list. Group by is owned by an ancestor and offers; Group order is
 * owned by the selected node and does not; a Global setting has no owning type at all and does not.
 */

interface HarnessSettingsStore {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
}

async function readHarnessSettings(page: Page): Promise<HarnessSettingsStore> {
    return page.evaluate(() => (window as unknown as { __nt_settings: HarnessSettingsStore }).__nt_settings);
}

/** the lane values the board is currently drawing, in board order */
async function laneValues(page: Page): Promise<string[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => el.getAttribute('data-flip-column-id') ?? ''));
}

/** put a value at the workspace scope and re-publish the cascade, the way a reopened window arrives already diverged */
async function seedWorkspaceSetting(page: Page, key: string, value: unknown): Promise<void> {
    await page.evaluate(([setting_key, setting_value]) => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings?: () => void };
        harness.__nt_settings.workspace[setting_key as string] = setting_value;
        harness.__nt_publishSettings?.();
    }, [key, value] as [string, unknown]);
}

async function openSettingsDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

/*
 * Show the kanban node's settings on a board that is already a kanban.
 *
 * The fixture declares nt_view=kanban rather than the test switching type through the radio: a switch
 * remounts the view and the remount closes the drawer, so driving it that way tests the remount rather
 * than the pane. Clicking the node moves the highlight only, which is the point of the two marks.
 */
async function showKanbanSettings(page: Page): Promise<void> {
    await openSettingsDrawer(page);
    await page.getByTestId('view-node-kanban').click();
    await expect(page.getByTestId('setting-row-columnOrder')).toBeVisible();
}

test.describe('View settings drawer', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'settings-drawer-board.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
    });

    /*
     * Folder mode with two boards, because the group-by candidates are enumerated from the notes on the
     * board and a categorical attribute has to be present for the axis to be changeable at all.
     */
    test('changing Group by from kanban offers a new view type, because its pill names an ancestor', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await showKanbanSettings(page);

        // the lane axis is homed at grouped, above kanban, so the pill names the ancestor rather than the board
        await expect(page.getByTestId('setting-pill-kanbanGroupBy')).not.toHaveText('Kanban');
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);

        // the lane axis keeps GroupBySelector's own testid rather than the generic setting-control one
        const axis = page.getByTestId('group-by-selector');
        const candidate = (await axis.locator('option').allInnerTexts()).length;
        expect(candidate).toBeGreaterThan(1);
        // kanban's auto is status, so the label names status and the lanes ARE the statuses
        await expect(axis.locator('option').first()).toHaveText('Auto (Status)');
        expect(await laneValues(page)).toEqual(['doing', 'done']);

        await axis.selectOption('assignee');

        await expect(page.getByTestId('new-view-type-offer')).toBeVisible();
        // the write forks to kanban's own key, leaving the ancestor's value alone
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.kanbanGroupBy).not.toBeUndefined();
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.groupBy).toBeUndefined();
        // and the board honours it, which is what makes the offer above mean anything
        await expect.poll(async () => laneValues(page)).toEqual(['alex', 'sam']);
    });

    /*
     * The lane order is reordered by dragging a chip, so this drives the real pointer sensor rather than
     * a button. Two details the gesture needs: the drawer body scrolls at 50vh, so the chip has to be
     * brought into the viewport before it has a pressable box at all, and the chips are stacked one line
     * apart, so the drop point sits at the target chip's own mid-height rather than the default inset,
     * which is aimed at a full-height kanban lane and would land two chips below the target.
     */
    test('dragging a lane chip writes the new order, and offers nothing because kanban owns it outright', async ({ page }) => {
        await showKanbanSettings(page);
        await expect(page.getByTestId('setting-pill-columnOrder')).toHaveText('Kanban');

        const chips = page.getByTestId(/^column-order-chip-/);
        await chips.first().scrollIntoViewIfNeeded();
        const before = await chips.allInnerTexts();
        expect(before.length).toBeGreaterThan(1);

        const second = chips.nth(1);
        const inset = ((await second.boundingBox())?.height ?? 2) / 2;
        await pointerDrag(page, second, chips.nth(0), { destination_inset_y: inset });

        await expect.poll(async () => (await readHarnessSettings(page)).workspace.columnOrder).not.toBeUndefined();
        // the dragged lane now leads the list, which is the order the cascade echoed back
        await expect.poll(async () => (await chips.allInnerTexts())[0]).toBe(before[1]);
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);
    });

    test('a lane chip reorders from the keyboard too, since the chips carry no nudge buttons', async ({ page }) => {
        await showKanbanSettings(page);
        const chips = page.getByTestId(/^column-order-chip-/);
        const before = await chips.allInnerTexts();

        // the list stacks, so the keyboard sensor's axis is up and down rather than left and right
        await chips.nth(1).focus();
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Space');

        await expect.poll(async () => (await chips.allInnerTexts())[0]).toBe(before[1]);
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.columnOrder).not.toBeUndefined();
    });

    test('toggling a Global setting offers nothing, because it belongs to no view type', async ({ page }) => {
        await showKanbanSettings(page);
        // a global row sits under its own heading and carries no owning-type pill at all
        await expect(page.getByTestId('global-settings-heading')).toBeVisible();
        await expect(page.getByTestId('setting-pill-watchUnopenedFilesInViewer')).toHaveCount(0);

        await page.getByTestId('setting-control-watchUnopenedFilesInViewer').click();

        await expect.poll(async () => (await readHarnessSettings(page)).workspace.watchUnopenedFilesInViewer).toBe(false);
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);
    });

    test('saving the defaults drives the diverged count to zero and clears every M', async ({ page }) => {
        await openSettingsDrawer(page);
        await expect(page.getByTestId('diverged-count')).toContainText('0 settings');

        await page.getByTestId('setting-control-scrollNoteIntoView').click();
        await expect(page.getByTestId('setting-row-scrollNoteIntoView')).toHaveAttribute('data-diverged', 'true');
        await expect(page.getByTestId('diverged-count')).toContainText('1 setting');
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toHaveText('M');

        await page.getByTestId('change-defaults-summary').click();
        await page.getByTestId('save-as-default').click();

        // scrollNoteIntoView ships on, so the click turned it off; promotion moves that off into the user layer, where it becomes the saved default and stops diverging
        await expect.poll(async () => (await readHarnessSettings(page)).user.scrollNoteIntoView).toBe(false);
        await expect(page.getByTestId('setting-row-scrollNoteIntoView')).toHaveAttribute('data-diverged', 'false');
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toHaveCount(0);
        await expect(page.getByTestId('diverged-count')).toContainText('0 settings');
        await expect(page.getByTestId('setting-control-scrollNoteIntoView')).not.toBeChecked();
    });

    /*
     * Saving used to append the type and stop there, which left the button claiming something untrue. The
     * overrides only apply while the board renders as the minted node, so an unpinned type contributes
     * nothing; and the captured value stayed at workspace scope on the parent, so the row kept diverging,
     * the offer kept standing over a change it had already captured, and a second save minted a `-2`.
     */
    test('saving a new view type pins it, clears the parent, and spends the offer', async ({ page }) => {
        await showKanbanSettings(page);
        await page.getByTestId('group-by-selector').selectOption('assignee');
        await expect(page.getByTestId('new-view-type-offer')).toBeVisible();

        await page.getByTestId('new-view-type-open').click();
        await page.getByTestId('new-view-type-save').click();

        await expect.poll(async () => String((await readHarnessSettings(page)).workspace.viewType ?? '')).toMatch(/^user-/);
        // the value moved onto the minted type, so the parent is back at its saved default and no longer diverges
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.kanbanGroupBy).toBeUndefined();
        await expect(page.getByTestId('setting-row-kanbanGroupBy')).toHaveAttribute('data-diverged', 'false');
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);
    });

    /*
     * The offer is a question about the settings, not about the session. A workspace already carrying an
     * ancestor-owned change makes the offer the moment the drawer opens, with nothing touched - which the
     * earlier shape could not do, because it remembered the row the user last clicked and a reload has no
     * click to remember.
     */
    test('a workspace that already diverges offers a new view type before anything is touched', async ({ page }) => {
        await seedWorkspaceSetting(page, 'orientation', 'rows');
        // the highlight has to be on a node whose chain carries orientation, which is where the row is even rendered
        await showKanbanSettings(page);
        await expect(page.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'true');
        await expect(page.getByTestId('new-view-type-offer')).toBeVisible();
        await expect(page.getByTestId('new-view-type-reason')).toContainText('Orientation is owned by Line');
    });
});

import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';

/*
 * Keeping a change in a custom view type, driven in the browser against the real bundle.
 *
 * A custom type is the one node in the tree whose values are the user's own, so a setting it already
 * holds is editable from the drawer and the board follows it, rather than being written to the
 * workspace where the type's own value paints over it. A setting it does not hold still lands flat at
 * the workspace scope - that pre-existing fallback is unchanged - and the explicit "Save as new view
 * type" button is the one way to carry a workspace-scoped divergence into a type of its own now.
 */

interface HarnessSettingsStore {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
}

interface HarnessUserViewType {
    id: string;
    label: string;
    parent: string;
    overrides: Record<string, unknown>;
}

// the node ids VIEW_REGISTRY ships with; any other id in the views bag is a saved type, not a built-in
const BUILTIN_VIEW_IDS = new Set(['root', 'document', 'grouped', 'line', 'kanban']);

// a saved type in the shape the drawer writes one: a kanban whose groups are an axis of its own
const BY_ASSIGNEE: HarnessUserViewType = {
    id: 'user-by-assignee',
    label: 'By Assignee',
    parent: 'kanban',
    overrides: { groupBy: 'assignee' },
};

async function readHarnessSettings(page: Page): Promise<HarnessSettingsStore> {
    return page.evaluate(() => (window as unknown as { __nt_settings: HarnessSettingsStore }).__nt_settings);
}

/** the saved view types as the harness holds them, extracted from the views bag by the fields a saved type carries */
async function readSavedTypes(page: Page): Promise<HarnessUserViewType[]> {
    const settings = await readHarnessSettings(page);
    const views = ((settings.workspace.views ?? settings.user.views ?? {}) as Record<string, Record<string, unknown>>);
    return Object.entries(views)
        .filter(([id, node]) => !BUILTIN_VIEW_IDS.has(id) && typeof node.parent === 'string' && typeof node.label === 'string')
        .map(([id, node]) => {
            const { parent, label, ...overrides } = node;
            return { id, parent: parent as string, label: label as string, overrides };
        });
}

/** the group values the board is currently drawing, in board order */
async function groupValues(page: Page): Promise<string[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => el.getAttribute('data-flip-column-id') ?? ''));
}

/** put flat (Global-homed) values at the workspace scope and re-publish the cascade */
async function seedWorkspaceSettings(page: Page, values: Record<string, unknown>): Promise<void> {
    await page.evaluate((seeded) => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings?: () => void };
        Object.assign(harness.__nt_settings.workspace, seeded);
        harness.__nt_publishSettings?.();
    }, values);
}

/** seed a saved type's own bag entry and pin it as root's viewType, as a window reopened on a saved type arrives */
async function seedSavedType(page: Page, type: HarnessUserViewType): Promise<void> {
    await page.evaluate((saved) => {
        const harness = window as unknown as { __nt_settings: { workspace: { views: Record<string, Record<string, unknown>> } }; __nt_publishSettings?: () => void };
        harness.__nt_settings.workspace.views[saved.id] = { parent: saved.parent, label: saved.label, ...saved.overrides };
        harness.__nt_settings.workspace.views.root = { ...harness.__nt_settings.workspace.views.root, viewType: saved.id };
        harness.__nt_publishSettings?.();
    }, type);
}

/** re-publish the cascade unchanged, which is the arrival a reopened window sees */
async function republishSettings(page: Page): Promise<void> {
    await seedWorkspaceSettings(page, {});
}

async function openSettingsDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

/*
 * A folder board of two files rendering as the saved type, with the drawer open on that type.
 *
 * Folder mode with two boards, because the group-by candidates are enumerated from the notes and a
 * categorical attribute has to be present for the axis to be changeable at all. The type is seeded into
 * the settings rather than minted through the drawer, so each case starts from the state the operator's
 * own window opens in: a type already on disk, already pinned.
 */
async function showBoardOnSavedType(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
        { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
    ], { workspace_root: '/workspace' });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await seedSavedType(page, BY_ASSIGNEE);
    await expect(page.getByTestId('view-settings-button')).toHaveText(/By Assignee/);
    await openSettingsDrawer(page);
    await expect(page.getByTestId(`view-node-${BY_ASSIGNEE.id}`)).toBeVisible();
}

test.describe('Custom view type update', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'settings-drawer-board.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
    });

    /*
     * The fault this case stands over: the write went to the workspace, the type's override won at render,
     * and the groups never moved while the control snapped back on the next echo.
     */
    test('changing Group by on a type that holds it moves the groups and writes into the type', async ({ page }) => {
        await showBoardOnSavedType(page);
        // the board is drawn on the type's own axis, which is what makes it a type rather than a preference
        expect(await groupValues(page)).toEqual(['alex', 'sam']);
        await expect(page.getByTestId('setting-pill-groupBy')).toHaveText('By Assignee');
        await expect(page.getByTestId('setting-pill-specific-groupBy')).toBeVisible();

        // the implicit folder key, distinct from both the type's own value and kanban's built-in status default
        await page.getByTestId('group-by-selector').selectOption('nt_first_level_folder');

        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);
        await expect.poll(async () => (await readSavedTypes(page))[0].overrides.groupBy).toBe('nt_first_level_folder');
        // nothing on groupBy's home node (grouped), so nothing for the type's own value to paint over
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.grouped?.groupBy;
        }).toBeUndefined();
        await expect(page.getByTestId('group-by-selector')).toHaveValue('nt_first_level_folder');
    });

    /*
     * Clearing: picking the option that reads "(inherited)" sets the type's own value back to what it
     * would inherit, which settingWriteFor reads as "remove the key" rather than "write it explicitly".
     * Kanban's built-in default (status) is what a type below it inherits, so that candidate - not the
     * auto sentinel - is the one carrying "(inherited)" here.
     */
    test('choosing the inherited option on the type clears its own groupBy, so it inherits from kanban again', async ({ page }) => {
        await showBoardOnSavedType(page);
        await expect(page.getByTestId('group-by-selector').locator('option[value="status"]')).toHaveText(/\(inherited\)/);

        await page.getByTestId('group-by-selector').selectOption('status');

        await expect.poll(async () => (await readSavedTypes(page))[0].overrides.groupBy).toBeUndefined();
        await expect.poll(async () => groupValues(page)).toEqual(['doing', 'done']);
        // kanban's own built-in default is now what the type shows, so the pill names kanban, not grouped
        await expect(page.getByTestId('setting-pill-groupBy')).toHaveText('Kanban');
        await expect(page.getByTestId('setting-pill-specific-groupBy')).toHaveCount(0);
    });

    /*
     * A Global row writes flat regardless of selection, since it belongs to no view type at all.
     * "Save as new view type" mints an empty bag (parent and label only), so a Global write is never
     * swept into a fresh type either, and nor is the per-view value the selected type genuinely holds -
     * the new type reaches BY_ASSIGNEE's groupBy by inheriting through its parent link, not by copying it.
     */
    test('a Global row still writes flat from a saved type, and a type minted from the selected node starts empty', async ({ page }) => {
        await showBoardOnSavedType(page);

        await page.getByTestId('setting-control-watchUnopenedFilesInViewer').click();

        await expect.poll(async () => (await readHarnessSettings(page)).workspace.watchUnopenedFilesInViewer).toBe(false);
        await expect(page.getByTestId('setting-row-watchUnopenedFilesInViewer')).toHaveAttribute('data-diverged', 'true');

        await page.getByTestId('custom-view-types-summary').click();
        await page.getByTestId('new-view-type-open').click();
        await page.getByTestId('new-view-type-save').click();

        const minted = (await readSavedTypes(page)).find(type => type.parent === BY_ASSIGNEE.id);
        // no copy of BY_ASSIGNEE's own groupBy, and no sweep of the Global setting sitting at workspace scope
        expect(minted?.overrides.groupBy).toBeUndefined();
        expect(minted?.overrides.watchUnopenedFilesInViewer).toBeUndefined();

        await republishSettings(page);
        // the board still draws on 'assignee', inherited from BY_ASSIGNEE through the new type's parent link
        await expect.poll(async () => groupValues(page)).toEqual(['alex', 'sam']);
    });

    /*
     * The widened model: a kanban-homed row (cardRatio here) edited from a saved type below kanban
     * lands in the type's own overrides even when the type never held it before - never at kanban's
     * own cell, which an earlier model would have written to.
     */
    test('a kanban-homed row the type does not hold still writes into the type, never flat', async ({ page }) => {
        await showBoardOnSavedType(page);

        await page.getByTestId('setting-control-cardRatio').selectOption('2');

        await expect.poll(async () => (await readSavedTypes(page))[0].overrides.cardRatio).toBe(2);
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.kanban?.cardRatio;
        }).toBeUndefined();
        await expect(page.getByTestId('setting-pill-cardRatio')).toHaveText('By Assignee');
    });
});

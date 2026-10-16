import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';

/*
 * Per-view settings, driven in the browser against the real bundle.
 *
 * The bug this story fixes: editing a setting with a lower view selected used to rewrite the ancestor's
 * own value, so an Orientation edit on a saved type (or on Kanban directly) silently moved Line's value
 * too, and every other Line and Kanban board along with it. These cases drive the fix end to end -
 * resolveViewSetting / settingWriteFor in viewregistryops.ts - through the real settings drawer: an
 * edit at a descendant never touches the ancestor, a descendant's own value can be cleared back to
 * inheriting, and the drawer's own per-node resolution never disagrees with what the board renders.
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
            const overrides: Record<string, unknown> = {};
            for (const [field, field_value] of Object.entries(node)) {
                if (field !== 'parent' && field !== 'label') { overrides[field] = field_value; }
            }
            return { id, parent: node.parent as string, label: node.label as string, overrides };
        });
}

/** seed a saved type's own bag entry and pin it as root's viewType, as a window reopened on saved state arrives */
async function seedSavedType(page: Page, type: HarnessUserViewType): Promise<void> {
    await page.evaluate((saved) => {
        const harness = window as unknown as { __nt_settings: { workspace: { views: Record<string, Record<string, unknown>> } }; __nt_publishSettings?: () => void };
        harness.__nt_settings.workspace.views[saved.id] = { parent: saved.parent, label: saved.label, ...saved.overrides };
        harness.__nt_settings.workspace.views.root = { ...harness.__nt_settings.workspace.views.root, viewType: saved.id };
        harness.__nt_publishSettings?.();
    }, type);
}

async function openSettingsDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

async function selectTreeNode(page: Page, node_id: string): Promise<void> {
    await page.getByTestId(`view-node-${node_id}`).click();
}

test.describe('Per-view settings (orientation)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        // nt_view=kanban, so the board renders as Kanban and the drawer opens showing its settings first
        await injectDocsFromFixture(page, 'settings-drawer-board.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await openSettingsDrawer(page);
    });

    /*
     * The flagship regression: editing Orientation while Kanban is selected must land in Kanban's own
     * cell in the views bag, never in Line's own cell - so Line (and any other Kanban board reading
     * Line's own cell) is untouched.
     */
    test('an Orientation edit on Kanban writes Kanban\'s own value and leaves Line\'s own cell alone', async ({ page }) => {
        await selectTreeNode(page, 'kanban');
        await expect(page.getByTestId('setting-pill-orientation')).toHaveText('Line');
        await expect(page.getByTestId('setting-pill-inherited-orientation')).toBeVisible();

        await page.getByTestId('setting-control-orientation').selectOption('rows');

        await expect.poll(async () => {
            const settings = await readHarnessSettings(page);
            const views = settings.workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.kanban?.orientation;
        }).toBe('rows');
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.line?.orientation;
        }).toBeUndefined();

        // Line itself, selected directly, still reads its own (untouched) cell
        await selectTreeNode(page, 'line');
        await expect(page.getByTestId('setting-control-orientation')).toHaveValue('columns');
        await expect(page.getByTestId('setting-pill-specific-orientation')).toHaveCount(0);
    });

    /*
     * An edit made while Line is selected (orientation's own home) writes flat, so it reaches every
     * descendant that sets none of its own - Kanban included, here, since this board carries no
     * cell in the views bag for itself yet.
     */
    test('an edit at Line reaches a Kanban that sets none of its own', async ({ page }) => {
        await selectTreeNode(page, 'line');
        await page.getByTestId('setting-control-orientation').selectOption('rows');

        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.line?.orientation;
        }).toBe('rows');

        await selectTreeNode(page, 'kanban');
        await expect(page.getByTestId('setting-control-orientation')).toHaveValue('rows');
        await expect(page.getByTestId('setting-pill-orientation')).toHaveText('Line');
        await expect(page.getByTestId('setting-pill-inherited-orientation')).toBeVisible();
    });

    /*
     * Choosing the option labelled "(inherited)" is how a descendant's own value is cleared: the write
     * removes Kanban's own entry rather than writing the inherited value explicitly, so the view goes
     * back to tracking whatever Line holds from then on.
     */
    test('choosing the inherited option on Kanban clears its own value, so it inherits from Line again', async ({ page }) => {
        await selectTreeNode(page, 'kanban');
        await page.getByTestId('setting-control-orientation').selectOption('rows');
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.kanban?.orientation;
        }).toBe('rows');

        const control = page.getByTestId('setting-control-orientation');
        await expect(control.locator('option[value="columns"]')).toHaveText(/\(inherited\)/);
        await control.selectOption('columns');

        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.kanban?.orientation;
        }).toBeUndefined();
        await expect(page.getByTestId('setting-pill-specific-orientation')).toHaveCount(0);
        await expect(page.getByTestId('setting-pill-inherited-orientation')).toBeVisible();
    });

    /*
     * A saved type parented on Kanban is a descendant exactly like Kanban itself: its own Orientation
     * edit lands in the type's own overrides, never in Kanban's own cell in the views bag or Line's own cell,
     * so neither the built-in Kanban rung nor Line moves when the type changes.
     */
    test('an Orientation edit on a saved type selected leaves Kanban and Line unchanged', async ({ page }) => {
        const saved_type: HarnessUserViewType = { id: 'user-tall-kanban', label: 'Tall Kanban', parent: 'kanban', overrides: {} };
        await seedSavedType(page, saved_type);
        await expect(page.getByTestId('view-settings-button')).toHaveText(/Tall Kanban/);
        // the view-type switch remounts the toolbar; re-confirm the settings drawer is still the open one
        await openSettingsDrawer(page);
        await selectTreeNode(page, saved_type.id);

        await page.getByTestId('setting-control-orientation').selectOption('rows');

        await expect.poll(async () => {
            const types = await readSavedTypes(page);
            return types.find(type => type.id === saved_type.id)?.overrides.orientation;
        }).toBe('rows');
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.line?.orientation;
        }).toBeUndefined();
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.kanban?.orientation;
        }).toBeUndefined();

        await selectTreeNode(page, 'kanban');
        await expect(page.getByTestId('setting-control-orientation')).toHaveValue('columns');
        await selectTreeNode(page, 'line');
        await expect(page.getByTestId('setting-control-orientation')).toHaveValue('columns');
    });
});

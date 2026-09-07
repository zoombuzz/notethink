import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { getCapturedMessages } from '../helpers/capture-messages';

// the harness plays the extension host for settings, so its store is what a write is asserted against
interface HarnessSettingsStore {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
}

async function readHarnessSettings(page: Page): Promise<HarnessSettingsStore> {
    return page.evaluate(() => (window as unknown as { __nt_settings: HarnessSettingsStore }).__nt_settings);
}

// idempotent: a view-type switch remounts the view, and whether the drawer survives that is not what these tests are about
/*
 * Open the card settings tab.
 *
 * showLineNumbers, showLinetagsInHeadlines and autoExpandFocusedNote are card-drawn settings: they say
 * how a note is drawn rather than how the board is laid out, so they moved onto the card tab with the
 * card-type axis and are no longer on the view tab at all.
 */
async function openCardDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('card-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

async function openSettingsDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

// the two-pane drawer puts a setting's name in its own grid cell, so a row is addressed by key rather than by walking a label
function settingControl(page: Page, key: string): Locator {
    return page.getByTestId(`setting-control-${key}`);
}

/*
 * Click a settings checkbox and wait for the value to come back.
 *
 * Not `.check()`: the control is bound to the settings cascade and nothing else, so between the click
 * and the extension's echo React re-renders once with the pre-change value (markPending updates the
 * pending-work context) and the box returns to its old state for a frame. `.check()` verifies
 * immediately after clicking and fails on that frame; a click plus a retrying expect is what actually
 * asserts the round-trip landed. The flicker is the deliberate consequence of the webview holding no
 * optimistic copy of a setting.
 */
async function setCheckbox(page: Page, key: string, next: boolean): Promise<void> {
    const box = settingControl(page, key);
    if (await box.isChecked() === next) { return; }
    await box.click();
    await expect(box).toBeChecked({ checked: next });
}

test.describe('Settings Toggle', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('toggling line numbers writes the setting and renders the gutter', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await openCardDrawer(page);

        // showLineNumbers is off by default, so no headline carries a line-number span
        const line_numbers = page.getByTestId('note-lineno');
        await expect(line_numbers).toHaveCount(0);

        await setCheckbox(page, 'showLineNumbers', true);
        // the write goes to the workspace layer, which is what an ordinary edit targets
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.showLineNumbers).toBe(true);
        await expect(line_numbers.first()).toBeVisible();

        await setCheckbox(page, 'showLineNumbers', false);
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.showLineNumbers).toBe(false);
        await expect(line_numbers).toHaveCount(0);
    });

    test('a setting the drawer changes reaches the cascade and survives a view type switch', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await openCardDrawer(page);

        await setCheckbox(page, 'showLinetagsInHeadlines', true);
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.showLinetagsInHeadlines).toBe(true);

        // the view type is written through the same channel, from the view tab; the card setting survives the switch because both read the one cascade
        await openSettingsDrawer(page);
        await page.getByTestId('view-radio-kanban').click();
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.viewType).toBe('kanban');
        await openCardDrawer(page);
        await expect(settingControl(page, 'showLinetagsInHeadlines')).toBeChecked();
    });

    test('a settings change writes config only, never a per-view state message', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await openCardDrawer(page);

        await setCheckbox(page, 'autoExpandFocusedNote', true);
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.autoExpandFocusedNote).toBe(true);

        const messages = await getCapturedMessages(page);
        const writes = messages.filter(m => m.type === 'updateSetting' && m.setting === 'autoExpandFocusedNote');
        expect(writes).toHaveLength(1);
        expect(writes[0].value).toBe(true);
    });

    test('make user default promotes the workspace value into the user layer', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await openSettingsDrawer(page);

        // a view-drawn setting, because Change defaults is rendered by the view tab
        await setCheckbox(page, 'scrollNoteIntoView', false);
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.scrollNoteIntoView).toBe(false);

        await page.getByTestId('change-defaults-summary').click();
        await page.getByTestId('save-as-default').click();
        await expect.poll(async () => (await readHarnessSettings(page)).user.scrollNoteIntoView).toBe(false);
        // promotion moves the value rather than copying it, so nothing is left overriding at the workspace layer
        await expect.poll(async () => Object.keys((await readHarnessSettings(page)).workspace).length).toBe(0);
        // the checkbox still shows the change, because promotion moved the value between layers rather than altering it
        await expect(settingControl(page, 'scrollNoteIntoView')).not.toBeChecked();
    });

    test('reset to user default drops the workspace layer and the checkbox follows', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await openSettingsDrawer(page);

        // a view-drawn setting again, since Change defaults lives on the view tab; reverting clears every layer regardless of which tab owns the row
        await setCheckbox(page, 'scrollNoteIntoView', false);
        await expect(settingControl(page, 'scrollNoteIntoView')).not.toBeChecked();

        await page.getByTestId('change-defaults-summary').click();
        await page.getByTestId('revert-to-defaults').click();
        await expect.poll(async () => Object.keys((await readHarnessSettings(page)).workspace).length).toBe(0);
        await expect(settingControl(page, 'scrollNoteIntoView')).toBeChecked();
    });

    test('the open drawer tab shows an up chevron while every closed tab shows down', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // a single-file board always carries three tabs now: View settings and Card settings on the right, and the breadcrumb's terminal leaf, which is the Jump to tab
        const settings_tab = page.getByTestId('view-settings-button');
        const card_tab = page.getByTestId('card-settings-button');
        const jump_tab = page.getByTestId('breadcrumb-leaf');
        await expect(page.getByTestId('view-settings-button-chevron')).toHaveAttribute('data-direction', 'down');
        await expect(page.getByTestId('card-settings-button-chevron')).toHaveAttribute('data-direction', 'down');
        await expect(page.getByTestId('breadcrumb-leaf-chevron')).toHaveAttribute('data-direction', 'down');

        await settings_tab.click();
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
        await expect(settings_tab).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByTestId('view-settings-button-chevron')).toHaveAttribute('data-direction', 'up');
        // the drawers are mutually exclusive, so only the open one's chevron ever points up
        await expect(page.getByTestId('breadcrumb-leaf-chevron')).toHaveAttribute('data-direction', 'down');

        /*
         * The card tab is a second drawer on the same row, so it is the case most likely to break the
         * at-most-one-open invariant: opening it must hand the up chevron over rather than showing two.
         */
        await card_tab.click();
        await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
        await expect(page.getByTestId('card-settings-button-chevron')).toHaveAttribute('data-direction', 'up');
        await expect(page.getByTestId('view-settings-button-chevron')).toHaveAttribute('data-direction', 'down');
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'false');

        // opening another drawer hands the up chevron over rather than showing two
        await jump_tab.click();
        await expect(page.getByTestId('breadcrumb-leaf-chevron')).toHaveAttribute('data-direction', 'up');
        await expect(page.getByTestId('view-settings-button-chevron')).toHaveAttribute('data-direction', 'down');
        await expect(page.getByTestId('card-settings-button-chevron')).toHaveAttribute('data-direction', 'down');
        await expect(settings_tab).toHaveAttribute('aria-expanded', 'false');
        await expect(card_tab).toHaveAttribute('aria-expanded', 'false');
    });
});

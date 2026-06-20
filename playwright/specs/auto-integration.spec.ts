import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { clearCapturedMessages } from '../helpers/capture-messages';

/**
 * End-to-end coverage for the "auto-open the right breadcrumb via H1 linetags" story - the
 * automated replacement for that story's manual checklist. Each test maps to one manual item:
 *   1. cold-open of a folder-declaring file lands on the scoped Auto (Folder) board
 *   2. navigating folders in Auto (Folder) stays auto; the position survives a reload
 *   3. Auto (Current file) + a folder breadcrumb click pins concrete Folder
 *   4. a folder-declaring file pinned to current_file jumps to Auto (Folder) on a breadcrumb click
 *   5. re-selecting Auto after pinning concrete restores the file's declared scope
 *   6. a bogus nt_breadcrumb_last opens normally with no error
 *
 * The harness has no real extension, so a folder aggregation is simulated by the webview's own
 * setIntegration round-trip: we assert the outbound setIntegration message (the webview→host
 * contract) and the rendered folder board the webview produces from the injected docs.
 */

const WORKSPACE_ROOT = '/mnt/workspace/active_development';
const PORTFOLIO = `${WORKSPACE_ROOT}/portfolio`;
const DECLARING_PATH = `${PORTFOLIO}/atlas/todo.md`;
const DECLARING_REL = 'portfolio/atlas/todo.md';

const selector = (page: Page): Locator => page.locator('[data-testid="view-integration-selector"]').first();
const renderer = (page: Page): Locator => page.locator('[data-testid="NoteRenderer"]');

// the path of the most recent outbound setIntegration message for the given mode, or undefined
async function lastSetIntegrationPath(page: Page, mode: 'folder' | 'current_file'): Promise<string | undefined> {
    return page.evaluate((m) => {
        const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; mode?: string; path?: string }> }).__captured_messages;
        const matches = msgs.filter((x) => x.type === 'setIntegration' && x.mode === m);
        return matches.length ? matches[matches.length - 1].path : undefined;
    }, mode);
}

async function countSetIntegration(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { __captured_messages: Array<{ type?: string }> }).__captured_messages.filter((x) => x.type === 'setIntegration').length);
}

// the mode of the most recent outbound setIntegration message, or undefined
async function lastSetIntegrationMode(page: Page): Promise<string | undefined> {
    return page.evaluate(() => {
        const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; mode?: string }> }).__captured_messages.filter((x) => x.type === 'setIntegration');
        return msgs.length ? msgs[msgs.length - 1].mode : undefined;
    });
}

test.describe('Auto integration mode (H1 linetags)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    // manual item 1
    test('cold-opens a folder-declaring file straight into the scoped Auto (Folder) board', async ({ page }) => {
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });

        // the App-layer auto-resolution posts setIntegration scoped to the nt_breadcrumb_last folder
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(PORTFOLIO);
        // and the view flips to the folder board without a manual toolbar switch
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        // the selector reads "Auto (Folder)" - auto is still in force, resolved to folder
        await expect(selector(page)).toHaveValue('auto');
        await expect(selector(page).locator('option[value="auto"]')).toHaveText('Auto (Folder)');
        // the breadcrumb is scoped to the portfolio segment
        await expect(page.getByTestId('breadcrumb-leaf')).toHaveText('portfolio');
    });

    // manual item 2 (navigation congruence)
    test('navigating to another folder in Auto (Folder) stays Auto (Folder)', async ({ page }) => {
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await clearCapturedMessages(page);

        // click the ancestor "active_development" breadcrumb segment to re-narrow the aggregation
        await page.locator(`nav[aria-label="Breadcrumb"] button[data-path="${WORKSPACE_ROOT}"]`).click();

        // destination is folder, the file declares folder → congruent → stays Auto (Folder)
        await expect(selector(page)).toHaveValue('auto');
        await expect(selector(page).locator('option[value="auto"]')).toHaveText('Auto (Folder)');
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(WORKSPACE_ROOT);
    });

    // manual item 2 (reload-resilience) - refresh-resilience test: the reload IS the behaviour under test
    test('a navigated Auto (Folder) position survives a reload', async ({ page }) => {
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await page.locator(`nav[aria-label="Breadcrumb"] button[data-path="${WORKSPACE_ROOT}"]`).click();
        await expect(selector(page)).toHaveValue('auto');

        // wait until the navigated position has been persisted to the (sessionStorage-backed) webview state
        await expect.poll(() => page.evaluate(() => {
            try {
                const s = JSON.parse(sessionStorage.getItem('__vsCodeState') || '{}');
                return s.viewStates?.['__folder__']?.display_options?.integration_path;
            } catch { return undefined; }
        }), { timeout: 5000 }).toBe(WORKSPACE_ROOT);

        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });

        // boots back into folder mode at the navigated folder, still Auto (Folder)
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect(selector(page)).toHaveValue('auto');
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(WORKSPACE_ROOT);
    });

    // manual item 3
    test('Auto (Current file) + a folder breadcrumb click pins concrete Folder', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md', `${WORKSPACE_ROOT}/oma/docstech/todo.md`, { workspace_root: WORKSPACE_ROOT, relative_path: 'oma/docstech/todo.md' });

        // a file that declares nothing resolves to Auto (Current file)
        await expect(renderer(page)).not.toHaveAttribute('data-folder-mode', 'true');
        await expect(selector(page)).toHaveValue('auto');
        await expect(selector(page).locator('option[value="auto"]')).toHaveText('Auto (Current file)');
        await clearCapturedMessages(page);

        // click the "oma" folder segment - diverges from a current_file-declaring file → pin concrete Folder
        await page.locator(`nav[aria-label="Breadcrumb"] button[data-path="${WORKSPACE_ROOT}/oma"]`).click();
        await expect(selector(page)).toHaveValue('folder');
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(`${WORKSPACE_ROOT}/oma`);
    });

    // manual item 4
    test('a folder-declaring file pinned to current_file jumps to Auto (Folder) on a breadcrumb click', async ({ page }) => {
        // pre-seed a concrete current_file pin so auto-resolution is suppressed and the file stays current_file
        await page.addInitScript(() => {
            (window as unknown as { __vsCodeState: unknown }).__vsCodeState = { docs: {}, viewStates: { __folder__: { display_options: { integration_mode: 'current_file' } } } };
        });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });

        // the concrete pin holds - the folder-declaring file is shown in current_file mode
        await expect(renderer(page)).not.toHaveAttribute('data-folder-mode', 'true');
        await expect(selector(page)).toHaveValue('current_file');
        await clearCapturedMessages(page);

        // click the "portfolio" folder segment - congruent with the file's folder declaration → jump to Auto (Folder)
        await page.locator(`nav[aria-label="Breadcrumb"] button[data-path="${PORTFOLIO}"]`).click();
        await expect(selector(page)).toHaveValue('auto');
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(PORTFOLIO);
    });

    // manual item 5
    test('re-selecting Auto after pinning concrete restores the file-declared folder scope', async ({ page }) => {
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });

        // pin concrete current_file
        await selector(page).selectOption('current_file');
        await expect(selector(page)).toHaveValue('current_file');
        await expect(renderer(page)).not.toHaveAttribute('data-folder-mode', 'true');
        await clearCapturedMessages(page);

        // re-select Auto → full reset to the file's declaration (folder, scoped to portfolio)
        await selector(page).selectOption('auto');
        await expect(selector(page)).toHaveValue('auto');
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(PORTFOLIO);
    });

    // manual item 6
    test('a file with an unmatched nt_breadcrumb_last opens normally with no error', async ({ page }) => {
        const page_errors: string[] = [];
        page.on('pageerror', (e) => page_errors.push(String(e)));

        await injectDocsFromFixture(page, 'auto-bogus-breadcrumb.md', `${WORKSPACE_ROOT}/notes/field.md`, { workspace_root: WORKSPACE_ROOT, relative_path: 'notes/field.md' });

        // the document renders normally in current_file mode - the bogus label matched no folder or note
        await expect(page.getByText('Field Notes')).toBeVisible({ timeout: 5000 });
        await expect(renderer(page)).not.toHaveAttribute('data-folder-mode', 'true');
        await expect(selector(page)).toHaveValue('auto');
        // nothing to resolve → no setIntegration dispatched, and no thrown error
        expect(await countSetIntegration(page)).toBe(0);
        expect(page_errors).toEqual([]);
    });

});

/**
 * Reactive editor-follow: the integration mode tracks the active editor live, the same way nt_view
 * tracks the active file. Switching the active editor out of the folder scope drops to the document
 * render (the reported bug); revealing a member file inside the scope keeps the board; a live linetag
 * edit flips the mode.
 */
test.describe('Auto integration mode (reactive editor follow)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('switching the active editor to a plain file OUTSIDE the scope drops the folder board to the document render', async ({ page }) => {
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await clearCapturedMessages(page);

        // switch the active editor to a plain file at the workspace root (outside portfolio)
        const INTRO = `${WORKSPACE_ROOT}/intro.md`;
        await injectDocsFromFixture(page, 'basic.md', INTRO, { workspace_root: WORKSPACE_ROOT, relative_path: 'intro.md' });
        await simulateSelectionChanged(page, INTRO, 0);

        // the board reactively drops to the document render and posts setIntegration current_file
        await expect(renderer(page)).not.toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect.poll(() => lastSetIntegrationMode(page), { timeout: 5000 }).toBe('current_file');
    });

    test('revealing a member file INSIDE the scope keeps the folder board (card-click gate)', async ({ page }) => {
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', DECLARING_PATH, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await clearCapturedMessages(page);

        // reveal a member file inside portfolio (e.g. a card's source file)
        const MEMBER = `${PORTFOLIO}/atlas/member.md`;
        await injectDocsFromFixture(page, 'basic.md', MEMBER, { workspace_root: WORKSPACE_ROOT, relative_path: 'portfolio/atlas/member.md' });
        await simulateSelectionChanged(page, MEMBER, 0);

        // stays on the folder board - the opened file is inside the scope, so no exit
        await page.waitForTimeout(500);
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true');
        expect(await countSetIntegration(page)).toBe(0);
    });

    test('a live linetag edit adding a folder declaration flips the active file to the folder board', async ({ page }) => {
        const EDITED = `${PORTFOLIO}/atlas/todo.md`;
        // open a plain file (declares nothing) -> Auto (Current file)
        await injectDocsFromFixture(page, 'basic.md', EDITED, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });
        await simulateSelectionChanged(page, EDITED, 0);
        await expect(renderer(page)).not.toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await clearCapturedMessages(page);

        // edit the SAME file to declare folder mode (re-inject at the same path -> same id, new content)
        await injectDocsFromFixture(page, 'auto-folder-portfolio.md', EDITED, { workspace_root: WORKSPACE_ROOT, relative_path: DECLARING_REL });

        // the board enters folder mode reactively, scoped to portfolio
        await expect(renderer(page)).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect.poll(() => lastSetIntegrationPath(page, 'folder'), { timeout: 5000 }).toBe(PORTFOLIO);
    });

});

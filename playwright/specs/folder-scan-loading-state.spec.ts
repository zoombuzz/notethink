import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures } from '../helpers/inject-multi-docs';
import { sendCommand, sendPendingChange, sendDiscoveryProgress } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';

/*
 * Opening a large folder paints an empty board for as long as discovery's own file enumeration
 * takes, with no sign anything is happening, until the first aggregate lands. This holds discovery
 * open with the same pendingChange { key: 'folderDiscovery' } signal PanelSession posts around a
 * scan, asserting the scanning state renders on the board and in the breadcrumb count, then that it
 * clears for the cards once the first aggregate payload lands.
 */
test.describe('Folder scan loading state', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('shows the loading note in place of the board and a scanning count in the breadcrumb while discovery is open, then the cards once it settles', async ({ page }) => {
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true');

        // discovery has started enumerating but nothing has landed yet - holds the scan open
        await sendPendingChange(page, 'folderDiscovery', true);

        const note = page.getByTestId('loading-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText('NoteThink is loading…');
        await expect(note.getByRole('status')).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByTestId('breadcrumb-file-count')).toContainText('(scanning…)');
        await expect(page.getByTestId('empty-stories-open-files')).toHaveCount(0);
        // the note is quiet: no spinner, no progress counts of its own
        await expect(note.getByTestId('pending-work-spinner')).toHaveCount(0);

        // the panel stands in for the board, so no lane heading shows while nothing has loaded
        for (const value of ['untagged', 'doing', 'code-review', 'testing', 'done']) {
            await expect(page.locator(`[role="region"][aria-label="${value}"]`)).toHaveCount(0);
        }
        await expect(page.getByTestId('view-toolbar')).toBeVisible();

        // the first aggregate payload lands, carrying the cards; the scan clears right alongside it
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 1 });
        await sendPendingChange(page, 'folderDiscovery', false);

        await expect(page.getByTestId('loading-note')).toHaveCount(0);
        await expect(page.getByTestId('breadcrumb-file-count')).not.toContainText('(scanning…)');
        await expect(page.getByRole('heading', { name: 'Refactor parser' })).toBeVisible();
    });

    test('hides the loading note and breadcrumb count as soon as a doc streams in, before discovery settles', async ({ page }) => {
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await sendPendingChange(page, 'folderDiscovery', true);
        await expect(page.getByTestId('loading-note')).toBeVisible();

        // a per-file merge update, the shape a discovery batch streams mid-scan, discovery still "on"
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 1 });

        await expect(page.getByTestId('loading-note')).toHaveCount(0);
        await expect(page.getByTestId('breadcrumb-file-count')).not.toContainText('(scanning…)');
        await expect(page.getByText('Plan release')).toBeVisible();

        // discovery settles afterwards; nothing regresses once it does
        await sendPendingChange(page, 'folderDiscovery', false);
        await expect(page.getByTestId('loading-note')).toHaveCount(0);
    });

    test('keeps the loading note up while a streamed-in doc holds notes only in a hidden lane', async ({ page }) => {
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        // hides the 'doing' lane the injected doc's only story carries, so no card in it counts as visible
        await page.evaluate(() => {
            const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings: () => void };
            harness.__nt_settings.workspace.groupDisplay = ['untagged', 'doing', 'code-review', 'testing', 'done']
                .map(value => ({ value, shown: value !== 'doing' }));
            harness.__nt_publishSettings();
        });
        await sendPendingChange(page, 'folderDiscovery', true);

        // card-sticky-kanban-a.md's only story, "Alpha one", carries status=doing - the lane this test hides
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'card-sticky-kanban-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 1 });

        // the doc streamed in, but its only card sits in a hidden lane, so the scan still reads as in progress
        await expect(page.getByTestId('loading-note')).toBeVisible();
        await expect(page.getByTestId('loading-note')).toContainText('NoteThink is loading…');
        await expect(page.getByText('Alpha one')).toHaveCount(0);

        await sendPendingChange(page, 'folderDiscovery', false);
        await expect(page.getByTestId('loading-note')).toHaveCount(0);
    });

    test('shows a centred loading note before any message has been sent, with no board or toolbar yet', async ({ page }) => {
        // a fresh page, re-navigated so nothing from a previous test's harness state can have arrived yet
        await page.goto('/playwright/harness/index.html');
        const note = page.getByTestId('loading-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText('NoteThink is loading…');
        await expect(note.getByTestId('pending-work-spinner')).toHaveCount(0);

        // roughly centred in the viewport: nothing else has mounted yet to be "the board area"
        const note_box = await note.boundingBox();
        const viewport = page.viewportSize();
        expect(note_box).not.toBeNull();
        expect(viewport).not.toBeNull();
        if (note_box && viewport) {
            const note_center_x = note_box.x + note_box.width / 2;
            const note_center_y = note_box.y + note_box.height / 2;
            expect(Math.abs(note_center_x - viewport.width / 2)).toBeLessThan(viewport.width * 0.1);
            expect(Math.abs(note_center_y - viewport.height / 2)).toBeLessThan(viewport.height * 0.1);
        }
    });

    test('keeps the header spinner up and shows live progress in the breadcrumb count while discovery is held open with a doc streamed in', async ({ page }) => {
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await sendPendingChange(page, 'folderDiscovery', true);

        const spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
        await expect(spinner).toBeVisible({ timeout: 2000 });

        const count_tab = page.getByTestId('breadcrumb-file-count');
        await sendDiscoveryProgress(page, { phase: 'walking', dirs_walked: 120, files_found: 4 });
        await expect(count_tab).toContainText('(4 files found…)');
        await expect(count_tab).toHaveAttribute('title', 'Searched 120 folders - File settings');
        // the folders-searched count lives in the tooltip, not alongside the files-found count
        await expect(count_tab).not.toContainText('120');
        await expect(spinner).toBeVisible();

        // a doc streams in mid-scan - the count switches from the walking variant to the real "Y of M" form
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await sendDiscoveryProgress(page, { phase: 'loading', files_loaded: 1, files_total: 4 });
        await expect(count_tab).toContainText('of 4 files)');
        await expect(count_tab).not.toContainText('files found');
        // still a single spinner, still up: the per-file update and the tick neither one cleared it early
        await expect(page.locator('[data-testid="pending-work-spinner"]')).toHaveCount(1);
        await expect(spinner).toBeVisible();

        await sendPendingChange(page, 'folderDiscovery', false);
        await expect(spinner).toHaveCount(0);
        await expect(count_tab).not.toContainText('of 4 files)');
    });
});

import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

test.describe('Document-level front-matter strip', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('non-namespaced front-matter key renders a document-level pill in single-file mode, suppressed in folder mode', async ({ page }) => {
        await injectDocsFromFixture(
            page,
            'frontmatter-doc.md',
            `${WORKSPACE_ROOT}/notebook/docstech/frontmatter-doc.md`,
            { workspace_root: WORKSPACE_ROOT, relative_path: 'notebook/docstech/frontmatter-doc.md' },
        );
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // force the document view so the strip renders at the top of the centred pane
        await sendCommand(page, 'setViewType', { viewType: 'document' });

        // single-file (current_file) mode: the document root carries the front matter, so `status: inflight` shows as a document-level pill
        const status_pill = page.locator('[role="listitem"][aria-label="status"]');
        await expect(status_pill).toBeVisible({ timeout: 5000 });
        await expect(status_pill).toContainText('inflight');

        // the namespaced `nt_view` key is an internal attribute and must NOT render as a pill
        await expect(page.locator('[role="listitem"][aria-label="nt_view"]')).toHaveCount(0);

        // switch to folder mode: the merged synthetic root carries no front matter, so the document-level pill disappears
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]', { timeout: 5000 });
        await sendCommand(page, 'setViewType', { viewType: 'document' });

        await expect(page.locator('[role="listitem"][aria-label="status"]')).toHaveCount(0, { timeout: 5000 });
    });
});

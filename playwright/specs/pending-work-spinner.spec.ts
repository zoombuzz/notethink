import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode, selectIntegrationMode } from '../helpers/inject-multi-docs';
import { fixtureText } from '../helpers/fixtures';
import { parse } from '../helpers/parse-markdown';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
// folder-a.md carries two stories, so every streamed doc contributes two origin pills to the board
const PILLS_PER_DOC = 2;
const STREAM_WAVE_SIZE = 6;

// emit a pendingChange message into the webview as if the extension had sent it
async function emitPendingChange(page: Page, key: string, on: boolean): Promise<void> {
    await page.evaluate(({ k, o }) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'pendingChange', key: k, on: o } }));
    }, { k: key, o: on });
}

async function selectCurrentFileMode(page: Page): Promise<void> {
    await selectIntegrationMode(page, 'current_file');
}

interface StreamDoc {
    id: string;
    path: string;
    relative_path: string;
    text: string;
    hash_sha256: string;
    content: unknown;
}

interface BoardCommit {
    messages: number;
    docs: number;
    at: number;
}

// synthetic folder docs numbered from `start`, each a copy of the same story-bearing fixture, as discovery would load them
function buildStreamDocs(start: number, count: number): StreamDoc[] {
    const text = fixtureText('folder-a.md');
    const content = parse(text);
    return Array.from({ length: count }, (_unused, index) => {
        const relative_path = `orbit/docstech/todo-${start + index}.md`;
        return {
            id: `stream-${start + index}`,
            path: `${WORKSPACE_ROOT}/${relative_path}`,
            relative_path,
            text,
            hash_sha256: `hash-${start + index}`,
            content,
        };
    });
}

// dispatch one merge update per doc back to back, the way one discovery batch lands in the webview
async function streamFolderDocs(page: Page, docs: StreamDoc[]): Promise<void> {
    await page.evaluate((payload) => {
        for (const doc of payload) {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'update', merge_strategy: 'merge', partial: { docs: { [doc.id]: doc } } },
            }));
        }
    }, docs);
}

async function readBoardCommits(page: Page): Promise<BoardCommit[]> {
    return page.evaluate(() => (window as unknown as { __notethinkBoardCommits?: BoardCommit[] }).__notethinkBoardCommits ?? []);
}

async function clearBoardCommits(page: Page): Promise<void> {
    await page.evaluate(() => { (window as unknown as { __notethinkBoardCommits: BoardCommit[] }).__notethinkBoardCommits = []; });
}

test.describe('Pending-work spinner', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a fast settings toggle (resolves under 150 ms) shows no visible spinner', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        /*
         * a drawer toggle marks the setting key pending and posts updateSetting; the harness answers with
         * a fresh cascade on the next tick, so the round-trip clears well inside the spinner's show-delay
         */
        // showLineNumbers is a card-drawn setting, so it lives on the card tab rather than the view tab
        await page.getByTestId('card-settings-button').click();
        const line_numbers_box = page.getByTestId('setting-control-showLineNumbers');
        // click plus a retrying expect, not .check(): the box holds its old value until the echo lands
        await line_numbers_box.click();
        await expect(line_numbers_box).toBeChecked();
        // give the show-delay a chance to flip something on if anything were still marked
        await page.waitForTimeout(250);
        // no spinner anywhere (toolbar or drawers)
        await expect(page.locator('[data-testid="pending-work-spinner"]')).toHaveCount(0);
    });

    test('a slow folder-discovery (pendingChange on) shows the toolbar spinner; clearing it hides the spinner after min-visibility', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        await emitPendingChange(page, 'folderDiscovery', true);
        // spinner appears in the toolbar after the show-delay (scoped to the toolbar to avoid clashing with the drawer spinner that also responds to the same context)
        const toolbar_spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
        await expect(toolbar_spinner).toBeVisible({ timeout: 2000 });
        await emitPendingChange(page, 'folderDiscovery', false);
        // remains visible briefly to satisfy min-visibility, then disappears
        await expect(toolbar_spinner).toHaveCount(0, { timeout: 2000 });
    });

    test('integration-mode flip (folder ↔ current_file) does not flash the spinner', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await selectCurrentFileMode(page);
        await page.waitForTimeout(250);
        await expect(page.locator('[data-testid="pending-work-spinner"]')).toHaveCount(0);
    });

    test('with the Files drawer open during an apply, only the breadcrumb spinner shows (no redundant in-drawer spinner)', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        // open the Files drawer
        await page.getByTestId('breadcrumb-file-count').click();
        await expect(page.locator('[data-testid="files-drawer-grid"]')).toHaveAttribute('data-open', 'true');

        await emitPendingChange(page, 'integrationFilters', true);
        // the breadcrumb (toolbar) spinner is the single pending indicator; the redundant in-drawer copy was removed
        await expect(page.getByTestId('view-toolbar').getByTestId('pending-work-spinner')).toBeVisible({ timeout: 2000 });
        await expect(page.getByTestId('files-drawer-spinner')).toHaveCount(0);
        await emitPendingChange(page, 'integrationFilters', false);
        await expect(page.getByTestId('view-toolbar').getByTestId('pending-work-spinner')).toHaveCount(0, { timeout: 2000 });
    });

    test('prefers-reduced-motion: spinner SVG is in the DOM but the rotation keyframe is not animating', async ({ browser }) => {
        const context = await browser.newContext({ reducedMotion: 'reduce' });
        const page = await context.newPage();
        try {
            await page.goto('/playwright/harness/index.html');
            await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
            await injectMultipleDocsFromFixtures(page, [
                { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
            ], { workspace_root: WORKSPACE_ROOT });

            await emitPendingChange(page, 'folderDiscovery', true);
            // scope to the toolbar spinner; the drawer can render a second copy
            const spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
            await expect(spinner).toBeVisible({ timeout: 2000 });

            const animation_name = await spinner.locator('svg').evaluate((el) => window.getComputedStyle(el).animationName);
            // prefers-reduced-motion CSS sets animation: none, which computed style reports as 'none'
            expect(animation_name).toBe('none');
        } finally {
            await context.close();
        }
    });
});

/*
 * The webview half of the folder-load coalescing: the extension batches its discovery posts (covered by
 * the PanelSession jest suite), and whatever still arrives as separate messages is folded into one board
 * commit per animation frame here. These drive the wire messages directly, so they measure the webview.
 */
test.describe('Folder-load coalescing', () => {

    test.beforeEach(async ({ page }) => {
        // the probe has to be armed before any message lands, so it counts the load rather than the tail of it
        await page.addInitScript(() => { (window as unknown as { __NOTETHINK_COMMIT_PROBE__: boolean }).__NOTETHINK_COMMIT_PROBE__ = true; });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
    });

    test('a streamed load fills the board wave by wave and commits far fewer times than it receives messages', async ({ page }) => {
        const pills = page.locator('[data-testid="origin-project-pill"]');
        const seeded = await pills.count();
        await clearBoardCommits(page);

        // each wave is one task in the page, so its messages coalesce; the assertion between waves is the progressive fill
        for (let wave = 0; wave < 3; wave++) {
            await streamFolderDocs(page, buildStreamDocs(wave * STREAM_WAVE_SIZE, STREAM_WAVE_SIZE));
            await expect(pills).toHaveCount(seeded + (wave + 1) * STREAM_WAVE_SIZE * PILLS_PER_DOC, { timeout: 5000 });
        }

        const commits = await readBoardCommits(page);
        const streamed_messages = 3 * STREAM_WAVE_SIZE;
        // one commit per wave is the floor: fewer would mean the board revealed in one go instead of filling
        expect(commits.length).toBeGreaterThanOrEqual(3);
        expect(commits.length).toBeLessThan(streamed_messages);
        expect(commits.reduce((total, commit) => total + commit.messages, 0)).toBe(streamed_messages);
        // the board grew across the commits rather than arriving whole in the last one
        expect(commits[0].docs).toBeLessThan(commits[commits.length - 1].docs);
    });

    test('the discovery spinner clears with the docs it covered, not a frame ahead of them', async ({ page }) => {
        const toolbar_spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
        const pills = page.locator('[data-testid="origin-project-pill"]');
        // the replace below prunes these, so the final count only means something if the board started non-empty
        const seeded = await pills.count();
        expect(seeded).toBeGreaterThan(0);

        await emitPendingChange(page, 'folderDiscovery', true);
        await expect(toolbar_spinner).toBeVisible({ timeout: 2000 });

        // the extension posts the aggregate replace and clears the sentinel back to back, so both land in one frame
        const docs = buildStreamDocs(0, STREAM_WAVE_SIZE);
        await page.evaluate((payload) => {
            const docs_map: Record<string, unknown> = {};
            for (const doc of payload) { docs_map[doc.id] = doc; }
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'update', partial: { docs: docs_map }, aggregate_total_discovered: payload.length },
            }));
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'pendingChange', key: 'folderDiscovery', on: false } }));
        }, docs);

        // the replace prunes the seeded docs, so the board ends up holding exactly the streamed set
        await expect(pills).toHaveCount(STREAM_WAVE_SIZE * PILLS_PER_DOC, { timeout: 5000 });
        await expect(toolbar_spinner).toHaveCount(0, { timeout: 2000 });
    });
});

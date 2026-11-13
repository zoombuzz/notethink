import { test, expect, type Page } from '@playwright/test';
// @ts-expect-error the perf corpus generator is plain JS
import { buildFolderCorpus, buildWireDoc } from '../../scripts/perf/corpus.mjs';

const WORKSPACE_ROOT = '/workspace/perf';
const FILE_COUNT = 200;
const EDIT_COUNT = 12;
const FIRST_SENT_AT = Date.parse('2026-07-07T00:00:00.000Z');

interface WireDoc {
    id: string;
    path: string;
    relative_path: string;
    text: string;
}

/** Posts docs the way the extension's folder watcher does, each stamped `sent_at` so the webview keeps the newer copy. */
async function postDocs(page: Page, docs: WireDoc[], sent_at: string): Promise<void> {
    const workspace_projects = Array.from({ length: FILE_COUNT }, (_, index) => `project-${String(index + 1).padStart(3, '0')}`);
    await page.evaluate(({ docs_payload, sent, projects, root }) => {
        const map: Record<string, unknown> = {};
        for (const doc of docs_payload) { map[doc.id] = { ...doc, updateSentAt: sent }; }
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'update', partial: { docs: map }, merge_strategy: 'merge', workspace_root: root, workspace_projects: projects, aggregate_total_discovered: projects.length, aggregate_truncated: false },
        }));
    }, { docs_payload: docs, sent: sent_at, projects: workspace_projects, root: WORKSPACE_ROOT });
}

/**
 * A 200-file folder board windows its columns (about 55 of 2000 cards mounted), so a card edited
 * repeatedly has to stay inside its column's mounted window. Editing a headline changes the
 * story's slug-derived stable_id, which orphans the focused id a click recorded: focus must not
 * fall through to a stale offset that lands on another file's card, because the board then scrolls
 * to that card and the edited one leaves the window.
 */
test.describe('Windowed group keeps an edited card mounted', () => {
    for (const clicked_first of [false, true]) {
        test(`a card edited ${EDIT_COUNT} times in a row stays mounted (clicked first: ${clicked_first})`, async ({ page }) => {
            await page.addInitScript((seed) => { (window as unknown as { __vsCodeState: unknown }).__vsCodeState = seed; }, {
                docs: {}, viewStates: { __folder__: { type: 'kanban', display_options: { integration_mode: 'folder', integration_path: WORKSPACE_ROOT } } },
            });
            await page.goto('/playwright/harness/index.html');
            await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
            const corpus = buildFolderCorpus({ workspace_root: WORKSPACE_ROOT, file_count: FILE_COUNT, stories_per_file: 10, file_bytes: 8192, max_notes_per_file: 10 });
            const docs = corpus.docs as WireDoc[];
            for (let start = 0; start < docs.length; start += 20) { await postDocs(page, docs.slice(start, start + 20), new Date(FIRST_SENT_AT).toISOString()); }
            await page.waitForSelector('[role="columnheader"]', { timeout: 20000 });
            const first_heading = page.getByRole('heading', { name: 'Story 1', exact: true }).first();
            await expect(first_heading).toBeVisible({ timeout: 20000 });
            // far fewer cards are mounted than the corpus holds, so the windowing is what is under test
            expect(await page.locator('[data-column-card-id]').count()).toBeLessThan(100);
            if (clicked_first) { await first_heading.click(); }
            let title = 'Story 1';
            let text = docs[0].text;
            for (let edit = 1; edit <= EDIT_COUNT; edit += 1) {
                const next_title = `${title}x`;
                text = text.replace(`### ${title}`, `### ${next_title}`);
                const edited = buildWireDoc({ doc_path: docs[0].path, relative_path: docs[0].relative_path, text, include_content: false }) as WireDoc;
                await postDocs(page, [edited], new Date(FIRST_SENT_AT + edit * 1000).toISOString());
                title = next_title;
                const heading = page.getByRole('heading', { name: title, exact: true });
                await expect(heading, `edit ${edit}`).toBeVisible({ timeout: 3000 });
                // the board has not scrolled away to a different card
                await expect(heading).toBeInViewport();
            }
        });
    }
});

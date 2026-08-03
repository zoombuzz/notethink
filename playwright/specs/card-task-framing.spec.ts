import { test, expect, type Page } from '@playwright/test';
import { fixtureOffsetOf } from '../helpers/fixtures';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { simulateSelectionChanged, simulateSelectionCleared } from '../helpers/simulate-selection';

/*
 * A clipped story card frames its first incomplete task rather than its top, with a little completed
 * context above it (useMarkdownNoteBodyScroll's SCROLL_CONTEXT_PX).
 *
 * The regression this guards: the hook cached the task's `seq` behind a `body_raw` key, but
 * mergeAggregateRoot renumbers `seq` globally on every merge. An edit to ANY other file in the folder
 * left the card resolving a stale seq to a different note in the same body, so the card framed an
 * arbitrary completed item further up the story. The story's own text never changed, which is why the
 * content-keyed cache never noticed. Two files are needed to reproduce, and the untouched story must
 * sort after the file that grows so its notes are the ones renumbered.
 *
 * manual-expand.md cannot catch this: its first incomplete task is the first line of the body, so a
 * stale seq still lands near scrollTop 0 and the assertion passes for the wrong reason.
 */

const WORKSPACE_ROOT = '/mnt/workspace/active_development';
const STORY_DOC = `${WORKSPACE_ROOT}/zulu/todo.md`;
const OTHER_DOC = `${WORKSPACE_ROOT}/alpha/board.md`;
const STORY_FIXTURE = 'task-framing.md';
// the story's own headline, so a simulated caret lands on the story and not on one of its body items
const STORY_HEADLINE = 'Release a video blog update';
const FIRST_INCOMPLETE = 'work up ideas for simpler, shorter videos';
// matches SCROLL_CONTEXT_PX in useMarkdownNoteBodyScroll
const SCROLL_CONTEXT_PX = 40;

// distance from the top of the clipped body to the top of the first incomplete task, in px
async function taskOffsetFromBodyTop(page: Page, task_text: string): Promise<number | null> {
    return page.evaluate((text) => {
        const bodies = Array.from(document.querySelectorAll('div')).filter((d) => {
            const s = getComputedStyle(d);
            return s.overflow === 'hidden' && d.style.maxHeight !== '' && (d.textContent || '').includes(text);
        });
        const el = bodies[0];
        if (!el) { return null; }
        const task = Array.from(el.querySelectorAll<HTMLElement>('li[data-seq]'))
            .find(li => (li.textContent || '').trim().startsWith(text));
        if (!task) { return null; }
        return task.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }, task_text);
}

async function setupFolderBoard(page: Page, other_fixture: string): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: STORY_FIXTURE, doc_path: STORY_DOC, relative_path: 'zulu/todo.md' },
        { fixture: other_fixture, doc_path: OTHER_DOC, relative_path: 'alpha/board.md' },
    ], { workspace_root: WORKSPACE_ROOT });
}

test.describe('Clipped card frames the first incomplete task', () => {

    test.beforeEach(async ({ page }) => {
        // a narrow viewport keeps the card narrow, so the clip window is short and the framing is load-bearing
        await page.setViewportSize({ width: 460, height: 1000 });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await setupFolderBoard(page, 'task-framing-other.md');
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    });

    test('frames the first incomplete task, not the top of the story', async ({ page }) => {
        await expect.poll(() => taskOffsetFromBodyTop(page, FIRST_INCOMPLETE)).toBeCloseTo(SCROLL_CONTEXT_PX, -1);
    });

    test('survives an unrelated file in the folder changing', async ({ page }) => {
        await expect.poll(() => taskOffsetFromBodyTop(page, FIRST_INCOMPLETE)).toBeCloseTo(SCROLL_CONTEXT_PX, -1);

        // the other file grows; this story's text is untouched but every merged seq after it shifts
        await setupFolderBoard(page, 'task-framing-other-grown.md');
        await expect(page.locator('[role="rowheader"]', { hasText: 'a note added while the other file sat untouched' })).toHaveCount(1);

        // move the caret onto the story headline and off again: focus transitions re-run the framing, which is where a seq cached from before the renumber gets spent
        await simulateSelectionChanged(page, STORY_DOC, fixtureOffsetOf(STORY_FIXTURE, STORY_HEADLINE));
        await simulateSelectionCleared(page, STORY_DOC);

        await expect.poll(() => taskOffsetFromBodyTop(page, FIRST_INCOMPLETE)).toBeCloseTo(SCROLL_CONTEXT_PX, -1);
    });
});

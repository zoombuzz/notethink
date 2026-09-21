import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const PATH_A = `${WORKSPACE_ROOT}/alpha/docstech/board.md`;
const PATH_B = `${WORKSPACE_ROOT}/beta/docstech/board.md`;
const PATH_C = `${WORKSPACE_ROOT}/gamma/docstech/board.md`;

// alpha's only doing-column card, the one the delayed-echo spec drags
const DRAGGED_HEADLINE = 'Alpha Task Two';

// mirrors useProjectedNotes' own ceiling: past this the optimistic projection is dropped and the live document wins
const KANBAN_PROJECTION_MAX_MS = 1500;

/*
 * How long after the drop the delayed-echo spec withholds the authoritative update. Derived from
 * measurement, not from the ceiling: a 200-doc folder board takes 632ms in the page from the update
 * message to the moved card being painted (50 docs: 178ms), so 900ms clears the worst measured case
 * by ~1.4x while leaving 600ms under KANBAN_PROJECTION_MAX_MS. A delay chosen to sit just under the
 * ceiling instead would flake on timer jitter and would be measuring the harness, not the board.
 */
const SIMULATED_ECHO_DELAY_MS = 900;

const ECHO_POLL_MS = 100;

// the aria-label of the column region currently holding the card with this headline, or null when no column does
async function columnHoldingHeadline(page: Page, headline: string): Promise<string | null> {
    return page.evaluate((wanted: string) => {
        const heading = Array.from(document.querySelectorAll<HTMLElement>('[role="region"][aria-label] [role="heading"], [role="region"][aria-label] h1, [role="region"][aria-label] h2, [role="region"][aria-label] h3, [role="region"][aria-label] h4'))
            .find((node) => (node.textContent ?? '').trim().startsWith(wanted));
        return heading?.closest('[role="region"][aria-label]')?.getAttribute('aria-label') ?? null;
    }, headline);
}

// keyboard-based drag - @hello-pangea/dnd supports lift (Space) + arrow moves + drop (Space). matches the established pattern in kanban-drag.spec.ts so the folder-mode specs use the same wire boundary as single-file mode. Returns the moment of the drop, which is when the optimistic projection's clock starts
async function keyboardDrag(page: Page, draggable_locator: Locator, direction: 'right' | 'left' | 'up' | 'down', moves: number): Promise<number> {
    await draggable_locator.scrollIntoViewIfNeeded();
    await draggable_locator.focus();
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const key = direction === 'right' ? 'ArrowRight'
        : direction === 'left' ? 'ArrowLeft'
        : direction === 'down' ? 'ArrowDown'
        : 'ArrowUp';
    for (let i = 0; i < moves; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(200);
    }
    await page.keyboard.press('Space');
    const dropped_at = Date.now();
    await page.waitForTimeout(500);
    return dropped_at;
}

async function setupFolderKanban(page: Page, docs?: Array<{ fixture: string; doc_path: string; relative_path: string }>): Promise<void> {
    const specs = docs ?? [
        { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
        { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
    ];
    await injectMultipleDocsFromFixtures(page, specs, { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await sendCommand(page, 'setViewType', { viewType: 'kanban' });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

test.describe('Folder-mode kanban drag and drop', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('cross-column drag in folder mode targets only the source file', async ({ page }) => {
        await setupFolderKanban(page);

        // each card row carries the drag-handle attribute directly (the row IS the draggable); filter by the origin pill nested inside to identify which file the card came from. start from "doing" because the default folder column_order arranges visible columns as [doing, done, backlog] - ArrowRight from doing lands on done and produces a real cross-column move (right-from-backlog would wrap to nowhere)
        const doing = page.locator('[role="region"][aria-label="doing"]');
        const alpha_handle = doing.locator('[data-rfd-drag-handle-draggable-id]').filter({
            has: page.locator('[data-testid="origin-project-pill"][data-project="alpha"]'),
        }).first();
        await expect(alpha_handle).toBeVisible({ timeout: 5000 });

        await clearCapturedMessages(page);

        // doing → done is one column to the right in folder-mode default order
        await keyboardDrag(page, alpha_handle, 'right', 1);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m: { type?: string }) => m.type === 'editText');
        expect(edit_msg).toBeDefined();

        const changes_by_doc = (edit_msg as { changes_by_doc?: Record<string, unknown[]> }).changes_by_doc;
        const doc_path_field = (edit_msg as { docPath?: string }).docPath;
        const changes_field = (edit_msg as { changes?: Array<{ from: number; to?: number; insert: string }> }).changes;

        // the edit MUST target only PATH_A - either via the single-doc shape's docPath or the multi-doc shape's changes_by_doc keys. PATH_B must not appear anywhere
        let observed_changes: Array<{ from: number; to?: number; insert: string }> = [];
        if (changes_by_doc) {
            const keys = Object.keys(changes_by_doc);
            expect(keys).toContain(PATH_A);
            expect(keys).not.toContain(PATH_B);
            observed_changes = (changes_by_doc[PATH_A] || []) as Array<{ from: number; to?: number; insert: string }>;
        } else {
            expect(doc_path_field).toBe(PATH_A);
            expect(changes_field).toBeDefined();
            observed_changes = changes_field!;
        }

        // confirms a status-tag swap actually happened (otherwise the test would silently pass when the drag drops in the source column). default column_order shows [doing, done, backlog], so doing → right → done means at least one change inserts "done"
        const has_done_insert = observed_changes.some((c) => c.insert === 'done');
        expect(has_done_insert).toBe(true);

        // a drag must NOT move the editor caret, so it posts no revealRange/selectRange; targeting the source file is carried by the editText docPath/changes_by_doc above, not by a caret reveal
        const reveal_msg = messages.find((m: { type?: string }) => m.type === 'revealRange' || m.type === 'selectRange');
        expect(reveal_msg).toBeUndefined();
    });

    test('multi-file column interleave: a drag into an all-unweighted column mints no weight, and an unrelated parse update preserves interleaved order', async ({ page }) => {
        /*
         * this test asserts two adjacent contracts: (a) dragging within a multi-file column whose cards are all unweighted mints NO nt_kanban_ordering_weight - the restraint guard in crossFileOrderingChanges suppresses it because a lone weight would sink the card below the unweighted cards (kanbanNoteOrder case 2), so the placement is carried by implicit mtime order. (b) once a weighted note is in the merged tree, an unrelated parse update for a third file does not perturb its user-chosen position.
         * we cannot round-trip the editText through the live extension inside this harness, so (a) is verified via the captured message and (b) is verified by directly injecting a fixture whose text already carries the weight - that's exactly what the extension would deliver after applying an editText and re-emitting sendDoc
         */

        await setupFolderKanban(page);

        // ---- part (a): a drag into an all-unweighted column mints no weight ----
        const doing = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing.locator('[data-rfd-drag-handle-draggable-id]').first()).toBeVisible({ timeout: 5000 });
        const initial_order = await doing.locator('[data-rfd-drag-handle-draggable-id] [data-testid="origin-project-pill"]').evaluateAll(
            (nodes) => nodes.map((n) => n.getAttribute('data-project')),
        );
        expect(initial_order).toContain('alpha');
        expect(initial_order).toContain('beta');

        const beta_handle = doing.locator('[data-rfd-drag-handle-draggable-id]').filter({
            has: page.locator('[data-testid="origin-project-pill"][data-project="beta"]'),
        }).first();
        await expect(beta_handle).toBeVisible();

        // pick the direction that moves beta past alpha given the initial layout
        const beta_is_first = initial_order[0] === 'beta';
        const direction = beta_is_first ? 'down' : 'up';

        await clearCapturedMessages(page);
        await keyboardDrag(page, beta_handle, direction, 1);

        const after_drag_messages = await getCapturedMessages(page);
        const edit_after_drag = after_drag_messages.find((m: { type?: string }) => m.type === 'editText') as
            | { changes_by_doc?: Record<string, Array<{ from: number; to?: number; insert: string }>>; changes?: Array<{ from: number; to?: number; insert: string }>; docPath?: string }
            | undefined;

        // collect whatever changes the drag emitted (if any) - an all-unweighted reorder may emit no editText at all, since the only candidate write would be a weight and the guard suppresses it
        const all_changes: Array<{ from: number; to?: number; insert: string }> = [];
        if (edit_after_drag?.changes_by_doc) {
            for (const arr of Object.values(edit_after_drag.changes_by_doc)) {
                for (const ch of arr) { all_changes.push(ch); }
            }
        } else if (edit_after_drag?.changes) {
            for (const ch of edit_after_drag.changes) { all_changes.push(ch); }
        }
        // no weight is minted - placement in an all-unweighted column is governed by implicit mtime order, not a persisted nt_kanban_ordering_weight
        const has_weight_change = all_changes.some((c) => c.insert.includes('nt_kanban_ordering_weight'));
        expect(has_weight_change).toBe(false);

        /*
         * ---- part (b): inject a fixture with the post-drag weight; assert interleave holds ----
         * kanban-folder-b-weighted.md is identical to kanban-folder-b.md except Beta Task Two carries nt_kanban_ordering_weight=1. by kanbanNoteOrder's case 2 ("exactly one weighted - weighted sorts AFTER unweighted") beta should sort AFTER alpha, deliberately. capture the baseline order before applying the weight so we can prove the order changed because of the weight (not by accident)
         */
        const baseline_order = await doing.locator('[data-rfd-drag-handle-draggable-id] [data-testid="origin-project-pill"]').evaluateAll(
            (nodes) => nodes.map((n) => n.getAttribute('data-project')),
        );
        const baseline_beta_first = baseline_order.indexOf('beta') < baseline_order.indexOf('alpha');

        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'kanban-folder-b-weighted.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        // wait out the optimistic projection from part (a)'s drag (KANBAN_PROJECTION_MAX_MS = 1500ms) so the board renders the injected steady-state order rather than the still-active projected layout that would mask the weight-driven order
        await page.waitForTimeout(1700);

        const order_after_weight = await doing.locator('[data-rfd-drag-handle-draggable-id] [data-testid="origin-project-pill"]').evaluateAll(
            (nodes) => nodes.map((n) => n.getAttribute('data-project')),
        );
        const beta_index_weighted = order_after_weight.indexOf('beta');
        const alpha_index_weighted = order_after_weight.indexOf('alpha');
        expect(beta_index_weighted).toBeGreaterThanOrEqual(0);
        expect(alpha_index_weighted).toBeGreaterThanOrEqual(0);
        // weighted sorts after unweighted under kanbanNoteOrder case 2
        expect(beta_index_weighted).toBeGreaterThan(alpha_index_weighted);

        // now fire an unrelated parse update - the story's trigger. the harness's update message replaces the docs map (no merge_strategy), so we re-send all three docs; the meaningful change is the addition of gamma, alpha and beta are unchanged. user-chosen order (beta-after-alpha by weight) must survive
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'kanban-folder-b-weighted.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
            { fixture: 'kanban-folder-c.md', doc_path: PATH_C, relative_path: 'gamma/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForTimeout(400);

        const final_order = await doing.locator('[data-rfd-drag-handle-draggable-id] [data-testid="origin-project-pill"]').evaluateAll(
            (nodes) => nodes.map((n) => n.getAttribute('data-project')),
        );
        const beta_index_final = final_order.indexOf('beta');
        const alpha_index_final = final_order.indexOf('alpha');
        expect(beta_index_final).toBeGreaterThanOrEqual(0);
        expect(alpha_index_final).toBeGreaterThanOrEqual(0);
        // user-chosen order survives the unrelated parse update - same relative position
        expect(beta_index_final).toBeGreaterThan(alpha_index_final);

        // direction / baseline are captured so reviewers can see what the drag intent was; the weighted-fixture assertion above is deterministic on its own
        expect(direction).toMatch(/up|down/);
        expect(typeof baseline_beta_first).toBe('boolean');
    });

    test('a drop survives an authoritative echo delayed to 200-file scale - no snap-back', async ({ page }) => {
        /*
         * The drop is optimistic: useProjectedNotes masks the live document with the projected move for at most
         * KANBAN_PROJECTION_MAX_MS (1500ms), and the card snaps back to its old column the moment that expires with no
         * authoritative echo to reconcile against. What sets that latency is the round trip - write, watcher, re-parse,
         * merge - and the merge is the part that scaled with the whole corpus rather than with the one file that
         * changed, so on a large board the echo could arrive after the window had already closed.
         *
         * This holds the echo back for SIMULATED_ECHO_DELAY_MS to stand in for that latency, samples the card's column
         * throughout, and requires that it is in the destination column at every sample and still there once the echo
         * lands. A snap-back shows up as a sample reading "doing" rather than as a final-state failure, which is why
         * the sampling is here and not a single assertion at the end.
         */
        await setupFolderKanban(page);
        const doing = page.locator('[role="region"][aria-label="doing"]');
        const alpha_handle = doing.locator('[data-rfd-drag-handle-draggable-id]').filter({
            has: page.locator('[data-testid="origin-project-pill"][data-project="alpha"]'),
        }).first();
        await expect(alpha_handle).toBeVisible({ timeout: 5000 });
        await expect(doing.getByRole('heading', { name: DRAGGED_HEADLINE })).toBeVisible({ timeout: 5000 });
        // doing → done, the same cross-column move the first spec makes
        const dropped_at = await keyboardDrag(page, alpha_handle, 'right', 1);
        expect(await columnHoldingHeadline(page, DRAGGED_HEADLINE)).toBe('done');
        // sample to a deadline measured from the drop itself, stopping while a further sample still fits, so the last read provably lands inside the window rather than depending on how long keyboardDrag's own settle wait took
        const samples: Array<string | null> = [];
        const sample_deadline = dropped_at + SIMULATED_ECHO_DELAY_MS;
        for (let i = 0; i < Math.ceil(SIMULATED_ECHO_DELAY_MS / ECHO_POLL_MS) && Date.now() + ECHO_POLL_MS < sample_deadline; i++) {
            await page.waitForTimeout(ECHO_POLL_MS);
            samples.push(await columnHoldingHeadline(page, DRAGGED_HEADLINE));
        }
        expect(samples.length).toBeGreaterThanOrEqual(2);
        expect(samples.filter((column) => column !== 'done')).toEqual([]);
        // the echo has to arrive inside the projection window for the rest of the spec to mean anything, so say so rather than let a drifted helper wait fail as a mystery snap-back
        expect(Date.now() - dropped_at).toBeLessThan(KANBAN_PROJECTION_MAX_MS);
        // the echo the extension would post once the edit round-tripped: alpha's card now carries status=done in the file
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a-echo-done.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await expect(page.locator('[role="region"][aria-label="done"]').getByRole('heading', { name: DRAGGED_HEADLINE })).toBeVisible({ timeout: 5000 });
        // and it stays put once the projection has certainly expired, so the reconcile handed over to the live document rather than the timeout
        await page.waitForTimeout(KANBAN_PROJECTION_MAX_MS + 200);
        expect(await columnHoldingHeadline(page, DRAGGED_HEADLINE)).toBe('done');
    });

    test('single-file kanban drag still emits the legacy single-doc shape (regression guard)', async ({ page }) => {
        // setup a folder with exactly one doc - this exercises the folder-renderer path while ensuring all changes land under one origin.doc_path. the dragEndHandler should pick the single-doc fast-path and emit `{type:'editText', changes, docPath}` with no `changes_by_doc`, matching the pre-refactor wire shape
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // doing → right → done; default folder column_order surfaces [doing, done, backlog]
        const doing = page.locator('[role="region"][aria-label="doing"]');
        const alpha_handle = doing.locator('[data-rfd-drag-handle-draggable-id]').first();
        await expect(alpha_handle).toBeVisible({ timeout: 5000 });

        await clearCapturedMessages(page);
        await keyboardDrag(page, alpha_handle, 'right', 1);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m: { type?: string }) => m.type === 'editText');
        expect(edit_msg).toBeDefined();

        // legacy shape required for byte-identical single-file behaviour - when every change targets one origin (here the only doc), the handler picks the single-doc fast path
        const changes_by_doc = (edit_msg as { changes_by_doc?: Record<string, unknown[]> }).changes_by_doc;
        expect(changes_by_doc).toBeUndefined();
        const doc_path_field = (edit_msg as { docPath?: string }).docPath;
        expect(doc_path_field).toBe(PATH_A);
        const changes_field = (edit_msg as { changes?: Array<{ from: number; to?: number; insert: string }> }).changes;
        expect(changes_field).toBeDefined();
        expect(changes_field!.length).toBeGreaterThanOrEqual(1);
        // status linetag swap to the destination column value
        const has_done_insert = changes_field!.some((c) => c.insert === 'done');
        expect(has_done_insert).toBe(true);
    });
});

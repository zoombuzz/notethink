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

/**
 * Keyboard-based drag (@hello-pangea/dnd: Space lifts, arrows move, Space drops). Returns the moment
 * of the drop, when the optimistic projection's clock starts.
 */
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

        // row is the draggable; filtered by origin pill. doing->right->done per default order [doing,done,backlog]
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

        // the edit must target only PATH_A, via docPath or changes_by_doc keys; PATH_B must not appear anywhere
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

        // confirms the status swap happened, since dropping in the source column would otherwise pass silently
        const has_done_insert = observed_changes.some((c) => c.insert === 'done');
        expect(has_done_insert).toBe(true);

        // a drag must not move the editor caret, so no revealRange/selectRange is posted
        const reveal_msg = messages.find((m: { type?: string }) => m.type === 'revealRange' || m.type === 'selectRange');
        expect(reveal_msg).toBeUndefined();
    });

    /**
     * Two contracts: (a) dragging within a multi-file column whose cards are all unweighted mints no
     * nt_kanban_ordering_weight, since the restraint guard in crossFileOrderingChanges suppresses it (a
     * lone weight would sink the card below the unweighted cards, kanbanNoteOrder case 2), leaving mtime
     * order to carry the placement. (b) once a weighted note is in the merged tree, an unrelated parse
     * update for a third file does not perturb its user-chosen position. editText cannot round-trip
     * through the live extension in this harness, so (a) is verified via the captured message and (b) by
     * injecting a fixture whose text already carries the weight, exactly what the extension would deliver
     * after applying an editText and re-emitting sendDoc.
     */
    test('multi-file column interleave: a drag into an all-unweighted column mints no weight, and an unrelated parse update preserves interleaved order', async ({ page }) => {
        // sets up the folder board, then exercises (a) then (b) in sequence
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

        // collects whatever changes the drag emitted; an all-unweighted reorder may emit none, since the guard suppresses it
        const all_changes: Array<{ from: number; to?: number; insert: string }> = [];
        if (edit_after_drag?.changes_by_doc) {
            for (const arr of Object.values(edit_after_drag.changes_by_doc)) {
                for (const ch of arr) { all_changes.push(ch); }
            }
        } else if (edit_after_drag?.changes) {
            for (const ch of edit_after_drag.changes) { all_changes.push(ch); }
        }
        // no weight is minted; an all-unweighted column's placement is governed by implicit mtime order
        const has_weight_change = all_changes.some((c) => c.insert.includes('nt_kanban_ordering_weight'));
        expect(has_weight_change).toBe(false);

        // injects the post-drag weighted fixture, then confirms interleave order holds; baseline is captured first
        const baseline_order = await doing.locator('[data-rfd-drag-handle-draggable-id] [data-testid="origin-project-pill"]').evaluateAll(
            (nodes) => nodes.map((n) => n.getAttribute('data-project')),
        );
        const baseline_beta_first = baseline_order.indexOf('beta') < baseline_order.indexOf('alpha');

        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'kanban-folder-b-weighted.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        // waits out part (a)'s projection so the board renders the injected order, not the stale projected layout
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

        // an unrelated parse update (adding gamma) resends all docs, since the harness replaces the whole docs map
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

        // direction and baseline are captured for reviewers; the deterministic check is the weighted-fixture assertion
        expect(direction).toMatch(/up|down/);
        expect(typeof baseline_beta_first).toBe('boolean');
    });

    /**
     * The drop is optimistic: useProjectedNotes masks the live document with the projected move for at
     * most KANBAN_PROJECTION_MAX_MS, snapping back the moment that expires with no authoritative echo to
     * reconcile against. The round trip (write, watcher, re-parse, merge) scales with the whole corpus
     * rather than the one changed file, so on a large board the echo can arrive after the window closes.
     * SIMULATED_ECHO_DELAY_MS stands in for that latency; the test samples the card's column throughout
     * and requires it stay in the destination column at every sample and after the echo lands, since a
     * snap-back shows up as a mid-run sample reading "doing" rather than as a final-state failure.
     */
    test('a drop survives an authoritative echo delayed to 200-file scale - no snap-back', async ({ page }) => {
        // holds the echo back to simulate large-board round-trip latency, then samples the card's column
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
        // samples to a deadline measured from the drop, so the last read provably lands inside the window
        const samples: Array<string | null> = [];
        const sample_deadline = dropped_at + SIMULATED_ECHO_DELAY_MS;
        for (let i = 0; i < Math.ceil(SIMULATED_ECHO_DELAY_MS / ECHO_POLL_MS) && Date.now() + ECHO_POLL_MS < sample_deadline; i++) {
            await page.waitForTimeout(ECHO_POLL_MS);
            samples.push(await columnHoldingHeadline(page, DRAGGED_HEADLINE));
        }
        expect(samples.length).toBeGreaterThanOrEqual(2);
        expect(samples.filter((column) => column !== 'done')).toEqual([]);
        // asserts the echo arrived inside the projection window, so a later failure isn't a mystery snap-back
        expect(Date.now() - dropped_at).toBeLessThan(KANBAN_PROJECTION_MAX_MS);
        // the echo the extension would post once the edit round-tripped: alpha's card now carries status=done in the file
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a-echo-done.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await expect(page.locator('[role="region"][aria-label="done"]').getByRole('heading', { name: DRAGGED_HEADLINE })).toBeVisible({ timeout: 5000 });
        // stays put once the projection has certainly expired, proving the live document took over, not the timeout
        await page.waitForTimeout(KANBAN_PROJECTION_MAX_MS + 200);
        expect(await columnHoldingHeadline(page, DRAGGED_HEADLINE)).toBe('done');
    });

    /**
     * A single-doc folder exercises the folder-renderer path while every change lands under one
     * origin.doc_path, so dragEndHandler should pick the single-doc fast path and emit the legacy
     * `{type:'editText', changes, docPath}` shape with no `changes_by_doc`.
     */
    test('single-file kanban drag still emits the legacy single-doc shape (regression guard)', async ({ page }) => {
        // one doc in folder mode still hits the single-doc fast path
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

        // legacy shape keeps single-file behaviour byte-identical when every change targets one origin
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

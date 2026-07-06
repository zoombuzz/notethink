import { test, expect, type Page, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';
import { parse } from '../helpers/parse-markdown';

/*
 * automated reproduction harness for the durable "source column collapses on drag" bug. renders the REAL
 * webview bundle (no VS Code, no cross-iframe focus artifact, so real pointer drags lift reliably here),
 * reproduces the user's drag -> undo -> drag sequence, and measures the DOING column geometry at rest vs
 * mid-lift. a healthy lift keeps the column height and holds a non-zero placeholder; a collapse drops the
 * height / zeros the placeholder and the remaining cards concertina up. no hand-testing in DevTools.
 */

const WORKSPACE_ROOT = '/mnt/workspace/active_development';
const PATH_A = `${WORKSPACE_ROOT}/alpha/docstech/board.md`;
const PATH_B = `${WORKSPACE_ROOT}/beta/docstech/board.md`;
const REL_A = 'alpha/docstech/board.md';
const REL_B = 'beta/docstech/board.md';

function sha16(s: string): string { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }
function fixtureText(fixture: string): string { return fs.readFileSync(path.join(__dirname, '..', 'fixtures', fixture), 'utf-8'); }

async function setupFolderKanban(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: REL_A },
        { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: REL_B },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await sendCommand(page, 'setViewType', { viewType: 'kanban' });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

// re-inject a single doc with given text (mirrors the extension's folder-mode incremental echo: update + merge)
async function reinjectDoc(page: Page, id: string, doc_path: string, relative_path: string, text: string): Promise<void> {
    const mdast = parse(text);
    const hash = sha16(text);
    await page.evaluate((d) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'update',
                partial: { docs: { [d.id]: { id: d.id, path: d.doc_path, relative_path: d.relative_path, text: d.text, hash_sha256: d.hash, content: d.mdast } } },
                merge_strategy: 'merge',
            },
        }));
    }, { id, doc_path, relative_path, text, hash, mdast });
    await page.waitForTimeout(450);
}

function applyChangesToText(text: string, changes: Array<{ from: number; to?: number; insert: string }>): string {
    const sorted = [...changes].sort((a, b) => b.from - a.from);
    let out = text;
    for (const c of sorted) { const to = c.to !== undefined ? c.to : c.from; out = out.slice(0, c.from) + c.insert + out.slice(to); }
    return out;
}

function changesForDoc(edit: Record<string, unknown> | undefined, doc_path: string): Array<{ from: number; to?: number; insert: string }> {
    if (!edit) { return []; }
    const by_doc = edit.changes_by_doc as Record<string, Array<{ from: number; to?: number; insert: string }>> | undefined;
    if (by_doc) { return by_doc[doc_path] || []; }
    const dp = edit.docPath as string | undefined;
    if (dp === undefined || dp === doc_path) { return (edit.changes as Array<{ from: number; to?: number; insert: string }>) || []; }
    return [];
}

// dump the FLIP/dnd DOM state that a passive card move can leave behind and that the next drag trips over
async function dumpFlipState(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-rfd-draggable-id]')] as HTMLElement[];
        const cs = (e: HTMLElement) => getComputedStyle(e);
        return {
            totalCards: cards.length,
            withTransform: cards.filter((e) => cs(e).transform !== 'none').map((e) => ({ id: (e.getAttribute('data-rfd-draggable-id') || '').slice(-18), t: cs(e).transform.slice(0, 22), pos: cs(e).position })),
            animating: cards.filter((e) => typeof e.getAnimations === 'function' && e.getAnimations().length > 0).length,
            fixed: cards.filter((e) => cs(e).position === 'fixed').length,
            placeholders: document.querySelectorAll('[data-rfd-placeholder-context-id]').length,
            flipClasses: cards.filter((e) => [...e.classList].some((c) => /flip|columnEnter|columnExit/i.test(c))).length,
        };
    });
}

async function measureDoing(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => {
        const col = [...document.querySelectorAll('[role="region"]')].find((r) => (r.getAttribute('aria-label') || '').includes('doing'));
        const ph = document.querySelector('[data-rfd-placeholder-context-id]');
        const fixed = [...document.querySelectorAll('[data-rfd-draggable-id]')].filter((e) => getComputedStyle(e).position === 'fixed').length;
        const flow = col ? [...col.querySelectorAll('[data-rfd-draggable-id]')].filter((e) => getComputedStyle(e).position !== 'fixed') : [];
        const tops = flow.map((e) => Math.round(e.getBoundingClientRect().top));
        return {
            colH: col ? Math.round(col.getBoundingClientRect().height) : null,
            phH: ph ? Math.round(ph.getBoundingClientRect().height) : 0,
            clones: fixed,
            flow: flow.length,
            gaps: tops.slice(1).map((t, i) => t - tops[i]),
        };
    });
}

// press-lift a doing card, measure mid-lift, release without dropping elsewhere
async function liftAndMeasure(page: Page, handle: Locator): Promise<{ rest: Record<string, unknown>; lifted: Record<string, unknown> }> {
    const box = await handle.boundingBox();
    if (!box) { throw new Error('no handle box'); }
    const fx = box.x + box.width / 2;
    const fy = box.y + box.height / 2;
    const rest = await measureDoing(page);
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    await page.mouse.move(fx, fy + 8, { steps: 5 });
    await page.waitForTimeout(200);
    await page.mouse.move(fx + 4, fy + 20, { steps: 5 });
    await page.waitForTimeout(150);
    const lifted = await measureDoing(page);
    await page.mouse.up();
    await page.waitForTimeout(300);
    return { rest, lifted };
}

// full pointer drag from a card handle onto a destination column region, then drop
async function fullDrag(page: Page, handle: Locator, dest: Locator): Promise<void> {
    const sb = await handle.boundingBox();
    const db = await dest.boundingBox();
    if (!sb || !db) { throw new Error('no box for fullDrag'); }
    const fx = sb.x + sb.width / 2, fy = sb.y + sb.height / 2;
    const tx = db.x + db.width / 2, ty = db.y + 60;
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    await page.mouse.move(fx, fy + 8, { steps: 5 });
    await page.waitForTimeout(150);
    await page.mouse.move(tx, ty, { steps: 25 });
    await page.waitForTimeout(150);
    await page.mouse.move(tx, ty, { steps: 5 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(450);
}

test.describe('kanban drag collapse repro', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('ORGANIC: two drag->undo cycles, then measure a lift', async ({ page }) => {
        await setupFolderKanban(page);
        const A0 = fixtureText('kanban-folder-a.md');
        const idA = sha16(PATH_A);
        const doing = page.locator('[role="region"][aria-label="doing"]');
        const done = page.locator('[role="region"][aria-label="done"]');

        for (let cycle = 1; cycle <= 2; cycle++) {
            await clearCapturedMessages(page);
            const handle = doing.locator('[data-rfd-drag-handle-draggable-id]').filter({ hasText: 'Alpha Task Two' }).first();
            await fullDrag(page, handle, done);
            const msgs = await getCapturedMessages(page);
            const edit = msgs.find((m) => m.type === 'editText') as Record<string, unknown> | undefined;
            // every drag - including ones that follow a passive card glide - must register with dnd and post an edit. before the fill:'backwards' fix, cycle 2 posted nothing (dnd stalled on a filling FLIP transform)
            expect(edit, `cycle ${cycle} drag must post editText`).toBeDefined();
            const changesA = changesForDoc(edit, PATH_A);
            const newA = applyChangesToText(A0, changesA);
            // reconcile: extension echoes the written doc (card now in done), then undo: editor Ctrl+Z reverts the file (card glides back)
            await reinjectDoc(page, idA, PATH_A, REL_A, newA);
            await reinjectDoc(page, idA, PATH_A, REL_A, A0);
            // no finished FLIP animation may keep owning a card's transform after a glide - that is what stalls the next drag
            const flip = await dumpFlipState(page) as { withTransform: unknown[]; fixed: number };
            expect(flip.withTransform, `cycle ${cycle}: a finished FLIP move must not hold a transform`).toHaveLength(0);
            expect(flip.fixed, `cycle ${cycle}: no stuck drag clone`).toBe(0);
        }

        // after two full cycles, a fresh lift must still be healthy: the source column holds its height and dnd keeps a real placeholder
        const handle = doing.locator('[data-rfd-drag-handle-draggable-id]').filter({ hasText: 'Alpha Task Two' }).first();
        const { rest, lifted } = await liftAndMeasure(page, handle) as { rest: { colH: number }; lifted: { colH: number; phH: number; clones: number } };
        expect(lifted.clones, 'exactly one clone lifts').toBe(1);
        expect(lifted.phH, 'placeholder holds the lifted slot').toBeGreaterThan(40);
        expect(Math.abs(lifted.colH - rest.colH), 'source column does not collapse or inflate during the lift').toBeLessThan(20);
    });
});

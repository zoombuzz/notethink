/*
 * self-sufficient drag reproduction + regression recorder for NoteThink.
 *
 * why this exists: the playwright/harness specs mount the webview bundle in a BARE page, which does NOT
 * reproduce the real VS Code webview - clean AND post-move drags both pass there, so those specs stay green
 * while the real drag breaks. this recorder drives the REAL extension + REAL webview via @vscode/test-web,
 * does REAL pointer drags, and logs LANDED / DID NOT LAND per drag. the bug it targets (per the notegit demo
 * findings): drags land from a clean board, but after a TEXT EDIT that glides a card between columns, dnd
 * goes out of sync and the next drag fails. so the sequence is: baseline drag, then edit-a-status, then drag.
 *
 * run: node sh/repro-drag.mjs            (headless; prints results, exits non-zero if a drag did NOT land)
 *      node sh/repro-drag.mjs --headed   (watch it)
 * needs: pnpm run build first (serves client/webview/dist). resolves Playwright from the repo.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const PORT = Number(process.env.REPRO_PORT || 3019);
const HEADED = process.argv.includes('--headed');
const SHOT_DIR = join(tmpdir(), 'notethink-repro-drag');
const log = (...a) => console.log('[repro]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// clean multi-file folder board: Doing [A1,A2,B1], Done [B2], Backlog [Mover]. "Mover" is the card a text edit glides.
// folder mode aggregates the clicked file's CONTAINING folder, so the story files live in a `board/` subfolder
function writeFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'nt-board-'));
    const board = join(dir, 'board');
    mkdirSync(board);
    writeFileSync(join(board, 'one.md'), `# Todo\n\n### A1 [](?status=doing)\n\n+ [ ] a1\n\n### A2 [](?status=doing)\n\n+ [ ] a2\n`);
    writeFileSync(join(board, 'two.md'), `# Todo\n\n### B1 [](?status=doing)\n\n+ [ ] b1\n\n### B2 [](?status=done)\n\n+ [ ] b2\n\n### Mover [](?status=backlog)\n\n+ [ ] mover\n`);
    return dir;
}

async function startServer(folder) {
    const proc = spawn('pnpm', ['exec', 'vscode-test-web', '--browserType=none', '--extensionDevelopmentPath=.', `--port=${PORT}`, folder], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('vscode-test-web did not start in time')), 90000);
        const onData = (b) => { if (b.toString().includes('Listening on')) { clearTimeout(to); resolve(); } };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('exit', (c) => { clearTimeout(to); reject(new Error('vscode-test-web exited ' + c)); });
    });
    return proc;
}

// find the webview content frame (the one holding the notethink React #root)
async function contentFrame(page) {
    for (const f of page.frames()) {
        if (await f.evaluate(() => !!document.querySelector('#root')).catch(() => false)) { return f; }
    }
    return null;
}

async function columnCounts(cf) {
    return cf.evaluate(() => {
        const col = (n) => document.querySelector(`[role="region"][aria-label="${n}"]`);
        const cnt = (c) => (c ? c.querySelectorAll('[data-rfd-drag-handle-draggable-id]').length : 0);
        return { doing: cnt(col('doing')), done: cnt(col('done')), backlog: cnt(col('backlog')) };
    });
}

// open one.md, reopen with the NoteThink custom editor, switch to Folder + Kanban
async function openBoard(page) {
    await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
    await sleep(4000);
    // expand the board/ subfolder, then open one.md
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'board' }).first().click();
    await page.keyboard.press('ArrowRight');
    await sleep(1200);
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'one.md' }).first().dblclick();
    await sleep(2500);
    await page.keyboard.press('Control+Shift+P'); await sleep(1000);
    await page.keyboard.type('Reopen Editor With'); await sleep(1300);
    await page.locator('.quick-input-list .monaco-list-row', { hasText: 'Reopen Editor With...' }).first().click(); await sleep(1500);
    await page.locator('.quick-input-list .monaco-list-row', { hasText: 'NoteThink' }).first().click(); await sleep(6000);
    const cf = await contentFrame(page);
    if (!cf) throw new Error('no content frame after opening board');
    await cf.locator('select').nth(0).selectOption({ label: 'Folder' }).catch(() => {}); await sleep(2500);
    await cf.locator('select').nth(1).selectOption({ label: 'Kanban' }).catch(() => {}); await sleep(3000);
    await page.waitForTimeout(500);
    const diag = await cf.evaluate(() => ({
        selects: Array.from(document.querySelectorAll('select')).map((s) => s.value),
        folderMode: !!document.querySelector('[data-folder-mode="true"]'),
        totalCards: document.querySelectorAll('[data-rfd-drag-handle-draggable-id]').length,
        columns: Array.from(document.querySelectorAll('[role="columnheader"]')).map((c) => (c.textContent || '').trim()),
    }));
    log('board diag', JSON.stringify(diag));
    return cf;
}

// one real pointer drag of the first card in sourceCol to targetCol; returns whether the counts moved as expected
async function realDrag(page, cf, sourceCol, targetCol, label, cardName) {
    // refocus the board with a raw click on a column header (an editor edit leaves focus in the text editor and dnd swallows the drag)
    const hb = await cf.locator(`[role="region"][aria-label="${sourceCol}"]`).boundingBox().catch(() => null);
    if (hb) { await page.mouse.click(hb.x + hb.width / 2, hb.y + 10); await sleep(700); }
    const hasFocus = await cf.evaluate(() => document.hasFocus());
    const sourceRegionH = await cf.evaluate((col) => { const r = document.querySelector(`[role="region"][aria-label="${col}"]`); return r ? Math.round(r.getBoundingClientRect().height) : null; }, sourceCol);
    const before = await columnCounts(cf);
    const src = cardName
        ? cf.locator(`[role="region"][aria-label="${sourceCol}"] [role="row"]`).filter({ hasText: cardName }).first()
        : cf.locator(`[role="region"][aria-label="${sourceCol}"] [data-rfd-drag-handle-draggable-id]`).first();
    const tgt = cf.locator(`[role="region"][aria-label="${targetCol}"]`);
    const cb = await src.boundingBox().catch(() => null);
    const tb = await tgt.boundingBox().catch(() => null);
    if (!cb || !tb) { log(`  ${label}: NO BOX`); return false; }
    const sx = cb.x + cb.width / 2, sy = cb.y + 14;
    const tx = tb.x + tb.width / 2, ty = tb.y + 130;
    await page.mouse.move(sx, sy); await sleep(200);
    await page.mouse.down(); await sleep(220);
    for (let i = 1; i <= 6; i++) { await page.mouse.move(sx, sy + i * 4, { steps: 2 }); await sleep(45); }
    const lifted = await cf.evaluate(() => Array.from(document.querySelectorAll('[data-rfd-draggable-id]')).filter((el) => getComputedStyle(el).position === 'fixed').length);
    // geometry probe: during the lift, does the SOURCE column keep its height (placeholder holding the slot) or collapse/concertina?
    const geom = await cf.evaluate((col) => {
        const region = document.querySelector(`[role="region"][aria-label="${col}"]`);
        const ph = document.querySelector('[data-rfd-placeholder-context-id]');
        const cards = region ? Array.from(region.querySelectorAll('[data-rfd-draggable-id]')).filter((el) => getComputedStyle(el).position !== 'fixed') : [];
        const tops = cards.map((el) => Math.round(el.getBoundingClientRect().top));
        return {
            regionH: region ? Math.round(region.getBoundingClientRect().height) : null,
            placeholderH: ph ? Math.round(ph.getBoundingClientRect().height) : 0,
            flowCards: cards.length,
            gaps: tops.slice(1).map((t, i) => t - tops[i]),
        };
    }, sourceCol);
    log(`    [geom ${label}] beforeH=${sourceRegionH} duringH=${geom.regionH} placeholderH=${geom.placeholderH} flowCards=${geom.flowCards} gaps=${JSON.stringify(geom.gaps)}`);
    const N = 24;
    for (let i = 1; i <= N; i++) { const t = i / N; await page.mouse.move(sx + (tx - sx) * t, sy + (ty - sy) * t, { steps: 2 }); await sleep(28); }
    await sleep(400); await page.mouse.up(); await sleep(1800);
    const after = await columnCounts(cf);
    const landed = after[targetCol] === before[targetCol] + 1 && after[sourceCol] === before[sourceCol] - 1;
    log(`  ${label}: iframeHasFocus=${hasFocus} lifted-clone=${lifted}  ${JSON.stringify(before)} -> ${JSON.stringify(after)}  ==>  ${landed ? 'LANDED' : 'DID NOT LAND'}`);
    return landed;
}

// open a file's source as text to the SIDE via the explorer context menu (Go-to-File is not indexed in vscode-test-web),
// keeping the board visible so it can glide when the source changes
async function openSourceToSide(page, filename) {
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: filename }).first().click({ button: 'right' }); await sleep(700);
    await page.locator('.monaco-menu .action-label', { hasText: 'Open to the Side' }).first().click().catch(() => {});
    await sleep(2500);
}

// undo the last edit in the side text editor: reverts the drag's status change so the card glides back to its original column
async function undoInEditor(page) {
    await page.locator('.monaco-editor').last().click(); await sleep(500);
    await page.keyboard.press('Control+Z'); await sleep(2800);
}

async function main() {
    rmSync(SHOT_DIR, { recursive: true, force: true });
    const folder = writeFixture();
    log('fixture', folder, '-> serving on', PORT);
    const server = await startServer(folder);
    let browser;
    let failures = 0;
    try {
        browser = await chromium.launch({ headless: !HEADED });
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: SHOT_DIR, size: { width: 1600, height: 1000 } } });
        const page = await context.newPage();
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
        const cf = await openBoard(page);
        const cols = await columnCounts(cf);
        log('board ready', JSON.stringify(cols));
        if (cols.doing < 2) throw new Error('board did not render the expected columns: ' + JSON.stringify(cols));

        // open the source of the card we will drag (two.md), so we can undo the drag's status change from the editor
        await openSourceToSide(page, 'two.md');

        // 1. BASELINE: drag B1 (from two.md) doing -> done should land
        if (!(await realDrag(page, cf, 'doing', 'done', 'BASELINE drag B1', 'B1'))) failures++;

        // 2. UNDO in the text editor: reverts B1's status so B1 glides done -> doing (the exact user-reported trigger)
        log('undo in editor (reverts the drag; B1 glides done -> doing)');
        const beforeUndo = await columnCounts(cf);
        await undoInEditor(page);
        const afterUndo = await columnCounts(cf);
        const reverted = afterUndo.doing > beforeUndo.doing && afterUndo.done < beforeUndo.done;
        log('after undo', JSON.stringify(afterUndo), reverted ? '(B1 glided back to doing)' : 'WARNING: undo did not revert the card - not a valid trigger');

        // diagnostic: what state is the board left in after the undo-glide, that stops the next drag lifting?
        const diag = await cf.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('[data-rfd-draggable-id]'));
            const cs = (el) => getComputedStyle(el);
            return {
                cards: cards.length,
                handles: document.querySelectorAll('[data-rfd-drag-handle-draggable-id]').length,
                withTransform: cards.filter((el) => cs(el).transform !== 'none').map((el) => ({ id: el.getAttribute('data-rfd-draggable-id'), transform: cs(el).transform.slice(0, 30), pos: cs(el).position })),
                stuckFixed: cards.filter((el) => cs(el).position === 'fixed').length,
                animating: cards.filter((el) => typeof el.getAnimations === 'function' && el.getAnimations().length > 0).length,
                flipRoot: !!document.querySelector('[data-flip-root]'),
            };
        });
        log('post-undo diag', JSON.stringify(diag));
        // where is focus after the undo? dnd's mouse sensor lives in the webview iframe; if focus/hasFocus is on the editor, the sensor may never see the mousedown
        const topFocus = await page.evaluate(() => (document.activeElement ? document.activeElement.tagName + '.' + (document.activeElement.className || '').toString().slice(0, 25) : 'none'));
        const iframeFocus = await cf.evaluate(() => ({ hasFocus: document.hasFocus(), active: document.activeElement ? document.activeElement.tagName + '.' + (document.activeElement.className || '').toString().slice(0, 25) : 'none' }));
        log('focus after undo: top=', topFocus, 'iframe=', JSON.stringify(iframeFocus));
        /*
         * smoking gun: after a Monaco edit the webview iframe has hasFocus=false, so @hello-pangea/dnd's mouse sensor
         * never sees the mousedown and the next drag never starts. (a from-inside window.focus() DOES flip hasFocus
         * true, confirming focus is reclaimable - but it detaches/recreates the webview iframe, so a real fix must
         * reclaim focus more gently, on the board's own pointer interaction, not by force.)
         */
        // GENTLE-FOCUS probe: does focusing an existing board ELEMENT restore hasFocus WITHOUT detaching the frame? if so that is the fix shape.
        if (process.env.REPRO_ELFOCUS === '1') {
            const res = await cf.evaluate(() => {
                const el = document.querySelector('button, [tabindex], a[href], input');
                if (el && typeof el.focus === 'function') { el.focus(); }
                return { picked: el ? el.tagName + '.' + (el.className || '').toString().slice(0, 20) : 'none' };
            }).catch((e) => ({ err: String(e).slice(0, 60) }));
            await sleep(500);
            const state = await cf.evaluate(() => document.hasFocus()).catch((e) => 'DETACHED:' + String(e).slice(0, 40));
            log('ELFOCUS focused', JSON.stringify(res), '-> hasFocus =', state);
        }

        // 3. POST-UNDO drags: A1 did NOT glide (only shifted), B1 remounted done->doing. Test both to localise the break.
        if (!(await realDrag(page, cf, 'doing', 'done', 'POST-UNDO drag A1 (did not glide)', 'A1'))) failures++;
        if (!(await realDrag(page, cf, 'doing', 'done', 'POST-UNDO drag B1 (glided)', 'B1'))) failures++;

        await page.screenshot({ path: join(SHOT_DIR, 'final.png') });
        await context.close();
    } finally {
        if (browser) await browser.close();
        server.kill();
        rmSync(folder, { recursive: true, force: true });
    }
    log('video + screenshot in', SHOT_DIR);
    if (failures > 0) { log(`RESULT: ${failures} drag(s) DID NOT LAND - NoteThink drag bug reproduced`); process.exit(1); }
    log('RESULT: all drags LANDED');
}

main().catch((e) => { console.error('[repro] ERROR', e); process.exit(2); });

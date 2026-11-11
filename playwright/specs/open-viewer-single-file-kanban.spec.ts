import { test, expect, type Frame, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixturePath } from '../helpers/fixtures';

/**
 * End-to-end coverage for "a single file tagged nt_view=kanban opens as a board through Open Viewer".
 *
 * Unlike the harness specs, which inject a selectionChanged, this drives a real VS Code web host
 * (@vscode/test-web serving the built extension): open the file in a workspace that holds sibling
 * files, run NoteThink: Open Viewer, and read the view type the webview resolved. Open Viewer lands in
 * the same group as the source, so no editor is visible and the host sends no caret; the file's own
 * H1 nt_view must still pick the board. The siblings are there to prove they never outvote it.
 */
const REPO_ROOT = resolve(__dirname, '../..');
const BOARD_FILE = 'board.md';
const SIBLING_FIXTURES = ['folder-a.md', 'folder-b.md', 'basic.md', 'nested.md'];

function freePort(): Promise<number> {
    return new Promise((resolve_port, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, () => {
            const { port } = server.address() as { port: number };
            server.close(() => resolve_port(port));
        });
    });
}

async function waitForServer(url: string): Promise<void> {
    await expect.poll(async () => {
        try { return (await fetch(url)).ok; } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
}

async function resolvedViewType(page: Page): Promise<{ type: string; columns: number } | undefined> {
    for (const frame of page.frames() as Frame[]) {
        const result = await frame.evaluate(() => {
            const view = document.querySelector('[data-auto-selected-viewtype]');
            if (!view) { return undefined; }
            return { type: view.getAttribute('data-auto-selected-viewtype') ?? '', columns: document.querySelectorAll('[role="columnheader"]').length };
        }).catch(() => undefined);
        if (result) { return result; }
    }
    return undefined;
}

test.describe('Open Viewer on a single-file kanban in a multi-file workspace', () => {
    test.describe.configure({ retries: 0 });
    let workspace: string;
    let server: ChildProcess;

    test.beforeAll(() => {
        workspace = mkdtempSync(join(tmpdir(), 'notethink-open-viewer-'));
        copyFileSync(fixturePath('kanban-nested.md'), join(workspace, BOARD_FILE));
        for (const sibling of SIBLING_FIXTURES) { copyFileSync(fixturePath(sibling), join(workspace, sibling)); }
    });

    test.afterAll(() => {
        if (server?.pid) { try { process.kill(-server.pid); } catch { /* already gone */ } }
        rmSync(workspace, { recursive: true, force: true });
    });

    test('resolves Auto (Kanban) and draws columns, not Auto (Document)', async ({ page }) => {
        test.setTimeout(180_000);
        const port = await freePort();
        server = spawn('pnpm', ['-C', REPO_ROOT, 'exec', 'vscode-test-web', '--browser=none', `--port=${port}`, `--extensionDevelopmentPath=${REPO_ROOT}`, workspace], { detached: true, stdio: 'ignore' });
        await waitForServer(`http://localhost:${port}/`);
        await page.goto(`http://localhost:${port}/`);
        // the explorer lists the workspace once the workbench has booted
        const board_entry = page.getByText(BOARD_FILE, { exact: true }).first();
        await expect(board_entry).toBeVisible({ timeout: 60_000 });
        await board_entry.dblclick();
        await expect(page.getByRole('tab', { name: BOARD_FILE })).toBeVisible();
        await page.keyboard.press('F1');
        await page.keyboard.type('NoteThink: Open Viewer');
        await page.getByRole('option', { name: /NoteThink: Open Viewer/ }).first().waitFor();
        await page.keyboard.press('Enter');
        await expect.poll(() => resolvedViewType(page), { timeout: 60_000 }).toBeDefined();
        // the host's caret and parse messages land after the first paint, so the settled view is the one that counts
        await page.waitForTimeout(8_000);
        const resolved = await resolvedViewType(page);
        expect(resolved?.type).toBe('kanban');
        expect(resolved?.columns).toBeGreaterThan(0);
    });
});

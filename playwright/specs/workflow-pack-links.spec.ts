import { test, expect, type Frame, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * End-to-end coverage for the chief-of-staff workflow pack's board.
 *
 * Copies the pack into a workspace served by a real VS Code web host (@vscode/test-web with the built
 * extension), opens its todo.md in the NoteThink viewer, and follows every markdown link on the board.
 * Each link must open its target in the viewer, shown by the target's own title.
 */
const REPO_ROOT = resolve(__dirname, '../..');
const PACK_DIR = join(REPO_ROOT, 'workflows', 'chief-of-staff');

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

// the webview lives in a nested iframe, so each frame is asked in turn for its settings button
async function viewerFrame(page: Page): Promise<Frame | undefined> {
    for (const frame of page.frames()) {
        const found = await frame.getByTestId('view-settings-button').count().catch(() => 0);
        if (found > 0) { return frame; }
    }
    return undefined;
}

// the board's markdown link targets, with the first level-one heading of each target as its expected title
function boardLinks(): Array<{ href: string; title: string }> {
    const board = readFileSync(join(PACK_DIR, 'todo.md'), 'utf8');
    const hrefs = [...new Set([...board.matchAll(/\]\(([^)?#]+\.md)\)/g)].map((match) => match[1]))];
    return hrefs.map((href) => {
        const heading = /^# (.+)$/m.exec(readFileSync(join(PACK_DIR, href), 'utf8'));
        return { href, title: heading ? heading[1] : href };
    });
}

async function runCommand(page: Page, command: string): Promise<void> {
    await page.keyboard.press('F1');
    await page.keyboard.type(command);
    await page.getByRole('option', { name: command }).first().waitFor();
    await page.keyboard.press('Enter');
}

// each pass starts from no open editors, so a stale viewer panel from the last link cannot answer for this one
async function showBoard(page: Page): Promise<Frame> {
    await runCommand(page, 'View: Close All Editors');
    await page.getByText('todo.md', { exact: true }).first().click();
    await runCommand(page, 'NoteThink: Open Viewer');
    await expect.poll(async () => (await viewerFrame(page))?.getByText('Install the skills').count(), { timeout: 60_000 }).toBeGreaterThan(0);
    return (await viewerFrame(page)) as Frame;
}

test.describe('Chief-of-staff pack board on a real host', () => {
    test.describe.configure({ retries: 0 });
    let workspace: string;
    let server: ChildProcess;

    test.beforeAll(() => {
        workspace = mkdtempSync(join(tmpdir(), 'notethink-pack-links-'));
        cpSync(PACK_DIR, workspace, { recursive: true });
    });

    test.afterAll(() => {
        if (server?.pid) { try { process.kill(-server.pid); } catch { /* already gone */ } }
        rmSync(workspace, { recursive: true, force: true });
    });

    test('every board link opens its markdown in the viewer', async ({ page }) => {
        test.setTimeout(240_000);
        const links = boardLinks();
        expect(links.length).toBeGreaterThanOrEqual(4);
        const port = await freePort();
        server = spawn('pnpm', ['-C', REPO_ROOT, 'exec', 'vscode-test-web', '--browser=none', `--port=${port}`, `--extensionDevelopmentPath=${REPO_ROOT}`, workspace], { detached: true, stdio: 'ignore' });
        await waitForServer(`http://localhost:${port}/`);
        await page.goto(`http://localhost:${port}/`);
        await expect(page.getByText('todo.md', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
        for (const link of links) {
            const board = await showBoard(page);
            await expect(board.getByText('Ask what to work on next').first()).toBeVisible();
            await board.locator(`a[href="${link.href}"]`).first().click({ timeout: 15_000 });
            await expect.poll(async () => (await viewerFrame(page))?.getByText(link.title, { exact: true }).count(), { timeout: 30_000, message: `${link.href} should open in the viewer` }).toBeGreaterThan(0);
        }
    });
});

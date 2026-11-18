import { test, expect, type Frame, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * End-to-end coverage for "the build and ship lines come from the board on disk alone".
 *
 * Drives a real VS Code web host (@vscode/test-web serving the built extension) over a generated
 * workspace holding two users' `docstech/users/<name>/todo.md` boards, one story handed to a coordinator
 * (`sent=`), one not, and one at `code-review`, and no agent registry, coordinator file or ready file
 * anywhere. A web host has no agent home at all, so the analyser reports itself unavailable; the lines
 * must still arrive, from the board files the extension host reads, in the kanban view and the document
 * view. A snapshot posted by hand cannot prove this, because it supplies the very data whose source is
 * in question.
 */
const REPO_ROOT = resolve(__dirname, '../..');
const STORY_NAMES = ['Sent story', 'Unsent story', 'Review story'];

function board(view: string): string {
    return [
        `# Todo [](?nt_view=${view})`,
        '',
        '',
        '### Sent story [](?id=sent-story&sent=go-1)',
        '',
        '+ [ ] a task',
        '',
        '',
        '### Unsent story [](?id=unsent-story)',
        '',
        '+ [ ] a task',
        '',
        '',
        '### Review story [](?id=review-story&status=code-review)',
        '',
        '+ [X] a task',
        '',
    ].join('\n');
}

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

// the webview lives in a nested iframe, so each frame is asked in turn for the element
async function webviewFrame(page: Page, test_id: string): Promise<Frame | undefined> {
    for (const frame of page.frames()) {
        const found = await frame.locator(`[data-testid="${test_id}"]`).count().catch(() => 0);
        if (found > 0) { return frame; }
    }
    return undefined;
}

async function openBoardInViewer(page: Page, port: number, user: string): Promise<void> {
    await page.goto(`http://localhost:${port}/`);
    // the explorer lists the workspace once the workbench has booted; single-child folders are shown compacted
    await expect(page.getByText('docstech', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByText('docstech', { exact: false }).first().click();
    const user_row = page.getByText(user, { exact: true }).first();
    await expect(user_row).toBeVisible({ timeout: 30_000 });
    await user_row.click();
    await page.getByText('todo.md', { exact: true }).first().dblclick();
    await expect(page.getByRole('tab', { name: 'todo.md' })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('F1');
    await page.keyboard.type('NoteThink: Open Viewer');
    await page.getByRole('option', { name: /NoteThink: Open Viewer/ }).first().waitFor();
    await page.keyboard.press('Enter');
}

// what the frame holds in document order: `lines:<kinds>` for a line group and a story's name for its heading
async function sequenceIn(frame: Frame): Promise<string[]> {
    return frame.evaluate(names => {
        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-board-lines], [data-mdast-type="heading"]'))) {
            if (el.hasAttribute('data-board-lines')) { found.push(`lines:${el.getAttribute('data-board-lines')!.replace(' ', '+')}`); continue; }
            const text = (el.textContent ?? '').trimStart();
            const name = names.find(candidate => text.startsWith(candidate));
            if (name) { found.push(name); }
        }
        return found;
    }, STORY_NAMES);
}

test.describe('Build and ship lines on a real extension host with a board on disk and no registry', () => {
    test.describe.configure({ retries: 0 });
    let workspace: string;
    let server: ChildProcess;
    let port: number;

    test.beforeAll(async () => {
        workspace = mkdtempSync(join(tmpdir(), 'notethink-board-lines-'));
        for (const [user, view] of [['kanbanuser', 'kanban'], ['docuser', 'document']]) {
            const dir = join(workspace, 'docstech', 'users', user);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'todo.md'), board(view));
        }
        port = await freePort();
        server = spawn('pnpm', ['-C', REPO_ROOT, 'exec', 'vscode-test-web', '--browser=none', `--port=${port}`, `--extensionDevelopmentPath=${REPO_ROOT}`, workspace], { detached: true, stdio: 'ignore' });
        await waitForServer(`http://localhost:${port}/`);
    });

    test.afterAll(() => {
        if (server?.pid) { try { process.kill(-server.pid); } catch { /* already gone */ } }
        rmSync(workspace, { recursive: true, force: true });
    });

    test('the document view draws the solid build line after the sent story and the dashed ship line after the review story', async ({ page }) => {
        test.setTimeout(240_000);
        await openBoardInViewer(page, port, 'docuser');
        await expect.poll(() => webviewFrame(page, 'board-line-build'), { timeout: 90_000 }).toBeDefined();
        const frame = (await webviewFrame(page, 'board-line-build')) as Frame;
        await expect(frame.getByTestId('board-line-build')).toHaveCount(1);
        await expect(frame.getByTestId('board-line-ship')).toHaveCount(1);
        await expect(frame.getByTestId('board-line-build')).toHaveCSS('border-top-style', 'solid');
        await expect(frame.getByTestId('board-line-ship')).toHaveCSS('border-top-style', 'dashed');
        await expect.poll(() => sequenceIn(frame)).toEqual(['Sent story', 'lines:build', 'Unsent story', 'Review story', 'lines:ship']);
    });

    test('the kanban view draws both lines in each column, placed by the order of the board file', async ({ page }) => {
        test.setTimeout(240_000);
        await openBoardInViewer(page, port, 'kanbanuser');
        await expect.poll(() => webviewFrame(page, 'board-line-build'), { timeout: 90_000 }).toBeDefined();
        const frame = (await webviewFrame(page, 'board-line-build')) as Frame;
        await expect(frame.locator('[role="columnheader"]').first()).toBeVisible();
        await expect(frame.getByTestId('board-line-build').first()).toHaveCSS('border-top-style', 'solid');
        await expect(frame.getByTestId('board-line-ship').first()).toHaveCSS('border-top-style', 'dashed');
        // each column draws the lines between its own cards, so the code-review column opens with the build line
        await expect.poll(() => sequenceIn(frame)).toEqual(['Sent story', 'lines:build', 'Unsent story', 'lines:ship', 'lines:build', 'Review story', 'lines:ship']);
    });
});

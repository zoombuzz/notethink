import { test, expect, type Frame, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * End-to-end coverage for "typing an Include filter ends on the newest pattern's result".
 *
 * Drives a real VS Code web host (@vscode/test-web serving the built extension) over a generated
 * workspace of a couple of thousand markdown files, 22 of which are todo.md / done.md. Open Viewer
 * lands in folder mode at the workspace root; the Include filter is then typed in steps, each one
 * debounced into its own scan, the way a person types. The settled board must hold the stories of
 * the 22 files the final pattern matches, whichever scan finished last.
 */
const REPO_ROOT = resolve(__dirname, '../..');
const FILLER_DIRS = 22;
const FILLER_FILES_PER_DIR = 100;
const STORY_PROJECTS = 11;

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

function buildWorkspace(root: string): void {
    for (let dir_index = 0; dir_index < FILLER_DIRS; dir_index++) {
        const dir = join(root, 'area', `part-${dir_index}`);
        mkdirSync(dir, { recursive: true });
        for (let file_index = 0; file_index < FILLER_FILES_PER_DIR; file_index++) {
            writeFileSync(join(dir, `note-${file_index}.md`), `# Note ${dir_index}-${file_index}\n\nplain prose, no stories here\n`);
        }
    }
    for (let project_index = 0; project_index < STORY_PROJECTS; project_index++) {
        const dir = join(root, `project-${project_index}`, 'docstech');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'todo.md'), `# Todo\n\n\n### Open story ${project_index}\n\n+ [ ] a task\n`);
        writeFileSync(join(dir, 'done.md'), `# Done\n\n\n### Shipped story ${project_index}\n\n+ [X] a task\n`);
    }
}

test.describe('Typing an Include filter in a large workspace on a real host', () => {
    test.describe.configure({ retries: 0 });
    let workspace: string;
    let server: ChildProcess;

    test.beforeAll(() => {
        workspace = mkdtempSync(join(tmpdir(), 'notethink-latest-scan-'));
        buildWorkspace(workspace);
    });

    test.afterAll(() => {
        if (server?.pid) { try { process.kill(-server.pid); } catch { /* already gone */ } }
        rmSync(workspace, { recursive: true, force: true });
    });

    test('settles on the stories of every file the final pattern matches', async ({ page }) => {
        test.setTimeout(240_000);
        const port = await freePort();
        server = spawn('pnpm', ['-C', REPO_ROOT, 'exec', 'vscode-test-web', '--browser=none', `--port=${port}`, `--extensionDevelopmentPath=${REPO_ROOT}`, workspace], { detached: true, stdio: 'ignore' });
        await waitForServer(`http://localhost:${port}/`);
        await page.goto(`http://localhost:${port}/`);
        await expect(page.getByText('project-0', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
        await page.keyboard.press('F1');
        await page.keyboard.type('NoteThink: Open Viewer');
        await page.getByRole('option', { name: /NoteThink: Open Viewer/ }).first().waitFor();
        await page.keyboard.press('Enter');
        await expect.poll(() => webviewFrame(page, 'breadcrumb-file-count'), { timeout: 90_000 }).toBeDefined();
        const frame = (await webviewFrame(page, 'breadcrumb-file-count')) as Frame;
        // the default **/*.md scan settles first, so the filter edits below start from a loaded board
        await expect(frame.getByTestId('breadcrumb-file-count')).not.toContainText('scanning', { timeout: 90_000 });
        // the unfiltered scan is capped, so the starting label proves the workspace really is large
        await expect(frame.getByTestId('breadcrumb-file-count')).toContainText('of 2222 files)');
        await frame.getByTestId('breadcrumb-file-count').click();
        const include = frame.getByTestId('files-drawer-include');
        await include.fill('');
        // each pause outlasts the drawer's debounce, so every partial pattern becomes its own scan
        for (const step of ['**/{todo', '**/{todo,', '**/{todo,d', '**/{todo,done}.md']) {
            await include.fill(step);
            await page.waitForTimeout(450);
        }
        // "in 22 files)" rather than a bare 22, which the unfiltered 2222-file count also contains
        await expect(frame.getByTestId('breadcrumb-file-count')).toContainText('in 22 files)', { timeout: 90_000 });
        // let any straggling older scan land before the final read
        await page.waitForTimeout(8_000);
        await expect(frame.getByTestId('breadcrumb-file-count')).toContainText('in 22 files)');
        await expect(frame.getByText('Open story 0').first()).toBeVisible();
        await expect(frame.getByText('Shipped story 10').first()).toBeVisible();
    });
});

/*
 * Browser and page lifecycle for the perf runner.
 *
 * Serves the repo's own Playwright harness page (playwright/harness/index.html), which carries the
 * mock VS Code API and the minimal extension host the webview talks to, with one rewrite: the
 * bundle script tag points at /perf-bundle.js, which this server maps to whichever built bundle the
 * run selected. Reusing that page rather than copying it keeps one source of truth for the mock
 * host, and serving the bundle from test-results means a perf run never overwrites the bundle the
 * developer's VS Code dev host is serving out of client/webview/dist.
 *
 * The server binds an ephemeral port, so a perf run never collides with the Playwright harness on
 * 9123 or with a second perf run.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PERF_DIR = dirname(fileURLToPath(import.meta.url));
const PAGE_AGENT_PATH = join(PERF_DIR, 'page-agent.js');
const HARNESS_PAGE = '/playwright/harness/index.html';
const BUNDLE_ROUTE = '/perf-bundle.js';
const BUNDLED_SCRIPT_SRC = '/client/webview/dist/index.js';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/**
 * Start the static server and resolve once it is listening, with the harness page's URL and a close
 * function the caller must call. `bundle_path` is served at BUNDLE_ROUTE and swapped into the
 * harness page's script tag.
 */
export async function startHarnessServer(repo_root, bundle_path) {
    const page_html = await rewriteHarnessPage(repo_root);
    const server = createServer((request, response) => {
        serveRequest(request, response, repo_root, bundle_path, page_html).catch(() => {
            response.writeHead(500);
            response.end('perf harness server error');
        });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    return {
        page_url: `http://127.0.0.1:${port}${HARNESS_PAGE}`,
        close: () => new Promise((resolve) => { server.close(resolve); }),
    };
}

/**
 * Point the harness page at the selected bundle, once, at startup. A silent no-op here would serve
 * the repo's own client/webview/dist bundle instead and every number in the report would describe a
 * bundle nobody selected, so a missing marker fails the run before a scenario measures anything.
 */
async function rewriteHarnessPage(repo_root) {
    const html = await readFile(join(repo_root, HARNESS_PAGE), 'utf-8');
    if (!html.includes(BUNDLED_SCRIPT_SRC)) {
        throw new Error(`${HARNESS_PAGE} no longer loads ${BUNDLED_SCRIPT_SRC}; update BUNDLED_SCRIPT_SRC in scripts/perf/harness.mjs`);
    }
    return html.replace(BUNDLED_SCRIPT_SRC, BUNDLE_ROUTE);
}

// serve the bundle route, the rewritten harness page, or any other repo file as-is
async function serveRequest(request, response, repo_root, bundle_path, page_html) {
    const url_path = decodeURIComponent(request.url.split('?')[0]);
    if (url_path === BUNDLE_ROUTE) {
        await sendFile(response, bundle_path, MIME['.js']);
        return;
    }
    if (url_path === HARNESS_PAGE) {
        response.writeHead(200, { 'Content-Type': MIME['.html'] });
        response.end(page_html);
        return;
    }
    await sendFile(response, join(repo_root, url_path), MIME[extname(url_path)] || 'application/octet-stream');
}

async function sendFile(response, file_path, content_type) {
    try {
        const data = await readFile(file_path);
        response.writeHead(200, { 'Content-Type': content_type });
        response.end(data);
    } catch {
        response.writeHead(404);
        response.end('Not found');
    }
}

export async function launchBrowser() {
    return chromium.launch({ headless: true });
}

/**
 * Open a page on the harness with `view_states` pre-seeded into window.__vsCodeState and the page
 * agent installed. The harness honours an already-set __vsCodeState, so seeding it from an init
 * script is how a scenario boots straight into folder mode without driving the Jump drawer.
 *
 * Each scenario gets its own context: sessionStorage carries persisted state across reloads within
 * one, and a scenario must never inherit the previous one's board.
 *
 * The viewport is fixed. It does not change a number today, because every card mounts whatever the
 * window size, but it decides how many mount once the columns are virtualised, and a measurement
 * taken at a viewport nobody wrote down would not compare with the one before it.
 */
export async function openHarnessPage(browser, page_url, view_states) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const crash = { happened: false };
    page.on('crash', () => { crash.happened = true; });
    await page.addInitScript((seed) => { window.__vsCodeState = seed; }, { docs: {}, viewStates: view_states });
    // client/webview/src/lib/boardCommitProbe.ts is off unless this flag is set before the bundle evaluates, and names this harness as one of its readers
    await page.addInitScript(() => { globalThis.__NOTETHINK_COMMIT_PROBE__ = true; });
    await page.addInitScript({ path: PAGE_AGENT_PATH });
    await page.goto(page_url);
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    return { page, crash, close: () => closeQuietly(context) };
}

/*
 * Close a scenario's context, tolerating a target that has already gone. A renderer crash is a
 * result this harness expects to record (a 400KB edit re-send has crashed it before), and closing
 * the context it left behind throws; letting that throw would replace the crash the scenario
 * measured with a teardown error and lose the measurements taken before it.
 */
async function closeQuietly(context) {
    try {
        await context.close();
    } catch {
        // nothing to close: the page or browser is already gone, which the crash flag has recorded
    }
}

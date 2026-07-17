import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parse } from './parse-markdown';

interface DocSpec {
    fixture: string;        // filename in playwright/fixtures
    doc_path: string;       // absolute path the doc should claim
    relative_path?: string; // workspace-relative path (drives breadcrumb + origin pill)
}

/**
 * Inject multiple docs in a single 'update' message - sufficient to bootstrap
 * the webview's folder renderer for tests.
 */
export async function injectMultipleDocsFromFixtures(
    page: Page,
    docs: DocSpec[],
    options: { workspace_root?: string } = {},
): Promise<Array<{ id: string; path: string; relative_path?: string }>> {
    const built = docs.map((d) => {
        const fixture_path = path.join(__dirname, '..', 'fixtures', d.fixture);
        const text = fs.readFileSync(fixture_path, 'utf-8');
        const id = crypto.createHash('sha256').update(d.doc_path).digest('hex').slice(0, 16);
        const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
        const mdast = parse(text);
        return {
            id,
            path: d.doc_path,
            relative_path: d.relative_path,
            text,
            hash_sha256: hash,
            mdast,
        };
    });

    await page.evaluate(({ docs_payload, ws_root }) => {
        const docs_map: Record<string, unknown> = {};
        for (const d of docs_payload) {
            docs_map[d.id] = {
                id: d.id,
                path: d.path,
                relative_path: d.relative_path,
                text: d.text,
                hash_sha256: d.hash_sha256,
                content: d.mdast,
            };
        }
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'update',
                partial: { docs: docs_map },
                workspace_root: ws_root,
            },
        }));
    }, { docs_payload: built, ws_root: options.workspace_root || '' });

    return built.map(({ id, path, relative_path }) => ({ id, path, relative_path }));
}

/**
 * Set the integration selector via the existing UI. The selector lives in the Jump to drawer's
 * body, so this drives the real user route: open the drawer from the breadcrumb's terminal leaf,
 * which is that drawer's tab, pick the mode, then leave the board as the user would, with the mode
 * changed and no drawer hanging open over the view. Assertions on the selector's own DOM (value,
 * option text) do not need the drawer open and can address it directly.
 *
 * Closing is deliberately Escape and not a second tab click. A mode change can re-key the view
 * (current_file addresses the view by doc path, folder by the canonical __folder__), which remounts
 * the toolbar with a fresh drawer state that is already closed - so a second tab click would land on
 * a new tab and re-open it. Escape closes an open drawer and no-ops when none is open, which holds
 * whether or not the flip happened to remount.
 */
export async function selectIntegrationMode(page: Page, mode: 'auto' | 'folder' | 'current_file'): Promise<void> {
    const tab = page.locator('[data-testid="breadcrumb-leaf"]').first();
    const drawer = page.locator('[data-testid="jump-drawer-grid"]').first();
    await tab.click();
    await expect(drawer).toHaveAttribute('data-open', 'true');
    await page.locator('[data-testid="view-integration-selector"]').first().selectOption(mode);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('data-open', 'false');
}

export async function selectFolderMode(page: Page): Promise<void> {
    await selectIntegrationMode(page, 'folder');
}

import type { Page } from '@playwright/test';
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
 * Inject multiple docs in a single 'update' message — sufficient to bootstrap
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
 * Toggle the integration selector dropdown to 'folder' mode via the existing UI.
 */
export async function selectFolderMode(page: Page): Promise<void> {
    const selector = page.locator('[data-testid="view-integration-selector"]').first();
    await selector.selectOption('folder');
}

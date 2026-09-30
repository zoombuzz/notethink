import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';

// strips the dev cache-buster query string so a chunk URL still matches its bare filename
function requestedChunk(url: string, filename: string): boolean {
    return new URL(url).pathname.endsWith(`/${filename}`);
}

/*
 * Chunk ids are unstable across builds, so this finds mermaid's chunk by content, not a hardcoded
 * filename. output.clean is not configured, so a stale chunk from an earlier build can also match;
 * picking the newest mtime is what makes this resilient to that leftover.
 */
function findMermaidChunkFilename(): string {
    const dist_dir = path.join(__dirname, '..', '..', 'client', 'webview', 'dist');
    const candidates = fs.readdirSync(dist_dir).filter(f => f.endsWith('.js') && f !== 'index.js');
    // mermaidAPI is a real mermaid-internal export; the bare 'mermaid' string also appears in GenericNote's type switch
    const matches = candidates.filter((filename) => fs.readFileSync(path.join(dist_dir, filename), 'utf-8').includes('mermaidAPI'));
    if (matches.length === 0) { throw new Error(`no chunk under ${dist_dir} contains mermaidAPI - run pnpm run build first`); }
    return matches
        .map((filename) => ({ filename, mtime: fs.statSync(path.join(dist_dir, filename)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0].filename;
}

test.describe('mermaid lazy chunk', () => {
    let mermaid_chunk: string;

    test.beforeAll(() => {
        mermaid_chunk = findMermaidChunkFilename();
    });

    test('does not fetch the mermaid chunk when a document has no diagram', async ({ page }) => {
        const requested_urls: string[] = [];
        page.on('request', (req) => requested_urls.push(req.url()));
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        expect(requested_urls.some((url) => requestedChunk(url, mermaid_chunk))).toBe(false);
    });

    test('fetches the mermaid chunk and renders a diagram when a document has one', async ({ page }) => {
        const requested_urls: string[] = [];
        page.on('request', (req) => requested_urls.push(req.url()));
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'mermaid-diagram.md');
        await expect(page.locator('.mermaid svg')).toBeVisible({ timeout: 5000 });
        expect(requested_urls.some((url) => requestedChunk(url, mermaid_chunk))).toBe(true);
    });
});

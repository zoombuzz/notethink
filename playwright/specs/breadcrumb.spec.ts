import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';

test.describe('Breadcrumb workspace root stripping', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('shows full path when no workspace_root is provided', async ({ page }) => {
        const doc_path = '/mnt/secure/home/alex/git/github.com/active_development/notethink/docstech/testdata/example.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path);

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        // Without workspace_root or relative_path, all path segments should be visible
        await expect(nav.locator('button', { hasText: 'mnt' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'secure' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'active_development' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'notethink' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'example.md' })).toBeVisible();
    });

    test('strips workspace_root prefix from breadcrumb', async ({ page }) => {
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/notethink/docstech/testdata/example.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, workspace_root);

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        await expect(nav.locator('button', { hasText: 'mnt' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'active_development' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'notethink' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'example.md' })).toBeVisible();
    });

    test('uses relative_path for breadcrumb (symlink-safe)', async ({ page }) => {
        // Simulate symlink mismatch: workspace opened via /home/alex/github.com/active_development
        // but doc path resolves via /mnt/secure/home/alex/git/github.com/active_development
        // workspace_root won't match doc_path, but relative_path from asRelativePath handles it
        const doc_path = '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, {
            workspace_root: '/home/alex/github.com/active_development',
            relative_path: 'countingsheet/docs/todo.md',
        });

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        // Should NOT show any absolute path segments
        await expect(nav.locator('button', { hasText: 'mnt' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'secure' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'home' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'active_development' })).not.toBeVisible();

        // First segment should be 'countingsheet'
        const first_button = nav.locator('button[data-path]').first();
        await expect(first_button).toHaveText('countingsheet');
        await expect(nav.locator('button', { hasText: 'docs' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'todo.md' })).toBeVisible();
    });

    test('relative_path data-path attributes use full absolute paths for directory loading', async ({ page }) => {
        const doc_path = '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, {
            relative_path: 'countingsheet/docs/todo.md',
        });

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        const first_segment = nav.locator('button[data-path]').first();
        await expect(first_segment).toHaveAttribute(
            'data-path',
            '/mnt/secure/home/alex/git/github.com/active_development/countingsheet'
        );
    });

    test('breadcrumb with countingsheet path shows countingsheet as first segment', async ({ page }) => {
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/countingsheet/nodejs/ledger/docs/todo.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, workspace_root);

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        const first_button = nav.locator('button[data-path]').first();
        await expect(first_button).toHaveText('countingsheet');

        await expect(nav.locator('button', { hasText: 'nodejs' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'ledger' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'docs' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'todo.md' })).toBeVisible();
    });
});

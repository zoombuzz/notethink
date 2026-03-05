import { test, expect } from '@playwright/test';

test.describe('Error Boundary', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /**
     * Helper: inject a doc with a malformed MDAST that will cause
     * convertMdastToNoteHierarchy to throw (position: null on a heading node
     * triggers a TypeError when accessing position.start.offset).
     */
    async function injectMalformedDoc(page: import('@playwright/test').Page): Promise<string> {
        const doc_id = 'malformed-test-doc';
        await page.evaluate(({ id }) => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    type: 'update',
                    partial: {
                        docs: {
                            [id]: {
                                id,
                                path: '/workspace/malformed.md',
                                text: '# Test',
                                hash_sha256: 'abc123deadbeef',
                                content: {
                                    type: 'root',
                                    children: [{
                                        type: 'heading',
                                        depth: 1,
                                        children: [{ type: 'text', value: 'Test' }],
                                        // null position causes TypeError in convertMdastToNoteHierarchy
                                        // when it accesses child.position.start.offset
                                        position: null,
                                    }],
                                },
                            },
                        },
                    },
                },
            }));
        }, { id: doc_id });
        return doc_id;
    }

    test('shows fallback when malformed MDAST causes render error', async ({ page }) => {
        await injectMalformedDoc(page);

        // the error boundary fallback should appear
        const fallback = page.locator('[data-testid="error-boundary-fallback"]');
        await expect(fallback).toBeVisible({ timeout: 5000 });
    });

    test('fallback displays friendly message and error details', async ({ page }) => {
        await injectMalformedDoc(page);

        const fallback = page.locator('[data-testid="error-boundary-fallback"]');
        await expect(fallback).toBeVisible({ timeout: 5000 });

        // friendly user-facing message
        await expect(page.getByText('Something went wrong rendering this view')).toBeVisible();

        // the actual error message text should be present somewhere in the fallback
        const fallback_text = await fallback.textContent();
        expect(fallback_text).toBeTruthy();

        // stack trace details element should exist
        const stack_summary = page.getByText('Stack trace');
        await expect(stack_summary).toBeVisible();

        // the details element should contain a pre with stack info
        const details_el = fallback.locator('details');
        await expect(details_el).toBeAttached();
        const pre_el = details_el.locator('pre');
        await expect(pre_el).toBeAttached();
    });

    test('fallback includes a Try Again button', async ({ page }) => {
        await injectMalformedDoc(page);

        const fallback = page.locator('[data-testid="error-boundary-fallback"]');
        await expect(fallback).toBeVisible({ timeout: 5000 });

        const try_again_button = fallback.getByRole('button', { name: 'Try Again' });
        await expect(try_again_button).toBeVisible();
    });

    test('NoteRenderer container remains in the DOM despite error', async ({ page }) => {
        await injectMalformedDoc(page);

        // wait for the fallback to confirm the error was caught
        await expect(page.locator('[data-testid="error-boundary-fallback"]')).toBeVisible({ timeout: 5000 });

        // the NoteRenderer wrapper should still be attached (view does not go blank)
        const note_renderer = page.locator('[data-testid="NoteRenderer"]');
        await expect(note_renderer).toBeAttached();
    });
});

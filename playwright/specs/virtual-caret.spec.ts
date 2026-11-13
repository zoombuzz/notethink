import { test, expect, type Page } from '@playwright/test';
import * as crypto from 'node:crypto';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { clearCapturedMessages, getCapturedMessages } from '../helpers/capture-messages';
import { fixtureOffsetOf, fixtureText } from '../helpers/fixtures';
import { parse } from '../helpers/parse-markdown';
import { simulateSelectionChanged, simulateSelectionCleared } from '../helpers/simulate-selection';

const FIXTURE = 'virtual-caret.md';
const WORKSPACE_ROOT = '/mnt/workspace/in_development';

/*
 * The virtual caret prototype, driven in the browser against the real dev bundle (the harness bundle is
 * built with NOTETHINK_DEV set, which is the only way the caret exists). Jest proves the offset mapping and
 * the key handling; what only a browser shows is that the drawn caret really sits where the source offset
 * says, in a title with emphasis, code and a link and in a linetag value, that keys reach the caret with no
 * editor open, and that a relayed edit comes back and the caret redraws at the right place. The extension is
 * modelled by applying each captured editText to the text and re-posting the document.
 */

interface Box { x: number; y: number; width: number; height: number }

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function openBoard(page: Page): Promise<string> {
    const { path: doc_path } = await injectDocsFromFixture(page, FIXTURE);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    return doc_path;
}

// posts a new version of the document, as the extension does after applying an edit
async function postText(page: Page, doc_path: string, text: string): Promise<void> {
    const id = crypto.createHash('sha256').update(doc_path).digest('hex').slice(0, 16);
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    const content = JSON.stringify(parse(text));
    await page.evaluate(({ id, doc_path, text, hash, content }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'update', partial: { docs: { [id]: { id, path: doc_path, relative_path: undefined, text, hash_sha256: hash, content: JSON.parse(content) } } }, workspace_root: '' },
        }));
    }, { id, doc_path, text, hash, content });
}

// the first editText the caret relayed, applied to the text; the document the extension would post back
async function applyRelayedEdit(page: Page, text: string): Promise<{ next: string; change: { from: number; to?: number; insert: string } }> {
    await expect.poll(async () => (await getCapturedMessages(page)).some(message => message.type === 'editText')).toBe(true);
    const message = (await getCapturedMessages(page)).find(candidate => candidate.type === 'editText')!;
    const change = (message.changes as Array<{ from: number; to?: number; insert: string }>)[0];
    return { next: text.slice(0, change.from) + change.insert + text.slice(change.to ?? change.from), change };
}

async function box(page: Page, selector: string): Promise<Box> {
    const found = await page.locator(selector).first().boundingBox();
    if (!found) { throw new Error(`no box for ${selector}`); }
    return found;
}

// the card whose title is the marked up one
const MARKED_TITLE = '[data-vc-title]:has(code)';
const PLAIN_TITLE = '[data-vc-title]:has-text("Plain title")';

async function caretLeft(page: Page): Promise<number> {
    return (await box(page, '[data-testid="virtual-caret"]')).x;
}

test.describe('The virtual caret prototype', () => {

    test('draws the caret in a plain title at the editor\'s selection', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        // "Plain title": the caret between "Plain" and " title"
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'Plain title') + 5);
        const caret = page.getByTestId('virtual-caret');
        await expect(caret).toHaveAttribute('data-caret-mode', 'editor');
        await expect(caret).toHaveAttribute('data-caret-field', 'title');
        await expect(caret).toHaveAttribute('data-caret-offset', '5');
        const title = await box(page, PLAIN_TITLE);
        const caret_box = await box(page, '[data-testid="virtual-caret"]');
        expect(caret_box.x).toBeGreaterThan(title.x + 10);
        expect(caret_box.x).toBeLessThan(title.x + title.width - 10);
        expect(caret_box.y).toBeGreaterThanOrEqual(title.y - 2);
        expect(caret_box.y + caret_box.height).toBeLessThanOrEqual(title.y + title.height + 2);
    });

    test('draws the caret in a title with emphasis, code and a link', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        const text = fixtureText(FIXTURE);
        const bold = text.indexOf('**bold**');
        // before the opening marks and just inside them are the same place on screen
        await simulateSelectionChanged(page, doc_path, bold);
        await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '2');
        const before_marks = await caretLeft(page);
        await simulateSelectionChanged(page, doc_path, bold + 2);
        await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '2');
        expect(await caretLeft(page)).toBeCloseTo(before_marks, 0);
        // inside the bold word, then after it, the caret moves right
        await simulateSelectionChanged(page, doc_path, bold + 4);
        await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '4');
        const inside_bold = await caretLeft(page);
        expect(inside_bold).toBeGreaterThan(before_marks);
        // inside the code span: the rendered offset skips the backtick
        const code = text.indexOf('`code`');
        await simulateSelectionChanged(page, doc_path, code + 2);
        await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', String('A bold word and '.length + 1));
        // a link stays in the title, so the caret enters its text and counts the rendered characters only
        const link = text.indexOf('[a link]');
        await simulateSelectionChanged(page, doc_path, link + 3);
        await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', String('A bold word and code and '.length + 2));
        // the rendered text the caret counts in is exactly the text on screen
        await expect(page.locator(MARKED_TITLE)).toHaveText('A bold word and code and a link end');
    });

    test('draws the caret in a linetag value', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf(FIXTURE, 'doing') + 2);
        const caret = page.getByTestId('virtual-caret');
        await expect(caret).toHaveAttribute('data-caret-field', 'status');
        await expect(caret).toHaveAttribute('data-caret-offset', '2');
        const value = await box(page, '[data-vc-linetag="status"]:has-text("doing")');
        const caret_box = await box(page, '[data-testid="virtual-caret"]');
        expect(caret_box.x).toBeGreaterThan(value.x);
        expect(caret_box.x).toBeLessThan(value.x + value.width);
    });

    test('with the file open, the arrow keys post selectRange so the real caret follows and typing relays nothing', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        const start = fixtureOffsetOf(FIXTURE, 'Plain title');
        await simulateSelectionChanged(page, doc_path, start + 5);
        await expect(page.getByTestId('virtual-caret')).toHaveAttribute('data-caret-offset', '5');
        await page.locator(PLAIN_TITLE).click();
        await clearCapturedMessages(page);
        await page.getByTestId('virtual-caret-input').press('Home');
        await expect.poll(async () => (await getCapturedMessages(page)).find(message => message.type === 'selectRange')).toMatchObject({ type: 'selectRange', from: start, to: start, docPath: doc_path, forceOpen: false });
        await clearCapturedMessages(page);
        await page.getByTestId('virtual-caret-input').press('x');
        expect((await getCapturedMessages(page)).filter(message => message.type === 'editText')).toHaveLength(0);
    });

    test('with no editor, Left, Right, Home and End move the caret within the title and the value', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionCleared(page, doc_path);
        await page.locator(PLAIN_TITLE).click();
        const caret = page.getByTestId('virtual-caret');
        await expect(caret).toHaveAttribute('data-caret-mode', 'virtual');
        const input = page.getByTestId('virtual-caret-input');
        await expect(input).toBeFocused();
        await input.press('Home');
        await expect(caret).toHaveAttribute('data-caret-offset', '0');
        const home = await caretLeft(page);
        await input.press('ArrowRight');
        await input.press('ArrowRight');
        await expect(caret).toHaveAttribute('data-caret-offset', '2');
        expect(await caretLeft(page)).toBeGreaterThan(home);
        await input.press('End');
        await expect(caret).toHaveAttribute('data-caret-offset', String('Plain title'.length));
        await input.press('ArrowRight');
        await expect(caret).toHaveAttribute('data-caret-offset', String('Plain title'.length));
        // into a linetag value, shown once the note is focused
        await page.locator('[data-vc-linetag="status"]:has-text("doing")').click();
        await expect(caret).toHaveAttribute('data-caret-field', 'status');
        await input.press('Home');
        await expect(caret).toHaveAttribute('data-caret-offset', '0');
        await expect(page.getByTestId('virtual-caret')).toBeVisible();
    });

    test('with no editor, typing and Backspace relay editText and the caret redraws after the round trip', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionCleared(page, doc_path);
        await page.locator(PLAIN_TITLE).click();
        const input = page.getByTestId('virtual-caret-input');
        const caret = page.getByTestId('virtual-caret');
        await input.press('Home');
        await clearCapturedMessages(page);
        let text = fixtureText(FIXTURE);
        const start = text.indexOf('Plain title');
        await input.press('Z');
        let relayed = await applyRelayedEdit(page, text);
        expect(relayed.change).toEqual({ from: start, insert: 'Z' });
        // the caret has already stepped past the typed character, before the round trip lands
        await expect(caret).toHaveAttribute('data-caret-offset', '1');
        text = relayed.next;
        await postText(page, doc_path, text);
        await expect(page.locator(PLAIN_TITLE)).toHaveText('ZPlain title');
        await expect(caret).toHaveAttribute('data-caret-offset', '1');
        const after_type = await caretLeft(page);
        // removing the Z again with Backspace returns the caret to the start
        await clearCapturedMessages(page);
        await input.press('Backspace');
        relayed = await applyRelayedEdit(page, text);
        expect(relayed.change).toEqual({ from: start, to: start + 1, insert: '' });
        text = relayed.next;
        await postText(page, doc_path, text);
        await expect(page.locator(PLAIN_TITLE)).toHaveText('Plain title');
        await expect(caret).toHaveAttribute('data-caret-offset', '0');
        expect(await caretLeft(page)).toBeLessThan(after_type);
        expect(text).toBe(fixtureText(FIXTURE));
    });

    test('typing in a linetag value relays only characters the link can hold', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionCleared(page, doc_path);
        await page.locator(PLAIN_TITLE).click();
        await page.locator('[data-vc-linetag="status"]:has-text("doing")').click();
        const input = page.getByTestId('virtual-caret-input');
        await input.press('End');
        await clearCapturedMessages(page);
        await input.press('&');
        await input.press('s');
        const text = fixtureText(FIXTURE);
        const relayed = await applyRelayedEdit(page, text);
        expect(relayed.next).toContain('[](?status=doings)');
        expect((await getCapturedMessages(page)).filter(message => message.type === 'editText')).toHaveLength(1);
    });

    test('in folder mode the relayed edit names its own file and the caret survives the merge update', async ({ page }) => {
        await harness(page);
        const doc_path = `${WORKSPACE_ROOT}/alpha/docstech/board.md`;
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'card-sticky-kanban-a.md', doc_path, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'card-sticky-kanban-b.md', doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        const title = page.locator('[role="rowheader"] [data-vc-title]').first();
        await title.click();
        const input = page.getByTestId('virtual-caret-input');
        const caret = page.getByTestId('virtual-caret');
        await expect(caret).toBeVisible();
        await input.press('Home');
        await clearCapturedMessages(page);
        await input.press('Q');
        const message = await expect.poll(async () => (await getCapturedMessages(page)).find(candidate => candidate.type === 'editText')).toBeDefined();
        void message;
        const sent = (await getCapturedMessages(page)).find(candidate => candidate.type === 'editText')!;
        const doc_text = fixtureText(sent.docPath === doc_path ? 'card-sticky-kanban-a.md' : 'card-sticky-kanban-b.md');
        const change = (sent.changes as Array<{ from: number; insert: string }>)[0];
        const next_text = doc_text.slice(0, change.from) + change.insert + doc_text.slice(change.from);
        const id = crypto.createHash('sha256').update(sent.docPath as string).digest('hex').slice(0, 16);
        const hash = crypto.createHash('sha256').update(next_text).digest('hex').slice(0, 16);
        const relative_path = (sent.docPath as string).slice(WORKSPACE_ROOT.length + 1);
        await page.evaluate(({ id, doc_path, relative_path, text, hash, root }) => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'update', partial: { docs: { [id]: { id, path: doc_path, relative_path, text, hash_sha256: hash } } }, merge_strategy: 'merge', workspace_root: root },
            }));
        }, { id, doc_path: sent.docPath as string, relative_path, text: next_text, hash, root: WORKSPACE_ROOT });
        await expect(title).toContainText('Q');
        await expect(caret).toHaveAttribute('data-caret-offset', '1');
        await expect(caret).toHaveAttribute('data-caret-mode', 'virtual');
    });

    test('Escape drops the caret', async ({ page }) => {
        await harness(page);
        const doc_path = await openBoard(page);
        await simulateSelectionCleared(page, doc_path);
        await page.locator(PLAIN_TITLE).click();
        await expect(page.getByTestId('virtual-caret')).toBeVisible();
        await page.getByTestId('virtual-caret-input').press('Escape');
        await expect(page.getByTestId('virtual-caret')).toHaveCount(0);
    });
});

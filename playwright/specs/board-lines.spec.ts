import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { activityFixtureSnapshot } from '../helpers/inject-activity';
import { sendCommand } from '../helpers/send-command';
import { getCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const DEMO_TODO = 'demo/docstech/users/dev/todo.md';

/*
 * The build line (solid) and the ship line (dashed) across every view that shows a board's stories in
 * order, driven in the browser against the real bundle and a synthetic snapshot shaped as the analyser
 * posts it. Jest proves where each line falls for each rule; what only a browser shows is that every
 * card type, a grouped view, a windowed group and a board opened as one file or as a folder all draw the
 * lines between the right cards, in the highlight colour, with the stroke each one promises.
 */

const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
const IDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

// one board's entry of the snapshot's board_lines list, with no coordinator row anywhere
function boardRow(ids: string[], build_after: number, ship_after: number): Record<string, unknown> {
    return { doc_path: DEMO_TODO, story_ids: ids, build_after, ship_after };
}

async function postSnapshot(page: Page, board_lines: Array<Record<string, unknown>>): Promise<void> {
    const payload = { ...activityFixtureSnapshot({ sessions: [] }), coordinators: [], board_lines };
    await page.evaluate(snapshot => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: snapshot } }));
    }, payload);
}

async function setCardType(page: Page, card_type: string): Promise<void> {
    await page.evaluate((type) => {
        const harness = window as unknown as { __nt_settings: { workspace: { cards: Record<string, Record<string, unknown>> } }; __nt_publishSettings: () => void };
        harness.__nt_settings.workspace.cards.allcards = { ...harness.__nt_settings.workspace.cards.allcards, cardType: type };
        harness.__nt_publishSettings();
    }, card_type);
}

async function openHarness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function openSingleFile(page: Page, fixture: string, view: string, card_type: string): Promise<void> {
    await openHarness(page);
    await setCardType(page, card_type);
    await injectDocsFromFixture(page, fixture, `${WORKSPACE_ROOT}/${DEMO_TODO}`, { workspace_root: WORKSPACE_ROOT, relative_path: DEMO_TODO });
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await sendCommand(page, 'setViewType', { viewType: view });
}

// the host is asked for activity before the first snapshot can land, which the demand proves
async function demandSeen(page: Page): Promise<void> {
    await expect.poll(async () => (await getCapturedMessages(page)).filter(message => message.type === 'activityDemand').length).toBeGreaterThan(0);
}

/**
 * What a container holds in document order, as `lines:<kinds>` for a line group and the story's name for
 * a story card, so a test can assert that a line sits between exactly the cards it should.
 */
async function sequenceIn(scope: Locator): Promise<string[]> {
    return scope.evaluate((root, names) => {
        const found: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-board-lines], [data-mdast-type="heading"]'))) {
            if (el.hasAttribute('data-board-lines')) { found.push(`lines:${el.getAttribute('data-board-lines')!.replace(' ', '+')}`); continue; }
            const text = (el.textContent ?? '').trimStart();
            const name = names.find(candidate => text.startsWith(`${candidate} story`));
            if (name) { found.push(name); }
        }
        return found;
    }, NAMES);
}

test.describe('Build and ship lines', () => {

    for (const card_type of ['card', 'sticky', 'agent']) {
        for (const view of ['document', 'line', 'kanban']) {
            test(`the ${view} view draws both lines with the ${card_type} card type`, async ({ page }) => {
                await openSingleFile(page, 'board-lines.md', view, card_type);
                await demandSeen(page);
                await postSnapshot(page, [boardRow(IDS, 2, 4)]);
                if (view === 'document' && card_type !== 'card') {
                    // these card types draw a headline alone, so the document view lists no story to draw a line among
                    await expect(page.getByText('Alpha story')).toHaveCount(0);
                    await expect(page.getByTestId('board-lines')).toHaveCount(0);
                    return;
                }
                await expect(page.getByTestId('board-line-build').first()).toBeVisible();
                await expect(page.getByTestId('board-line-ship').first()).toBeVisible();
            });
        }
    }

    test('the document view draws the build line after the second story and the ship line after the fourth', async ({ page }) => {
        await openSingleFile(page, 'board-lines.md', 'document', 'card');
        await demandSeen(page);
        await postSnapshot(page, [boardRow(IDS, 2, 4)]);
        await expect(page.getByTestId('board-line-build')).toHaveCount(1);
        expect(await sequenceIn(page.locator('[data-testid^="document-"]').first())).toEqual(
            ['Alpha', 'Beta', 'lines:build', 'Gamma', 'Delta', 'lines:ship', 'Epsilon', 'Zeta'],
        );
    });

    test('both lines stack, build first, when they fall at the same position', async ({ page }) => {
        await openSingleFile(page, 'board-lines.md', 'document', 'card');
        await demandSeen(page);
        await postSnapshot(page, [boardRow(IDS, 3, 3)]);
        await expect(page.getByTestId('board-lines')).toHaveCount(1);
        await expect(page.getByTestId('board-lines')).toHaveAttribute('data-board-lines', 'build ship');
        const build = await page.getByTestId('board-line-build').boundingBox();
        const ship = await page.getByTestId('board-line-ship').boundingBox();
        expect(ship!.y).toBeGreaterThan(build!.y + 1);
    });

    test('the build line is solid and the ship line dashed, both in the highlight colour, each named for what it marks', async ({ page }) => {
        await openSingleFile(page, 'board-lines.md', 'document', 'card');
        await demandSeen(page);
        await postSnapshot(page, [boardRow(IDS, 2, 4)]);
        const build = page.getByTestId('board-line-build');
        const ship = page.getByTestId('board-line-ship');
        await expect(build).toHaveCSS('border-top-style', 'solid');
        await expect(ship).toHaveCSS('border-top-style', 'dashed');
        const focus_border = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.borderTop = '2px solid var(--vscode-focusBorder)';
            document.body.appendChild(probe);
            const colour = getComputedStyle(probe).borderTopColor;
            probe.remove();
            return colour;
        });
        await expect(build).toHaveCSS('border-top-color', focus_border);
        await expect(ship).toHaveCSS('border-top-color', focus_border);
        await expect(build).toHaveAttribute('role', 'separator');
        await expect(build).toHaveAttribute('aria-label', /Build line/);
        await expect(build).toHaveAttribute('title', /Build line/);
        await expect(ship).toHaveAttribute('aria-label', /Ship line/);
        await expect(ship).toHaveAttribute('title', /Ship line/);
    });

    test('each group of a grouped view draws the line between its own cards, first or last when its cards sit wholly on one side', async ({ page }) => {
        await openSingleFile(page, 'board-lines.md', 'kanban', 'card');
        await demandSeen(page);
        await postSnapshot(page, [boardRow(IDS, 2, 4)]);
        await expect(page.getByTestId('board-line-build').first()).toBeVisible();
        const group = (name: string): Locator => page.locator(`[data-flip-column-id="${name}"]`);
        // doing holds alpha and beta, both above both lines
        expect(await sequenceIn(group('doing'))).toEqual(['Alpha', 'Beta', 'lines:build+ship']);
        // testing holds delta: below the build line, above the ship line
        expect(await sequenceIn(group('testing'))).toEqual(['lines:build', 'Delta', 'lines:ship']);
    });

    test('a group with no cards draws no line, and the lines leave when the board leaves the list', async ({ page }) => {
        await openSingleFile(page, 'board-lines.md', 'kanban', 'card');
        await demandSeen(page);
        await postSnapshot(page, [boardRow(IDS, 2, 4)]);
        await expect(page.getByTestId('board-line-build').first()).toBeVisible();
        await postSnapshot(page, []);
        await expect(page.getByTestId('board-lines')).toHaveCount(0);
    });

    test('a board the host does not list draws no line', async ({ page }) => {
        await openSingleFile(page, 'board-lines.md', 'document', 'card');
        await demandSeen(page);
        await postSnapshot(page, [{ ...boardRow(IDS, 2, 4), doc_path: 'other/docstech/users/dev/todo.md' }]);
        await expect(page.getByTestId('board-lines')).toHaveCount(0);
    });

    test('a stacked-row board stands both lines on their side between its cards, solid and dashed, without displacing them', async ({ page }) => {
        await openHarness(page);
        await page.evaluate(() => {
            const harness = window as unknown as { __nt_settings: { workspace: { views: Record<string, Record<string, unknown>> } }; __nt_publishSettings?: () => void };
            harness.__nt_settings.workspace.views.line = { ...harness.__nt_settings.workspace.views.line, orientation: 'rows' };
            harness.__nt_publishSettings?.();
        });
        await injectDocsFromFixture(page, 'board-lines.md', `${WORKSPACE_ROOT}/${DEMO_TODO}`, { workspace_root: WORKSPACE_ROOT, relative_path: DEMO_TODO });
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await demandSeen(page);
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');
        const measure = async (): Promise<{ alpha: DOMRect; beta: DOMRect; delta: DOMRect }> => page.evaluate(() => {
            const rect = (name: string): DOMRect => {
                const heading = Array.from(document.querySelectorAll<HTMLElement>('[data-mdast-type="heading"]'))
                    .find(el => (el.textContent ?? '').trimStart().startsWith(`${name} story`))!;
                return heading.getBoundingClientRect();
            };
            return { alpha: rect('Alpha'), beta: rect('Beta'), delta: rect('Delta') };
        });
        await postSnapshot(page, []);
        const before = await measure();
        // build line after Alpha (between Alpha and Beta in doing), ship line after Delta (the end of testing)
        await postSnapshot(page, [boardRow(IDS, 1, 4)]);
        const doing = page.locator('[data-flip-column-id="doing"]');
        const testing = page.locator('[data-flip-column-id="testing"]');
        const build = doing.getByTestId('board-line-build');
        const ship = testing.getByTestId('board-line-ship');
        await expect(build).toBeVisible();
        await expect(ship).toBeVisible();
        await expect(build).toHaveCSS('border-left-style', 'solid');
        await expect(build).toHaveCSS('border-left-width', '2px');
        await expect(build).toHaveCSS('border-top-width', '0px');
        await expect(ship).toHaveCSS('border-left-style', 'dashed');
        await expect(ship).toHaveCSS('border-left-width', '2px');
        const after = await measure();
        const build_box = (await build.boundingBox())!;
        const ship_box = (await ship.boundingBox())!;
        // vertical strokes
        expect(build_box.height).toBeGreaterThan(build_box.width * 4);
        expect(ship_box.height).toBeGreaterThan(ship_box.width * 4);
        // the build line stands between Alpha and Beta, in the same row as both
        expect(Math.abs(after.alpha.top - after.beta.top)).toBeLessThan(2);
        expect(build_box.x).toBeGreaterThanOrEqual(after.alpha.right - 1);
        expect(build_box.x + build_box.width).toBeLessThanOrEqual(after.beta.left + 1);
        expect(build_box.y).toBeLessThanOrEqual(after.alpha.top + 1);
        expect(build_box.y + build_box.height).toBeGreaterThanOrEqual(after.alpha.bottom - 1);
        // the ship line stands beside Delta, the card it follows, over the height of its row
        expect(ship_box.x).toBeGreaterThanOrEqual(after.delta.right - 1);
        expect(ship_box.y).toBeLessThanOrEqual(after.delta.top + 1);
        expect(ship_box.y + ship_box.height).toBeGreaterThanOrEqual(after.delta.bottom - 1);
        // no card is pushed to another row, or taller, by the lines arriving
        expect(Math.abs(after.alpha.top - before.alpha.top)).toBeLessThan(2);
        expect(Math.abs(after.delta.top - before.delta.top)).toBeLessThan(2);
        expect(Math.abs(after.alpha.height - before.alpha.height)).toBeLessThan(2);
        expect(Math.abs(after.beta.height - before.beta.height)).toBeLessThan(2);
    });

    test('a windowed group draws the lines over its row edges without remounting every card', async ({ page }) => {
        const ids = Array.from({ length: 40 }, (_, i) => `long-${String(i + 1).padStart(2, '0')}`);
        await openSingleFile(page, 'board-lines-long.md', 'kanban', 'card');
        await demandSeen(page);
        await postSnapshot(page, [boardRow(ids, 3, 1)]);
        await expect(page.getByTestId('board-line-build')).toHaveCount(1);
        await expect(page.getByTestId('board-line-ship')).toHaveCount(1);
        const mounted = await page.locator('[data-column-card-id]').count();
        expect(mounted).toBeLessThan(40);
        const build_box = (await page.getByTestId('board-line-build').boundingBox())!;
        const third = (await page.locator('[data-column-card-id]').nth(2).boundingBox())!;
        const fourth = (await page.locator('[data-column-card-id]').nth(3).boundingBox())!;
        // between the third and fourth cards
        expect(build_box.y).toBeGreaterThan(third.y + third.height - 2);
        expect(build_box.y).toBeLessThan(fourth.y + 2);
    });

    test('a board opened as a folder draws the lines too, in the document and kanban views', async ({ page }) => {
        await openHarness(page);
        await injectMultipleDocsFromFixtures(page, [{ fixture: 'coordinator-todo.md', doc_path: `${WORKSPACE_ROOT}/${DEMO_TODO}`, relative_path: DEMO_TODO }], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        for (const view of ['document', 'kanban']) {
            await sendCommand(page, 'setViewType', { viewType: view });
            await demandSeen(page);
            await postSnapshot(page, [boardRow(['alpha', 'beta', 'gamma'], 2, 0)]);
            await expect(page.getByTestId('board-line-build').first()).toBeVisible();
            await expect(page.getByTestId('board-line-ship')).toHaveCount(0);
        }
    });
});

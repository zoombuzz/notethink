import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { activityFixtureSnapshot } from '../helpers/inject-activity';
import { clearCapturedMessages, getCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const DEMO_TODO = 'demo/docstech/users/dev/todo.md';
const OTHER_TODO = 'other/docstech/users/dev/todo.md';

/*
 * The coordinators listed in the Card drawer of a folder view, under the agent card type, driven in the browser against the real bundle
 * and a synthetic snapshot shaped as the analyser posts it. Jest proves the registry reading, the board
 * parsing, the envelope and the marker rewrite; what only a browser shows is the rows drawn in the right
 * views, the send form writing nothing until Send is pressed, a story card's send action opening the form
 * for the right agent, and the target line moving by a real pointer drag and by the keyboard, each
 * posting exactly one move.
 */

const STORIES = [
    { id: 'alpha', title: 'Alpha story', status: 'doing', convoys: [], operator_steps: ['reply to the vendor'] },
    { id: 'beta', title: 'Beta story', status: '', convoys: ['repo-b'], operator_steps: [] },
    { id: 'gamma', title: 'Gamma story', status: '', convoys: [], operator_steps: [] },
];

const DEMO_COORDINATOR = {
    agent: 'coord-demo', vendor: 'claude-code', state: 'working', story: 'alpha', version: '1.2.3', machine: 'host-a', open_convoys: ['convoy-1'],
    root_relative: 'demo', board_doc_path: DEMO_TODO, board_stories: STORIES, marker_after: 1,
};
const OTHER_COORDINATOR = {
    agent: 'coord-other', vendor: 'antigravity', state: 'idle', story: '', version: '', machine: 'host-a', open_convoys: [],
    root_relative: 'other', board_doc_path: OTHER_TODO, board_stories: [{ id: 'delta', title: 'Delta story', status: 'doing', convoys: [], operator_steps: [] }], marker_after: 0,
};
const ELSEWHERE_COORDINATOR = { ...OTHER_COORDINATOR, agent: 'coord-elsewhere', root_relative: 'elsewhere', board_doc_path: 'elsewhere/docstech/users/dev/todo.md' };

async function openBoards(page: Page, repos: Array<'demo' | 'other'>, coordinators: Array<Record<string, unknown>>): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    const docs = [
        ...(repos.includes('demo') ? [{ fixture: 'coordinator-todo.md', doc_path: `${WORKSPACE_ROOT}/${DEMO_TODO}`, relative_path: DEMO_TODO }] : []),
        ...(repos.includes('other') ? [{ fixture: 'coordinator-todo-other.md', doc_path: `${WORKSPACE_ROOT}/${OTHER_TODO}`, relative_path: OTHER_TODO }] : []),
    ];
    await injectMultipleDocsFromFixtures(page, docs, { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await postSnapshot(page, coordinators);
}

async function postSnapshot(page: Page, coordinators: Array<Record<string, unknown>>): Promise<void> {
    const payload = { ...activityFixtureSnapshot({ sessions: [] }), coordinators };
    await page.evaluate(snapshot => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: snapshot } }));
    }, payload);
}

async function postResult(page: Page, result: Record<string, unknown>): Promise<void> {
    await page.evaluate(data => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'coordinatorResult', ...data } })); }, result);
}

async function sent(page: Page, type: string): Promise<Array<Record<string, unknown>>> {
    return (await getCapturedMessages(page)).filter(message => message.type === type);
}

async function openCoordinators(page: Page): Promise<void> {
    await page.getByTestId('card-settings-button').click();
    await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
    await page.getByTestId('card-node-agent').click();
}

function row(page: Page, agent: string): Locator {
    return page.locator(`[data-testid="coordinator-row"][data-agent="${agent}"]`);
}

test.describe('Coordinators in the Card drawer', () => {

    test('a folder view lists each registered coordinator whose repository holds a loaded file, and no other', async ({ page }) => {
        await openBoards(page, ['demo', 'other'], [DEMO_COORDINATOR, OTHER_COORDINATOR, ELSEWHERE_COORDINATOR]);
        await expect(page.getByTestId('coordinator-panel')).toHaveCount(0);
        await openCoordinators(page);
        await expect(page.getByTestId('coordinator-row')).toHaveCount(2);
        const demo = row(page, 'coord-demo');
        await expect(demo.getByTestId('coordinator-state')).toHaveText('Working');
        await expect(demo.getByTestId('coordinator-story-now')).toHaveText('On story alpha');
        await expect(demo.getByTestId('coordinator-vendor-mark')).toHaveText('CC');
        await expect(demo.getByText(/Version/)).toHaveCount(0);
        await expect(demo.getByTestId('coordinator-convoys')).toHaveText('1 open convoy');
        await expect(row(page, 'coord-other').getByTestId('coordinator-state')).toHaveText('Idle');
        await expect(row(page, 'coord-other').getByTestId('coordinator-vendor-mark')).toHaveText('AG');
        await expect(row(page, 'coord-elsewhere')).toHaveCount(0);
    });

    test('a view open on one repository lists that repository\'s agent alone', async ({ page }) => {
        await openBoards(page, ['demo'], [DEMO_COORDINATOR, OTHER_COORDINATOR]);
        await openCoordinators(page);
        await expect(page.getByTestId('coordinator-row')).toHaveCount(1);
        await expect(row(page, 'coord-demo')).toBeVisible();
    });

    test('draws nothing when no coordinator is registered, though a loaded board has the host asked for activity', async ({ page }) => {
        await openBoards(page, ['demo'], []);
        await openCoordinators(page);
        await expect(page.getByTestId('coordinator-panel')).toHaveCount(0);
        expect((await sent(page, 'activityDemand')).length).toBeGreaterThan(0);
    });

    test('offers only a message and the target line, never a way to start, stop or restart an agent', async ({ page }) => {
        await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
        await openCoordinators(page);
        await expect(row(page, 'coord-demo').getByRole('button')).toHaveText(['Send to agent', 'Target line']);
    });

    test.describe('the vendor setting', () => {
        const picker = (page: Page, agent = 'coord-demo'): Locator => row(page, agent).getByTestId('coordinator-vendor-select');

        test('a change asks first, and Cancel sends nothing and keeps the registry\'s vendor', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await openCoordinators(page);
            await clearCapturedMessages(page);
            await expect(picker(page)).toHaveValue('claude-code');
            await picker(page).selectOption('codex');
            await expect(page.getByTestId('confirm-modal')).toBeVisible();
            await expect(page.getByTestId('confirm-modal')).toContainText('Ask coord-demo to restart in Codex?');
            await page.getByTestId('confirm-modal-cancel').click();
            await expect(page.getByTestId('confirm-modal')).toBeHidden();
            expect(await sent(page, 'coordinatorSend')).toHaveLength(0);
            await expect(picker(page)).toHaveValue('claude-code');
            await expect(page.getByTestId('coordinator-vendor-requested')).toHaveCount(0);
        });

        test('OK posts one vendor-change request naming the registry\'s spelling and holds it as requested until the registry reports it', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await openCoordinators(page);
            await clearCapturedMessages(page);
            await picker(page).selectOption('antigravity');
            await page.getByTestId('confirm-modal-ok').click();
            const posted = await sent(page, 'coordinatorSend');
            expect(posted).toHaveLength(1);
            expect(posted[0]).toMatchObject({ agent: 'coord-demo', kind: 'vendor', vendor: 'agy' });
            await expect(page.getByTestId('coordinator-vendor-requested')).toHaveText('Requested: Antigravity');
            await expect(row(page, 'coord-demo').getByTestId('coordinator-vendor-mark')).toHaveText('CC');
            await postSnapshot(page, [{ ...DEMO_COORDINATOR, vendor: 'antigravity' }]);
            await expect(page.getByTestId('coordinator-vendor-requested')).toHaveCount(0);
            await expect(row(page, 'coord-demo').getByTestId('coordinator-vendor-mark')).toHaveText('AG');
            await expect(picker(page)).toHaveValue('antigravity');
        });

        test('a refused request falls back to the registry\'s vendor and says why', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await openCoordinators(page);
            await picker(page).selectOption('grok');
            await page.getByTestId('confirm-modal-ok').click();
            await postResult(page, { request: 'vendor', agent: 'coord-demo', code: 'no_mailbox', ok: false });
            await expect(picker(page)).toHaveValue('claude-code');
            await expect(page.getByTestId('coordinator-status')).toHaveText('The agent has no mailbox yet.');
        });

        test('two coordinators change vendor independently', async ({ page }) => {
            await openBoards(page, ['demo', 'other'], [DEMO_COORDINATOR, OTHER_COORDINATOR]);
            await openCoordinators(page);
            await clearCapturedMessages(page);
            await picker(page, 'coord-other').selectOption('claude-code');
            await row(page, 'coord-other').getByTestId('confirm-modal-ok').click();
            const posted = await sent(page, 'coordinatorSend');
            expect(posted).toHaveLength(1);
            expect(posted[0]).toMatchObject({ agent: 'coord-other', kind: 'vendor', vendor: 'claude' });
            await expect(picker(page)).toHaveValue('claude-code');
            await expect(row(page, 'coord-demo').getByTestId('coordinator-vendor-requested')).toHaveCount(0);
        });
    });

    test.describe('send to agent', () => {
        test('writes nothing until Send is pressed, then posts one message naming the agent', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await openCoordinators(page);
            await clearCapturedMessages(page);
            await page.getByTestId('coordinator-send-toggle').click();
            await expect(page.getByTestId('coordinator-send-submit')).toBeDisabled();
            await page.getByTestId('coordinator-send-text').fill('please pick up beta next');
            expect(await sent(page, 'coordinatorSend')).toHaveLength(0);
            await page.getByTestId('coordinator-send-submit').click();
            const posted = await sent(page, 'coordinatorSend');
            expect(posted).toHaveLength(1);
            expect(posted[0]).toMatchObject({ agent: 'coord-demo', body: 'please pick up beta next' });
            await postResult(page, { request: 'send', agent: 'coord-demo', code: 'sent', ok: true });
            await expect(page.getByTestId('coordinator-status')).toHaveText('Sent to coord-demo.');
            await expect(page.getByTestId('coordinator-send-text')).toHaveValue('');
        });

        test('says why a send did not go', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await openCoordinators(page);
            await page.getByTestId('coordinator-send-toggle').click();
            await postResult(page, { request: 'send', agent: 'coord-demo', code: 'no_mailbox', ok: false });
            await expect(page.getByTestId('coordinator-status')).toHaveText('The agent has no mailbox yet.');
        });

        async function highlight(page: Page, title: string): Promise<void> {
            await page.locator('[role="rowheader"]', { hasText: title }).first().click();
            await expect(page.getByTestId('note-action-tray')).toHaveCount(1);
        }

        test('a story card\'s envelope shows only on a highlighted card, and a click on it asks before sending anything', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await expect(page.getByTestId('story-send-button')).toHaveCount(0);
            await highlight(page, 'Beta story');
            await clearCapturedMessages(page);
            const button = page.getByTestId('story-send-button');
            await expect(button).toBeVisible();
            await expect(button).toHaveAccessibleName('Send this story to coord-demo');
            await button.click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible();
            await expect(page.getByTestId('confirm-modal')).toContainText('Ask coord-demo to pick up story beta and include it in its current batch?');
            expect(await sent(page, 'coordinatorSend')).toHaveLength(0);
        });

        test('Cancel and Escape send nothing and return focus to the envelope', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await highlight(page, 'Beta story');
            await clearCapturedMessages(page);
            const button = page.getByTestId('story-send-button');
            await button.click();
            await page.getByTestId('confirm-modal-cancel').click();
            await expect(page.getByTestId('confirm-modal')).toBeHidden();
            await expect(button).toBeFocused();
            await button.click();
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('confirm-modal')).toBeHidden();
            await expect(button).toBeFocused();
            expect(await sent(page, 'coordinatorSend')).toHaveLength(0);
        });

        test('OK writes one envelope naming the story and its board, and the tray shows the host\'s answer', async ({ page }) => {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await highlight(page, 'Beta story');
            await clearCapturedMessages(page);
            await page.getByTestId('story-send-button').click();
            await page.getByTestId('confirm-modal-ok').click();
            const posted = await sent(page, 'coordinatorSend');
            expect(posted).toHaveLength(1);
            expect(posted[0]).toMatchObject({ agent: 'coord-demo', body: `Please pick up story beta from ${DEMO_TODO} and include it in your current batch.` });
            await postResult(page, { request: 'send', agent: 'coord-demo', code: 'no_mailbox', ok: false });
            await expect(page.getByTestId('note-action-tray-status')).toHaveText('The agent has no mailbox yet.');
        });

        test('a story on no coordinator\'s board has the pencil but no envelope', async ({ page }) => {
            await openBoards(page, ['demo', 'other'], [DEMO_COORDINATOR]);
            await highlight(page, 'Delta story');
            await expect(page.getByTestId('note-edit-button')).toBeVisible();
            await expect(page.getByTestId('story-send-button')).toHaveCount(0);
        });
    });

    test.describe('the target line', () => {
        async function openLine(page: Page): Promise<Locator> {
            await openBoards(page, ['demo'], [DEMO_COORDINATOR]);
            await openCoordinators(page);
            await page.getByTestId('coordinator-target-toggle').click();
            const line = page.getByTestId('coordinator-target-line');
            await expect(line).toBeVisible();
            // the drawer body scrolls, so the board is brought wholly into view before a pointer measures it
            await line.scrollIntoViewIfNeeded();
            await clearCapturedMessages(page);
            return line;
        }

        test('lists the board with the line after the marked story, and the convoys and steps on their stories', async ({ page }) => {
            const line = await openLine(page);
            await expect(line).toHaveAttribute('role', 'separator');
            await expect(line).toHaveAttribute('aria-valuenow', '1');
            await expect(line).toHaveAttribute('aria-valuetext', 'After Alpha story');
            await expect(page.getByTestId('coordinator-story')).toHaveCount(3);
            await expect(page.getByTestId('coordinator-story').nth(2)).toHaveAttribute('data-in-range', 'false');
            await expect(page.getByTestId('coordinator-story').nth(0).getByTestId('coordinator-story-step')).toHaveText('Your step: reply to the vendor');
            await expect(page.getByTestId('coordinator-story').nth(1).getByTestId('coordinator-story-convoy')).toHaveText('Convoy: repo-b');
        });

        test('drags with a real pointer to the story it is released after, posting one move', async ({ page }) => {
            const line = await openLine(page);
            const beta = page.getByTestId('coordinator-story').nth(1);
            const line_box = (await line.boundingBox())!;
            const beta_box = (await beta.boundingBox())!;
            await page.mouse.move(line_box.x + 20, line_box.y + line_box.height / 2);
            await page.mouse.down();
            await page.mouse.move(line_box.x + 20, beta_box.y + beta_box.height / 2 + 4, { steps: 6 });
            await expect(page.getByTestId('coordinator-target-ghost')).toHaveAttribute('data-position', '2');
            expect(await sent(page, 'coordinatorMoveMarker')).toHaveLength(0);
            await page.mouse.up();
            const moves = await sent(page, 'coordinatorMoveMarker');
            expect(moves).toHaveLength(1);
            expect(moves[0]).toMatchObject({ agent: 'coord-demo', after: 2 });
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '2');
        });

        test('drags above every story to take the marker off the board', async ({ page }) => {
            const line = await openLine(page);
            const alpha_box = (await page.getByTestId('coordinator-story').first().boundingBox())!;
            const line_box = (await line.boundingBox())!;
            await page.mouse.move(line_box.x + 20, line_box.y + line_box.height / 2);
            await page.mouse.down();
            await page.mouse.move(line_box.x + 20, alpha_box.y + 1, { steps: 6 });
            await page.mouse.up();
            expect((await sent(page, 'coordinatorMoveMarker'))[0]).toMatchObject({ after: 0 });
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuetext', 'No target line: nothing is set to run');
        });

        test('moves with the keyboard alone, keeping focus on the line', async ({ page }) => {
            const line = await openLine(page);
            await line.focus();
            await page.keyboard.press('ArrowDown');
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '2');
            await expect(page.getByTestId('coordinator-target-line')).toBeFocused();
            await page.keyboard.press('End');
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '3');
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('Home');
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '0');
            await expect(page.getByTestId('coordinator-target-line')).toBeFocused();
            expect((await sent(page, 'coordinatorMoveMarker')).map(message => message.after)).toEqual([2, 3, 2, 0]);
        });

        test('takes the position the board reports once the host has written the marker', async ({ page }) => {
            const line = await openLine(page);
            await line.focus();
            await page.keyboard.press('ArrowDown');
            await postSnapshot(page, [{ ...DEMO_COORDINATOR, marker_after: 2 }]);
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '2');
            await postSnapshot(page, [{ ...DEMO_COORDINATOR, marker_after: 3 }]);
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '3');
        });

        test('shows what the board holds again when the host refuses the move', async ({ page }) => {
            const line = await openLine(page);
            await line.focus();
            await page.keyboard.press('Home');
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '0');
            await postResult(page, { request: 'move', agent: 'coord-demo', code: 'write_failed', ok: false });
            await expect(page.getByTestId('coordinator-target-line')).toHaveAttribute('aria-valuenow', '1');
            await expect(page.getByTestId('coordinator-status')).toHaveText('The board could not be changed.');
        });
    });
});

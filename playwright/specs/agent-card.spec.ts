import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { injectActivity, injectActivityUnavailable, injectNoProducer, injectScanning } from '../helpers/inject-activity';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const NOTETHINK_TODO = 'notethink/docstech/users/alex.stanhope/todo.md';
const NOTEGIT_TODO = 'notegit/docstech/users/alex.stanhope/todo.md';

/*
 * The agent card, driven in the browser against the real bundle and a synthetic activity snapshot,
 * with no live agent anywhere. There used to be a `.notethink/` contract fixture directory this spec
 * drove from disk; it is retired (agent-activity-card story), and `inject-activity.ts` now builds the
 * analyser's payload directly, in code.
 *
 * Jest proves the joins, the honest-reporting states and the write-path refusals. What only a browser
 * can show is that the card really draws in every view rather than in the one it was built against,
 * that a virtual note takes its place among the stories without any view knowing, that the rows are
 * operable from the keyboard, and that nothing the card can be made to do ever posts an edit naming
 * the virtual sentinel.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function openViewSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

async function openCardSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('card-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

/** the two-project folder board carrying the stories the contract fixtures declare bindings against */
async function folderBoard(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'activity-todo-notethink.md', doc_path: `${WORKSPACE_ROOT}/${NOTETHINK_TODO}`, relative_path: NOTETHINK_TODO },
        { fixture: 'activity-todo-notegit.md', doc_path: `${WORKSPACE_ROOT}/${NOTEGIT_TODO}`, relative_path: NOTEGIT_TODO },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
}

/**
 * Pin the agent card before any document arrives, which is what a window reopened on a board already
 * set to it does. The card tab's radio is the same setting by another route, and the tab is asserted
 * below to confirm the two agree.
 */
async function pinAgentCard(page: Page): Promise<void> {
    await page.evaluate(() => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings: () => void };
        harness.__nt_settings.workspace.cardType = 'agent';
        harness.__nt_publishSettings();
    });
}

/** the board every spec below starts from: the agent card pinned, the folder view, and the fixture snapshot */
async function agentBoard(page: Page): Promise<void> {
    await pinAgentCard(page);
    await folderBoard(page);
    await injectActivity(page);
    await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
}

/** the card drawn for one story headline */
function cardFor(page: Page, headline: string): Locator {
    return page.locator('[data-card-type="agent"]').filter({ hasText: headline }).first();
}

// the text cells of an agent row, each of which must hold one line whatever width the card is given
const AGENT_ROW_CELLS = ['agent-monogram', 'agent-model', 'agent-state', 'agent-clock', 'agent-live', 'agent-usage'];

type RowCell = { testid: string; top: number; height: number; width: number; font_size: number };

/** where each text cell of an agent row landed, and the font size a single line of it is measured against */
async function rowCells(row: Locator): Promise<RowCell[]> {
    return row.evaluate((el, testids) => testids.map(testid => {
        const cell = el.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
        const box = cell.getBoundingClientRect();
        return { testid, top: box.top, height: box.height, width: box.width, font_size: parseFloat(getComputedStyle(cell).fontSize) };
    }), AGENT_ROW_CELLS);
}

/** the row cell with this test id */
function cellOf(cells: RowCell[], testid: string): RowCell {
    return cells.find(cell => cell.testid === testid) as RowCell;
}

/** every message the webview has posted to the mocked extension host */
async function capturedMessages(page: Page): Promise<Array<Record<string, unknown>>> {
    return page.evaluate(() => (window as unknown as { __captured_messages: Array<Record<string, unknown>> }).__captured_messages);
}

test.describe('Agent card', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    test('draws each agent that declared a story on that story, and never guesses one onto a card', async ({ page }) => {
        await agentBoard(page);
        // the card axis offers Agent as a choice of its own, and the tab names the card the notes are drawing as
        await expect(page.getByTestId('card-settings-button')).toContainText('Agent');
        await openCardSettings(page);
        await expect(page.getByTestId('card-radio-agent')).toBeChecked();
        await page.keyboard.press('Escape');

        const bound = cardFor(page, 'Agent activity card');
        await expect(bound.getByTestId('agent-row')).toHaveCount(1);
        await expect(bound.getByTestId('agent-monogram')).toHaveText('CC');
        await expect(bound.getByTestId('agent-model')).toHaveText('sonnet-5');
        await expect(bound.getByTestId('agent-model')).toHaveAttribute('title', 'claude-sonnet-5');
        await expect(bound.getByTestId('agent-state')).toHaveText('Working');
        await expect(bound.getByTestId('agent-live')).toContainText('Edit client/extension/src/types/AgentActivity.ts');
        await expect(bound.getByTestId('agent-row')).toHaveAttribute('data-state', 'working');

        // each of the other bound sessions declared its own story, and lands only there
        await expect(cardFor(page, 'Kanban card ratio height').getByTestId('agent-state')).toHaveText('Idle');
        await expect(cardFor(page, 'User view type update').getByTestId('agent-state')).toHaveText('Waiting on you');
        // a story in another repository, which no session touched, says nothing has worked on it rather than borrowing an agent
        const other_repo = cardFor(page, 'Workbench boot order');
        const other_repo_notice = other_repo.getByTestId('agent-banner-notice');
        await expect(other_repo_notice).toContainText('No agent activity in 30 days');
        await expect(other_repo_notice).toHaveAttribute('title', /No agent has worked on this story in the last 30 days/);
        await expect(other_repo.getByTestId('agent-row')).toHaveCount(0);

        // a story with no id linetag still has a joinable key (the slug derived from its headline), so an untouched one reads as quiet like any other rather than reporting a special "cannot be declared" state
        const undeclarable = cardFor(page, 'Story nobody can declare');
        await expect(undeclarable.getByTestId('agent-banner-notice')).toContainText('No agent activity in 30 days');
    });

    test('draws an agent that declared no story on a card of its own, among the stories and on none of them', async ({ page }) => {
        await agentBoard(page);
        const virtual = page.locator('[data-card-type="agent"][data-virtual-note="true"]');
        await expect(virtual).toHaveCount(1);
        await expect(virtual).toContainText('claude-code in notethink');
        await expect(virtual.getByTestId('agent-row')).toHaveCount(1);
        // no story's card drew it
        for (const headline of ['Agent activity card', 'Kanban card ratio height', 'Remove blank lines between statements']) {
            await expect(cardFor(page, headline)).toHaveAttribute('data-virtual-note', 'false');
        }
    });

    test('shows a pending question as a band, and draws no band for a vendor that cannot report one', async ({ page }) => {
        await agentBoard(page);
        const waiting = cardFor(page, 'User view type update');
        await expect(waiting.getByTestId('agent-question-prompt')).toHaveText('Apply the rename across all 14 call sites?');
        await expect(waiting.getByTestId('agent-question-options')).toContainText('Yes');

        const codex = cardFor(page, 'Remove blank lines between statements');
        await expect(codex.getByTestId('agent-row')).toHaveCount(1);
        await expect(codex.getByTestId('agent-question-band')).toHaveCount(0);
        // codex can report a tool call, and this session has none pending, so the live line reads quiet rather than unsupported
        await expect(codex.getByTestId('agent-live')).toContainText('Nothing running');
    });

    test('draws no state rail on the card, so hovering a card changes nothing about its edge', async ({ page }) => {
        await agentBoard(page);
        await openViewSettings(page);
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        const card = cardFor(page, 'Agent activity card');
        await expect(card).toHaveAttribute('data-winning-state', 'working');
        expect(await card.evaluate(el => getComputedStyle(el).boxShadow)).not.toContain('inset');
        await card.getByTestId('agent-usage-summary').hover();
        expect(await card.evaluate(el => getComputedStyle(el).boxShadow)).not.toContain('inset');
        // the per-agent rail stays, coloured by that agent's own state
        const rail_colour = await card.getByTestId('agent-row').first().evaluate(li => getComputedStyle(li.querySelector('button > span') as Element).backgroundColor);
        expect(rail_colour).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('lists changed files in the uncommitted band and leaves the branch\'s commits off the card, marking a file no write call accounts for as unattributed', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        const uncommitted = bound.getByTestId('agent-file-band-uncommitted');
        await expect(uncommitted.getByTestId('agent-file-row')).toHaveCount(3);
        await expect(uncommitted.locator('[data-attributed="false"]')).toHaveCount(1);
        await expect(uncommitted.locator('[data-attributed="false"]')).toContainText('unattributed');
        // the two files credited to claude-bound-busy carry a line diff; the header sums only those, leaving the unattributed and undiffed third file out of the total
        await expect(uncommitted.getByTestId('agent-file-line-diff')).toHaveCount(2);
        await expect(uncommitted.getByTestId('agent-file-band-line-diff-uncommitted')).toContainText('+24');
        await expect(uncommitted.getByTestId('agent-file-band-line-diff-uncommitted')).toContainText('-0');
        await expect(bound.getByTestId('agent-commit-band')).toHaveCount(0);

        // the fixture branch carries two commits credited to grok-bound-idle, yet its card still draws no commit band
        const idle = cardFor(page, 'Kanban card ratio height');
        await expect(idle).toBeVisible();
        await expect(idle.getByTestId('agent-commit-band')).toHaveCount(0);
    });

    test('unfolds the capped uncommitted band from "and N more" and folds it back from "Show less"', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        await injectActivity(page, { extra_uncommitted: 4 });
        const bound = cardFor(page, 'Agent activity card');
        const uncommitted = bound.getByTestId('agent-file-band-uncommitted');
        await expect(uncommitted.getByTestId('agent-file-row')).toHaveCount(3);
        const more = uncommitted.getByTestId('agent-file-band-more-uncommitted');
        await expect(more).toHaveText('and 4 more');
        await more.click();
        await expect(uncommitted.getByTestId('agent-file-row')).toHaveCount(7);
        await expect(more).toHaveCount(0);
        await uncommitted.getByTestId('agent-file-band-less-uncommitted').click();
        await expect(uncommitted.getByTestId('agent-file-row')).toHaveCount(3);
        await expect(uncommitted.getByTestId('agent-file-band-more-uncommitted')).toHaveText('and 4 more');
    });

    test('opens an agent row and a file row from the keyboard alone', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        const row = bound.getByTestId('agent-row-button').first();
        await row.focus();
        await expect(row).toBeFocused();
        await page.keyboard.press('Space');
        await expect.poll(async () => (await capturedMessages(page)).filter(m => m.type === 'openActivityChat').length).toBe(1);

        const file_row = bound.getByTestId('agent-file-row-button').first();
        await file_row.focus();
        await expect(file_row).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await capturedMessages(page)).filter(m => m.type === 'openActivityDiff').length).toBe(1);
    });

    test('draws in the document, line and kanban views, not only the one it was first tried in', async ({ page }) => {
        await agentBoard(page);
        await expect(page.locator('[data-auto-selected-viewtype="document"]')).toHaveCount(1);
        await expect(cardFor(page, 'Agent activity card').getByTestId('agent-row')).toHaveCount(1);

        await openViewSettings(page);
        await page.getByTestId('view-radio-line').click();
        await expect(page.locator('[data-flip-column-id]').first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(cardFor(page, 'Agent activity card').getByTestId('agent-row')).toHaveCount(1);
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(1);

        // the drawer is re-opened rather than left hanging: a view change re-keys the board, which remounts the toolbar with a fresh, closed drawer
        await openViewSettings(page);
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(cardFor(page, 'Agent activity card').getByTestId('agent-row')).toHaveCount(1);
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(1);

        // the body carries the lane's shared padding rule rather than drawing its bands flush to the card edges; the CSS module class is hashed at build time, so the body is found via its own testid'd child rather than a literal '.body' selector
        const body = cardFor(page, 'Agent activity card').getByTestId('agent-rows').locator('..');
        const padding_left = await body.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
        const padding_right = await body.evaluate(el => parseFloat(getComputedStyle(el).paddingRight));
        expect(padding_left).toBeGreaterThan(0);
        expect(padding_right).toBeGreaterThan(0);
    });

    test('stacks an agent row in a narrow kanban lane with every cell on one line, and the live line wide enough to read', async ({ page }) => {
        await agentBoard(page);
        await openViewSettings(page);
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        // a board too narrow for its lanes holds each at the default breadth rather than stretching them to fill, as an editor column beside a file does
        await page.setViewportSize({ width: 600, height: 900 });
        const card = cardFor(page, 'Agent activity card');
        const rows = card.getByTestId('agent-rows');
        // the layout switches on the roster's own width, so the lane must actually be narrower than the one-line threshold for this to test anything
        await expect.poll(async () => (await rows.boundingBox())!.width).toBeLessThan(440);
        const cells = await rowCells(card.getByTestId('agent-row-button').first());
        for (const cell of cells) {
            expect(cell.height, `${cell.testid} wrapped onto a second line`).toBeLessThanOrEqual(cell.font_size * 1.6);
        }
        const live = cellOf(cells, 'agent-live');
        expect(live.width).toBeGreaterThan(100);
        expect(live.top).toBeGreaterThan(cellOf(cells, 'agent-model').top);
        expect(cellOf(cells, 'agent-usage').top).toBeGreaterThan(live.top);
        // the shared card list rules draw a disc on every list item and the lane indents every list; a roster carries neither
        expect(await card.getByTestId('agent-row').first().evaluate(li => getComputedStyle(li).listStyleType)).toBe('none');
        expect(await rows.evaluate(ul => getComputedStyle(ul).paddingLeft)).toBe('0px');
    });

    test('draws an agent row on one line where the card is wide enough, as it is in the document view', async ({ page }) => {
        await agentBoard(page);
        await expect(page.locator('[data-auto-selected-viewtype="document"]')).toHaveCount(1);
        const card = cardFor(page, 'Agent activity card');
        expect((await card.getByTestId('agent-rows').boundingBox())!.width).toBeGreaterThanOrEqual(440);
        const cells = await rowCells(card.getByTestId('agent-row-button').first());
        const model_top = cellOf(cells, 'agent-model').top;
        for (const cell of cells) {
            expect(cell.height, `${cell.testid} wrapped onto a second line`).toBeLessThanOrEqual(cell.font_size * 1.6);
            // baseline alignment across two font sizes shifts a box's top by a few pixels, never by a line
            expect(Math.abs(cell.top - model_top), `${cell.testid} is not on the model's line`).toBeLessThan(cell.font_size * 0.8);
        }    });

    test('never posts an edit naming the virtual sentinel, whatever the card is made to do', async ({ page }) => {
        await agentBoard(page);
        const virtual = page.locator('[data-card-type="agent"][data-virtual-note="true"]');
        await virtual.click();
        await virtual.dblclick();
        await virtual.getByTestId('agent-row-button').first().click();
        const messages = await capturedMessages(page);
        expect(messages.length).toBeGreaterThan(0);
        expect(JSON.stringify(messages)).not.toContain('nt-virtual:');
    });

    test('says the analyser found nothing, so an empty board never reads as idle agents', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        await injectNoProducer(page);
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        const bound = cardFor(page, 'Agent activity card');
        const notice = bound.getByTestId('agent-banner-notice');
        await expect(notice).toHaveAttribute('data-analyser-state', 'live');
        await expect(notice).toContainText('No agent activity in 30 days');
        await expect(notice).toHaveAttribute('title', /No agent has worked on this story in the last 30 days/);
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(0);
    });

    test('says the analyser cannot read local files here, rather than showing an idle board', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        await injectActivity(page, { live: false, sessions: [] });
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        const bound = cardFor(page, 'Agent activity card');
        const notice = bound.getByTestId('agent-banner-notice');
        await expect(notice).toHaveAttribute('data-analyser-state', 'unavailable');
        await expect(notice).toContainText('Agent activity unavailable');
        await expect(notice).toHaveAttribute('title', /cannot read local agent session files/);
        await expect(bound.getByTestId('agent-row')).toHaveCount(0);
    });

    test('draws a refused session file, and an unreadable session, before any empty state', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        await injectActivity(page, {
            refusals: [
                { file: 'grok events log', code: 'unsupported_version', reason: 'a version this build cannot read' },
                { file: 'codex rollout for codex-no-', code: 'unreadable', reason: 'the file could not be decoded', session_id: 'codex-no-question' },
            ],
        });
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        const bound = cardFor(page, 'Agent activity card');
        await expect(bound.getByTestId('agent-banner-refusals')).toContainText('grok events log could not be read');
        const blank_lines = cardFor(page, 'Remove blank lines between statements');
        await expect(blank_lines.getByTestId('agent-row-refusals')).toContainText('codex rollout for codex-no- could not be read');
        await expect(bound.getByTestId('agent-banner-unreadable')).toContainText('1 session(s) could not be fully read');
    });

    test('opens a file row as a diff, echoing back the root and path the host published', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        await bound.getByTestId('agent-file-row-button').first().click();
        const opens = (await capturedMessages(page)).filter(m => m.type === 'openActivityDiff');
        expect(opens).toHaveLength(1);
        expect(opens[0]).toEqual({
            type: 'openActivityDiff',
            root_path: '/mnt/workspace/in_development/notethink',
            path: 'client/extension/src/types/AgentActivity.ts',
            band: 'uncommitted',
        });
    });

    test('takes the host answer over its own reading once an attempt has been refused', async ({ page }) => {
        await agentBoard(page);
        // the file is attributed to the unbound agent, so it is drawn on that agent's own card
        const unbound = page.locator('[data-card-type="agent"][data-virtual-note="true"]');
        const board_icon_row = unbound.getByTestId('agent-file-row').filter({ hasText: 'media/board-icon.png' });
        await expect(board_icon_row.getByTestId('agent-file-row-button')).toBeEnabled();

        await injectActivityUnavailable(page, { request: 'diff', reason: 'not_listed', path: 'client/extension/src/types/AgentActivity.ts' });
        const listed_row = cardFor(page, 'Agent activity card').getByTestId('agent-file-row').filter({ hasText: 'client/extension/src/types/AgentActivity.ts' });
        await expect(listed_row.getByTestId('agent-file-no-diff')).toContainText('no longer in the band');
    });

    test('opens a session in VS Code rather than on the card, and says under its row when the host could not', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        await bound.getByTestId('agent-row-button').first().click();
        const opens = (await capturedMessages(page)).filter(m => m.type === 'openActivityChat');
        expect(opens).toEqual([{ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' }]);
        await expect(bound.getByTestId('agent-drawer')).toHaveCount(0);

        await injectActivityUnavailable(page, { request: 'chat', reason: 'open_failed', session_id: 'claude-bound-busy' });
        await expect(bound.getByTestId('agent-open-refusal')).toContainText('VS Code could not open this session.');
    });

    test('resolves a declared path against where the repository was found, and joins nothing when it does not match', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        // the same session set, reported from a repository one folder deeper than the documents sit
        await injectActivity(page, { root_relative: 'vendored/notethink', root_path: '/mnt/workspace/in_development/vendored/notethink' });
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        await expect(cardFor(page, 'Agent activity card').getByTestId('agent-row')).toHaveCount(0);
        // and nothing was guessed onto a neighbouring story either
        await expect(page.getByTestId('agent-row')).toHaveCount(1);
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(1);
    });

    test('picking the agent card from the card tab repaints a document view, not only a lane', async ({ page }) => {
        await folderBoard(page);
        await injectActivity(page);
        await expect(page.locator('[data-auto-selected-viewtype="document"]')).toHaveCount(1);
        await expect(page.locator('[data-card-type="agent"]')).toHaveCount(0);
        await openCardSettings(page);
        await page.getByTestId('card-radio-agent').click();
        await expect(cardFor(page, 'Agent activity card').getByTestId('agent-row')).toHaveCount(1, { timeout: 5000 });
    });

    test('holds the toolbar spinner from picking the agent card until the analyser finishes its first scan', async ({ page }) => {
        await folderBoard(page);
        const toolbar_spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
        await openCardSettings(page);
        await page.getByTestId('card-radio-agent').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        // the harness host never answers the demand, which is the gap before a real host's first reply
        await expect(toolbar_spinner).toBeVisible({ timeout: 2000 });
        await injectScanning(page);
        await expect(page.locator('[data-analyser-state="scanning"]').first()).toBeVisible();
        await expect(toolbar_spinner).toBeVisible();
        await injectActivity(page);
        await expect(toolbar_spinner).toHaveCount(0, { timeout: 2000 });
        await expect(cardFor(page, 'Agent activity card').getByTestId('agent-row')).toHaveCount(1);
    });
});

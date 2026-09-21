import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { injectActivity, injectActivityUnavailable, injectNoProducer } from '../helpers/inject-activity';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const NOTETHINK_TODO = 'notethink/docstech/users/alex.stanhope/todo.md';
const NOTEGIT_TODO = 'notegit/docstech/users/alex.stanhope/todo.md';

/*
 * The agent card, driven in the browser against the real bundle and the contract's own fixtures, with
 * no live agent anywhere.
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
        await expect(bound.getByTestId('agent-state')).toHaveText('Working');
        await expect(bound.getByTestId('agent-live')).toContainText('Edit client/extension/src/types/AgentActivity.ts');
        await expect(bound.getByTestId('agent-row')).toHaveAttribute('data-state', 'working');

        // each of the other bound sessions declared its own story, and lands only there
        await expect(cardFor(page, 'Kanban card ratio height').getByTestId('agent-state')).toHaveText('Idle');
        await expect(cardFor(page, 'User view type update').getByTestId('agent-state')).toHaveText('Waiting on you');
        // a story in another repository, which has no producer at all, says that rather than borrowing an agent
        const other_repo = cardFor(page, 'Workbench boot order');
        await expect(other_repo.getByTestId('agent-banner-notice')).toHaveAttribute('data-producer-state', 'absent');
        await expect(other_repo.getByTestId('agent-row')).toHaveCount(0);

        // a story with no id linetag cannot be declared at all, which the card says rather than reporting it quiet
        const undeclarable = cardFor(page, 'Story nobody can declare');
        await expect(undeclarable.getByTestId('agent-banner-notice')).toContainText('carries no id linetag');
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

    test('shows a pending question as a band, and says plainly when a vendor cannot report one', async ({ page }) => {
        await agentBoard(page);
        const waiting = cardFor(page, 'User view type update');
        await expect(waiting.getByTestId('agent-question-prompt')).toHaveText('Apply the rename across all 14 call sites?');
        await expect(waiting.getByTestId('agent-question-options')).toContainText('Yes');

        const codex = cardFor(page, 'Remove blank lines between statements');
        const band = codex.getByTestId('agent-question-band');
        await expect(band).toHaveAttribute('data-fact', 'unsupported');
        await expect(band).toContainText('codex cannot report whether it is waiting on you');
        await expect(codex.getByTestId('agent-live')).toContainText('codex cannot report what it is running');
    });

    test('lists changed files in two bands, marking a file no write call accounts for as unattributed', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        const uncommitted = bound.getByTestId('agent-file-band-uncommitted');
        await expect(uncommitted.getByTestId('agent-file-row')).toHaveCount(3);
        await expect(uncommitted.locator('[data-attributed="false"]')).toHaveCount(1);
        await expect(uncommitted.locator('[data-attributed="false"]')).toContainText('unattributed');
        await expect(bound.getByTestId('agent-file-band-empty-committed')).toContainText('Nothing committed');
        // the contract keeps its own directory out of the band it feeds
        await expect(uncommitted).not.toContainText('.notethink/');
    });

    test('opens an agent row and a file row from the keyboard alone', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        const row = bound.getByTestId('agent-row-button').first();
        await row.focus();
        await expect(row).toBeFocused();
        await expect(row).toHaveAttribute('aria-expanded', 'false');
        await page.keyboard.press('Space');
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        await expect(bound.getByTestId('agent-drawer')).toHaveAttribute('data-open', 'true');
        await expect(bound.getByTestId('agent-drawer-message-window')).toContainText('Last 3 of 50');
        await expect(bound.getByTestId('agent-drawer-messages')).toContainText('carry on with the contract');

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
    });

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

    test('says no producer is writing, so an empty board never reads as idle agents', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        await injectNoProducer(page);
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        const bound = cardFor(page, 'Agent activity card');
        const notice = bound.getByTestId('agent-banner-notice');
        await expect(notice).toHaveAttribute('data-producer-state', 'absent');
        await expect(notice).toContainText('No producer is writing agent activity');
        await expect(notice).toContainText('.notethink');
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(0);
    });

    test('draws a refused contract file, and an unreadable declared session, before any empty state', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        await injectActivity(page, {
            sessions: [],
            unreadable_session_ids: ['claude-bound-busy', 'grok-question'],
            refusals: [{ file: 'sessions/future-version.session.json', code: 'unsupported_version', reason: 'contract_version 2.0.0 is a major this build cannot read' }],
        });
        await expect(page.locator('[data-card-type="agent"]').first()).toBeVisible({ timeout: 5000 });
        const bound = cardFor(page, 'Agent activity card');
        await expect(bound.getByTestId('agent-banner-refusals')).toContainText('future-version.session.json could not be read');
        await expect(bound.getByTestId('agent-banner-unreadable')).toContainText('2 of the 5 sessions this producer declares could not be read');
        await expect(bound.getByTestId('agent-banner-notice')).toContainText('No agent has declared this story');
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

    test('offers no diff for a side the producer did not store, and takes the host answer over its own reading', async ({ page }) => {
        await agentBoard(page);
        // the binary file is attributed to the unbound agent, so it is drawn on that agent's own card
        const unbound = page.locator('[data-card-type="agent"][data-virtual-note="true"]');
        const binary_row = unbound.getByTestId('agent-file-row').filter({ hasText: 'media/board-icon.png' });
        await expect(binary_row.getByTestId('agent-file-row-button')).toBeDisabled();
        await expect(binary_row.getByTestId('agent-file-no-diff')).toContainText('binary and was not stored');

        await injectActivityUnavailable(page, { request: 'diff', reason: 'not_listed', path: 'client/extension/src/types/AgentActivity.ts' });
        const listed_row = cardFor(page, 'Agent activity card').getByTestId('agent-file-row').filter({ hasText: 'client/extension/src/types/AgentActivity.ts' });
        await expect(listed_row.getByTestId('agent-file-no-diff')).toContainText('no longer in the band');
    });

    test('hands a session to its vendor without claiming it arrived, and keeps the conversation here', async ({ page }) => {
        await agentBoard(page);
        const bound = cardFor(page, 'Agent activity card');
        await bound.getByTestId('agent-row-button').first().click();
        await expect(bound.getByTestId('agent-open-chat-note')).toContainText('cannot tell whether it found the conversation');
        await bound.getByTestId('agent-open-chat').click();
        const opens = (await capturedMessages(page)).filter(m => m.type === 'openActivityChat');
        expect(opens).toEqual([{ type: 'openActivityChat', vendor: 'claude-code', session_id: 'claude-bound-busy' }]);

        await injectActivityUnavailable(page, { request: 'chat', reason: 'no_chat_panel', session_id: 'claude-bound-busy' });
        await expect(bound.getByTestId('agent-open-chat-note')).toContainText('has no chat panel in VS Code');
        // the digest never left, so a reader who lands on an empty vendor tab is not stranded
        await expect(bound.getByTestId('agent-drawer-messages')).toContainText('carry on with the contract');
    });

    test('resolves a declared path against where the contract root was found, and joins nothing when it does not match', async ({ page }) => {
        await pinAgentCard(page);
        await folderBoard(page);
        // the same fixture set, reported from a contract root one folder deeper than the documents sit
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
});

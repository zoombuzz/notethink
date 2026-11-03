import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';

/*
 * A saved view type parented on Kanban, holding its own group axis and its own custom group display,
 * while Kanban holds an automatic group order. Reopening the board must order the groups by that
 * automatic order, with agent activity arriving after the first render.
 */

const SAVED_TYPE_ID = 'user-next-up-by-project';

/** the group values the board is currently drawing, in board order */
async function groupValues(page: Page): Promise<string[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => el.getAttribute('data-flip-column-id') ?? ''));
}

/** post an activity snapshot with one bound session per project group, shaped as the analyser posts one */
async function dispatchProjectActivity(page: Page, updated_at: { alpha: string; beta: string }): Promise<void> {
    const capabilities = { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' };
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
    const session = (id: string, doc_path: string, story_id: string, updated: string): Record<string, unknown> => ({
        root_path: '/workspace',
        session: {
            session_id: id, vendor: 'claude-code', project: 'notethink',
            started_at: updated, updated_at: updated, state: 'working',
            story_binding: 'bound', stories: [{ doc_path, id: story_id }],
            capabilities, usage,
        },
    });
    const activity = {
        analyser: { state: 'live', refusals: [] },
        sessions: [
            session('alpha-session', 'alpha/todo.md', 'alpha-one', updated_at.alpha),
            session('beta-session', 'beta/todo.md', 'beta-one', updated_at.beta),
        ],
        trees: [{ root_path: '/workspace', root_relative: '', tree: { generated_at: updated_at.alpha, branch: 'staging', head_commit: 'a'.repeat(40), uncommitted: [], committed: [] } }],
    };
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: payload } }));
    }, activity);
}

/** seed the workspace views bag as a reopened window arrives, then re-publish the settings cascade */
async function seedViewsBag(page: Page, views: Record<string, Record<string, unknown>>, cards: Record<string, Record<string, unknown>> = {}): Promise<void> {
    await page.evaluate(([view_seed, card_seed]) => {
        const harness = window as unknown as { __nt_settings: { workspace: { views: Record<string, Record<string, unknown>>; cards: Record<string, Record<string, unknown>> } }; __nt_publishSettings?: () => void };
        for (const [node, bag] of Object.entries(view_seed)) {
            harness.__nt_settings.workspace.views[node] = { ...harness.__nt_settings.workspace.views[node], ...bag };
        }
        for (const [node, bag] of Object.entries(card_seed)) {
            harness.__nt_settings.workspace.cards[node] = { ...harness.__nt_settings.workspace.cards[node], ...bag };
        }
        harness.__nt_publishSettings?.();
    }, [views, cards] as const);
}

/** post an activity snapshot where ONE session wrote to a story in each project, so the session's own end time ties both */
async function dispatchSharedSessionActivity(page: Page, last_at: { alpha: string; beta: string }): Promise<void> {
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
    const activity = {
        analyser: { state: 'live', refusals: [] },
        sessions: [{
            root_path: '/workspace',
            session: {
                session_id: 'shared-session', vendor: 'claude-code', project: 'workspace',
                started_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', state: 'ended',
                story_binding: 'bound',
                stories: [{ doc_path: 'alpha/todo.md', id: 'alpha-one' }, { doc_path: 'beta/todo.md', id: 'beta-one' }],
                story_usage: [
                    { story: { doc_path: 'alpha/todo.md', id: 'alpha-one' }, usage, last_at: last_at.alpha },
                    { story: { doc_path: 'beta/todo.md', id: 'beta-one' }, usage, last_at: last_at.beta },
                ],
                capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
                usage,
            },
        }],
        trees: [],
    };
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: payload } }));
    }, activity);
}

/**
 * Post an activity snapshot with one bound session per project and one unbound session working in beta's
 * own repository, in the given state with the given transcript time, so the unbound session's card is drawn in beta
 */
async function dispatchWithUnboundSession(page: Page, unbound: { state: string; updated_at: string }): Promise<void> {
    const capabilities = { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' };
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
    const bound = (id: string, doc_path: string, story_id: string, updated: string): Record<string, unknown> => ({
        root_path: '/workspace',
        session: {
            session_id: id, vendor: 'claude-code', project: 'notethink',
            started_at: updated, updated_at: updated, state: 'working',
            story_binding: 'bound', stories: [{ doc_path, id: story_id }],
            capabilities, usage,
        },
    });
    const activity = {
        analyser: { state: 'live', refusals: [] },
        sessions: [
            bound('alpha-session', 'alpha/todo.md', 'alpha-one', '2026-10-10T00:00:00Z'),
            bound('beta-session', 'beta/todo.md', 'beta-one', '2026-10-01T00:00:00Z'),
            {
                root_path: '/workspace/beta',
                session: {
                    session_id: 'beta-coordinator', vendor: 'claude-code', project: 'notethink', session_name: 'coord-demo',
                    started_at: '2026-09-01T00:00:00Z', updated_at: unbound.updated_at, state: unbound.state,
                    story_binding: 'none', capabilities, usage,
                },
            },
        ],
        trees: [{ root_path: '/workspace/beta', root_relative: 'beta', tree: { generated_at: unbound.updated_at, branch: 'staging', head_commit: 'a'.repeat(40), uncommitted: [], committed: [] } }],
    };
    await page.evaluate((payload) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity: payload } }));
    }, activity);
}

test.describe('Group order on a saved view type', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a saved type holding its own group display still takes Kanban\'s newestLast order, once activity arrives', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        // the saved type's custom display lists beta before alpha, the reverse of what activity will say
        await seedViewsBag(page, {
            kanban: { groupOrder: 'newestLast', defaultCardType: 'agent' },
            [SAVED_TYPE_ID]: {
                parent: 'kanban',
                label: 'Next up by project',
                groupBy: 'nt_first_level_folder',
                groupDisplay: [
                    { value: 'beta', shown: true, axis: 'nt_first_level_folder' },
                    { value: 'alpha', shown: true, axis: 'nt_first_level_folder' },
                    { value: 'untagged', shown: true, axis: 'nt_first_level_folder' },
                ],
            },
            root: { viewType: SAVED_TYPE_ID },
        });
        await expect.poll(async () => groupValues(page)).toHaveLength(2);

        // alpha was active more recently, so newest last puts it rightmost
        await dispatchProjectActivity(page, { alpha: '2026-10-10T00:00:00Z', beta: '2026-10-01T00:00:00Z' });
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);

        // and the order follows fresher activity on beta
        await dispatchProjectActivity(page, { alpha: '2026-10-10T00:00:00Z', beta: '2026-10-11T00:00:00Z' });
        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);
    });

    /*
     * One agent session that wrote to a story in several projects ends once, so ordering by the session's
     * end time ties every one of those projects and leaves them in natural (alphabetical) order. Each
     * story's own last write is what separates them.
     */
    test('one session bound to a story in each project orders the projects by each story\'s own last write, not by the shared session end', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await seedViewsBag(page, {
            kanban: { groupOrder: 'newestLast', defaultCardType: 'agent' },
            [SAVED_TYPE_ID]: { parent: 'kanban', label: 'Next up by project', groupBy: 'nt_first_level_folder' },
            root: { viewType: SAVED_TYPE_ID },
        });
        await dispatchSharedSessionActivity(page, { alpha: '2026-10-11T00:00:00Z', beta: '2026-10-02T00:00:00Z' });
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
        await dispatchSharedSessionActivity(page, { alpha: '2026-10-02T00:00:00Z', beta: '2026-10-11T00:00:00Z' });
        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);
    });

    test('with the agent card pinned in the cards bag and activity already present, the saved type still orders newest last', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await dispatchProjectActivity(page, { alpha: '2026-10-10T00:00:00Z', beta: '2026-10-01T00:00:00Z' });
        await seedViewsBag(page, {
            kanban: { groupOrder: 'newestLast' },
            [SAVED_TYPE_ID]: {
                parent: 'kanban',
                label: 'Next up by project',
                groupBy: 'nt_first_level_folder',
                groupDisplay: [
                    { value: 'alpha', shown: true, axis: 'nt_first_level_folder' },
                    { value: 'beta', shown: true, axis: 'nt_first_level_folder' },
                    { value: 'untagged', shown: true, axis: 'nt_first_level_folder' },
                ],
            },
            root: { viewType: SAVED_TYPE_ID },
        }, { allcards: { cardType: 'agent' } });
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
    });

    /*
     * An idle coordinator adds transcript records on every wake, so its session's updated_at keeps
     * advancing while nothing in its project changes. That must never move the project's column.
     */
    test('a newer transcript record on an idle unbound session leaves the column order unchanged, and an ended one draws no card', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await seedViewsBag(page, {
            kanban: { groupOrder: 'newestLast', defaultCardType: 'agent' },
            [SAVED_TYPE_ID]: { parent: 'kanban', label: 'Next up by project', groupBy: 'nt_first_level_folder' },
            root: { viewType: SAVED_TYPE_ID },
        });
        const virtual_card = page.locator('[data-flip-column-id="beta"]').getByText('CC coord-demo');
        // beta's only timed story is older than alpha's, so beta sorts first
        await dispatchWithUnboundSession(page, { state: 'idle', updated_at: '2026-10-02T00:00:00Z' });
        await expect(virtual_card).toHaveCount(1);
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
        // the idle session wakes and writes a record far newer than any story: beta must not jump to the newest end
        await dispatchWithUnboundSession(page, { state: 'idle', updated_at: '2026-10-30T00:00:00Z' });
        await expect(virtual_card).toHaveCount(1);
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
        // once the session has ended its card is gone
        await dispatchWithUnboundSession(page, { state: 'ended', updated_at: '2026-10-30T00:00:00Z' });
        await expect(virtual_card).toHaveCount(0);
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
    });
});

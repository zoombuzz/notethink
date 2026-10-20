import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { centreInDrawer, pointerDrag } from '../helpers/pointer-drag';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * The view settings tab, driven in the browser against the real bundle.
 *
 * Almost every row in this drawer is per-view: an edit with Kanban selected lands in Kanban's own
 * declared `notethink.settings.view.specific.kanban.*` key (`view.generic.*` when the row's home is
 * Root), never in another node's own cell on the chain (Line, Grouped, root) - whichever setting it
 * is, group-by included. The one exception is a Global row (no
 * owning view type at all), which always writes flat. There is no more automatic "Save as a new view
 * type" offer; minting one is an explicit button in the Custom view types disclosure, always
 * available, that copies whichever values the selected view currently holds of its own.
 */

interface HarnessSettingsStore {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
}

// the node ids VIEW_REGISTRY ships with; any other id in the views bag is a saved type, not a built-in
const BUILTIN_VIEW_IDS = new Set(['root', 'document', 'grouped', 'line', 'kanban']);

async function readHarnessSettings(page: Page): Promise<HarnessSettingsStore> {
    return page.evaluate(() => (window as unknown as { __nt_settings: HarnessSettingsStore }).__nt_settings);
}

/** the saved view types as the harness holds them, extracted from the views bag by the fields a saved type carries */
async function readSavedTypes(page: Page): Promise<Array<{ id: string; parent: string; overrides: Record<string, unknown> }>> {
    const settings = await readHarnessSettings(page);
    const views = ((settings.workspace.views ?? settings.user.views ?? {}) as Record<string, Record<string, unknown>>);
    return Object.entries(views)
        .filter(([id, node]) => !BUILTIN_VIEW_IDS.has(id) && typeof node.parent === 'string' && typeof node.label === 'string')
        .map(([id, node]) => {
            const overrides: Record<string, unknown> = {};
            for (const [field, field_value] of Object.entries(node)) {
                if (field !== 'parent' && field !== 'label') { overrides[field] = field_value; }
            }
            return { id, parent: node.parent as string, overrides };
        });
}

/** the group values the board is currently drawing, in board order */
async function groupValues(page: Page): Promise<string[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => el.getAttribute('data-flip-column-id') ?? ''));
}

/** the Group display row's chip values, in the order the row lists them (read from the testid, not the label text) */
async function groupDisplayChipValues(page: Page): Promise<string[]> {
    return page.getByTestId(/^group-display-chip-/).evaluateAll(els => els.map(el => (el.getAttribute('data-testid') ?? '').replace('group-display-chip-', '')));
}

/**
 * Post an activity snapshot with one bound session per project group, shaped exactly as `AgentAnalyser.ts`
 * posts one. `inject-activity.ts`'s own helper ties its sessions to this repo's real todo.md path, which
 * the two synthetic project fixtures below do not carry, so the group-order spec builds its own snapshot
 * directly instead.
 */
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

/** put a value into a node's own views-bag cell at the workspace scope and re-publish, as a reopened window arrives already diverged */
async function seedWorkspaceViewSetting(page: Page, node_id: string, key: string, value: unknown): Promise<void> {
    await page.evaluate(([node, setting_key, setting_value]) => {
        const harness = window as unknown as { __nt_settings: { workspace: { views: Record<string, Record<string, unknown>> } }; __nt_publishSettings?: () => void };
        harness.__nt_settings.workspace.views[node as string] = { ...harness.__nt_settings.workspace.views[node as string], [setting_key as string]: setting_value };
        harness.__nt_publishSettings?.();
    }, [node_id, key, value] as [string, string, unknown]);
}

async function openSettingsDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

/*
 * Show the kanban node's settings on a board that is already a kanban.
 *
 * The fixture declares nt_view=kanban rather than the test switching type through the radio, so these
 * tests read the pane rather than a type switch, which has its own test below. Clicking the node moves
 * the highlight only, which is the point of the two marks.
 */
async function showKanbanSettings(page: Page): Promise<void> {
    await openSettingsDrawer(page);
    await page.getByTestId('view-node-kanban').click();
    await expect(page.getByTestId('setting-row-groupDisplay')).toBeVisible();
}

test.describe('View settings drawer', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'settings-drawer-board.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
    });

    /*
     * Folder mode with two boards, because the group-by candidates are enumerated from the notes on the
     * board and a categorical attribute has to be present for the axis to be changeable at all.
     */
    test('changing Group by from kanban writes Kanban\'s own cell in the views bag, leaving grouped\'s own cell alone', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await showKanbanSettings(page);

        // kanban's own built-in default (status) answers for it with nothing stored, so it reads as inherited, not VS
        await expect(page.getByTestId('setting-pill-groupBy')).toHaveText('Kanban');
        await expect(page.getByTestId('setting-pill-specific-groupBy')).toHaveCount(0);
        await expect(page.getByTestId('setting-pill-inherited-groupBy')).toBeVisible();
        await expect(page.getByTestId('setting-pill-inherited-groupBy')).toHaveAttribute('title', "Kanban's built-in default");

        // the group axis keeps GroupBySelector's own testid rather than the generic setting-control one
        const axis = page.getByTestId('group-by-selector');
        const candidate = (await axis.locator('option').allInnerTexts()).length;
        expect(candidate).toBeGreaterThan(1);
        // kanban's auto is status, so the label names status and the groups ARE the statuses
        await expect(axis.locator('option').first()).toHaveText(/^Auto \(Status\)/);
        expect(await groupValues(page)).toEqual(['doing', 'done']);

        await axis.selectOption('assignee');

        // the write forks to kanban's own entry in the map, leaving the ancestor's flat value alone
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.groupBy;
        }).toBe('assignee');
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.grouped?.groupBy;
        }).toBeUndefined();
        // the pill now names kanban itself, and the board honours the value, which is what makes the pill mean anything
        await expect(page.getByTestId('setting-pill-groupBy')).toHaveText('Kanban');
        await expect(page.getByTestId('setting-pill-specific-groupBy')).toBeVisible();
        await expect.poll(async () => groupValues(page)).toEqual(['alex', 'sam']);
    });

    /*
     * Rows are banded by the view their value comes from, most specific first, so a value kanban holds
     * for a Grouped setting reads in kanban's band, above Line's, rather than staying with Grouped's.
     */
    test('a setting kanban holds itself moves into kanban\'s band, ahead of line\'s, with hollow I and VS pills', async ({ page }) => {
        await showKanbanSettings(page);
        await seedWorkspaceViewSetting(page, 'kanban', 'groupOrder', 'alphabetical');
        await expect(page.getByTestId('setting-pill-groupOrder')).toHaveText('Kanban');

        const row_keys = await page.getByTestId(/^setting-row-/).evaluateAll(els => els.map(el => (el.getAttribute('data-testid') ?? '').replace('setting-row-', '')));
        expect(row_keys.indexOf('groupOrder')).toBeLessThan(row_keys.indexOf('orientation'));
        expect(row_keys.indexOf('groupOrder')).toBeLessThan(row_keys.indexOf('groupDisplay'));

        const specific = page.getByTestId('setting-pill-specific-groupOrder');
        const inherited = page.getByTestId('setting-pill-inherited-orientation');
        await expect(specific).toHaveText('VS');
        await expect(specific).toHaveAttribute('title', /^View specific; /);
        await expect(inherited).toHaveText('I');
        for (const pill of [specific, inherited]) {
            const style = await pill.evaluate(el => {
                const computed = window.getComputedStyle(el);
                return { background: computed.backgroundColor, border: computed.borderTopWidth };
            });
            expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '1px' });
        }
    });

    test('on a narrow drawer the names wrap and no control overruns the owner pill beside it', async ({ page }) => {
        await page.setViewportSize({ width: 560, height: 800 });
        await showKanbanSettings(page);
        for (const key of ['groupBy', 'groupOrder', 'cardRatio', 'defaultCardType']) {
            const control_right = await page.getByTestId(`setting-row-${key}`).locator('select').first().evaluate(el => el.getBoundingClientRect().right);
            const pill_left = await page.getByTestId(`setting-pill-${key}`).evaluate(el => el.getBoundingClientRect().left);
            expect(control_right).toBeLessThanOrEqual(pill_left);
        }
        const name_box = await page.getByTestId('setting-row-animateTransitions').locator('span').first().evaluate(el => {
            const rect = el.getBoundingClientRect();
            return { height: rect.height, line: parseFloat(window.getComputedStyle(el).lineHeight) || 18 };
        });
        expect(name_box.height).toBeGreaterThan(name_box.line * 1.5);
    });

    /*
     * Too narrow for two panes side by side, the tree stacks above the rows: its view names read whole
     * rather than truncating, every select keeps room to show its value, and the group chips stay inside
     * the control column instead of running under the owner pill.
     */
    test('on a very narrow drawer the view tree stacks above the rows and every control keeps its value visible', async ({ page }) => {
        await page.setViewportSize({ width: 440, height: 800 });
        await showKanbanSettings(page);
        const tree = await page.getByTestId('view-node-kanban').evaluate(el => {
            const node_rect = el.getBoundingClientRect();
            const label = el.querySelector('span');
            return { bottom: node_rect.bottom, truncated: label ? label.scrollWidth > label.clientWidth : false };
        });
        expect(tree.truncated).toBe(false);
        const first_row_top = await page.getByTestId(/^setting-row-/).first().evaluate(el => {
            const cells = Array.from(el.children) as HTMLElement[];
            return Math.min(...cells.map(cell => cell.getBoundingClientRect().top));
        });
        expect(first_row_top).toBeGreaterThan(tree.bottom);
        for (const key of ['cardRatio', 'defaultCardType', 'groupBy']) {
            const width = await page.getByTestId(`setting-row-${key}`).locator('select').first().evaluate(el => el.getBoundingClientRect().width);
            expect(width).toBeGreaterThan(60);
        }
        const pill_left = await page.getByTestId('setting-pill-groupDisplay').evaluate(el => el.getBoundingClientRect().left);
        const chip_rights = await page.getByTestId(/^group-display-chip-/).evaluateAll(els => els.map(el => el.getBoundingClientRect().right));
        for (const right of chip_rights) {
            expect(right).toBeLessThanOrEqual(pill_left);
        }
    });

    // choosing a type in the tree redraws the board under the drawer it was chosen in, rather than closing it
    test('choosing another view type in the tree keeps the settings drawer open', async ({ page }) => {
        await openSettingsDrawer(page);
        await page.getByTestId('view-radio-line').click();
        await expect(page.getByTestId('view-settings-button')).toHaveText(/Line/);
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
        await page.getByTestId('view-radio-auto').click();
        await expect(page.getByTestId('view-settings-button')).toHaveText(/Auto/);
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.getByTestId('view-settings-button')).toHaveText(/Kanban/);
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
    });

    /*
     * The group order is reordered by dragging a chip, so this drives the real pointer sensor rather than
     * a button. Two details the gesture needs: the drawer body scrolls at 50vh, so the chip has to be
     * brought into the viewport before it has a pressable box at all, and the chips are stacked one line
     * apart, so the drop point sits at the target chip's own mid-height rather than the default inset,
     * which is aimed at a full-height kanban group and would land two chips below the target.
     */
    test('dragging a group chip from kanban writes the new order into kanban\'s own cell in the views bag', async ({ page }) => {
        await showKanbanSettings(page);
        // nothing of kanban's own yet, so the pill still names the flat home
        await expect(page.getByTestId('setting-pill-groupDisplay')).toHaveText('Grouped');

        const chips = page.getByTestId(/^group-display-chip-/);
        await centreInDrawer(chips.first());
        const before = await chips.allInnerTexts();
        expect(before.length).toBeGreaterThan(1);

        const second = chips.nth(1);
        const inset = ((await second.boundingBox())?.height ?? 2) / 2;
        await pointerDrag(page, second, chips.nth(0), { destination_inset_y: inset });

        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.groupDisplay;
        }).not.toBeUndefined();
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.grouped?.groupDisplay;
        }).toBeUndefined();
        // the dragged group now leads the list, which is the order the cascade echoed back
        await expect.poll(async () => (await chips.allInnerTexts())[0]).toBe(before[1]);
        // the pill now names kanban itself, since it holds its own value
        await expect(page.getByTestId('setting-pill-groupDisplay')).toHaveText('Kanban');
    });

    test('a group chip reorders from the keyboard too, since the chips carry no nudge buttons', async ({ page }) => {
        await showKanbanSettings(page);
        const chips = page.getByTestId(/^group-display-chip-/);
        const before = await chips.allInnerTexts();

        // the list stacks, so the keyboard sensor's axis is up and down rather than left and right
        await chips.nth(1).focus();
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Space');

        await expect.poll(async () => (await chips.allInnerTexts())[0]).toBe(before[1]);
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.groupDisplay;
        }).not.toBeUndefined();
    });

    /*
     * Unchecking a group's checkbox must not start a drag (@hello-pangea/dnd excludes interactive
     * elements from its pointer sensor by default), and the hidden group drops off the board itself -
     * not merely its chip going quiet - which is what makes "Group display" a visibility control and
     * not just a reorder one. A caret simulated into the heading is what makes AutoView pick up the
     * fixture's nt_view=kanban linetag in current_file mode (kanban-view.spec.ts's setupKanbanView
     * does the same); showKanbanSettings alone only moves the drawer's own highlight.
     */
    test('unchecking a group chip hides that group from the board and records shown: false', async ({ page }) => {
        await simulateSelectionChanged(page, '/workspace/settings-drawer-board.md', 2);
        await expect.poll(async () => groupValues(page)).toEqual(['doing', 'done']);
        await showKanbanSettings(page);

        await page.getByTestId('group-display-shown-doing').click();

        await expect.poll(async () => groupValues(page)).toEqual(['done']);
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            const saved = overrides?.kanban?.groupDisplay as Array<{ value: string; shown: boolean }> | undefined;
            return saved?.find(entry => entry.value === 'doing')?.shown;
        }).toBe(false);
        // the chip itself survives, still reorderable, just dimmed
        await expect(page.getByTestId('group-display-chip-doing')).toBeVisible();
    });

    /*
     * Grouping the board by first level folder groups it by project rather than status, and Group display
     * has to follow that switch: it lists the folder groups the board is actually drawing, not the status
     * chips a different axis left behind, and hiding a folder group drops it from the board itself, the
     * same contract the status case above exercises. Switching back then proves the two axes' stored
     * displays never overwrite one another: the status hide from before the switch is still in effect,
     * untouched by what the folder axis did meanwhile.
     */
    test('grouping a kanban board by first level folder lists the folder groups in Group display, and hiding one removes it from the board', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await showKanbanSettings(page);
        await expect.poll(async () => groupValues(page)).toEqual(['doing', 'done']);

        // hide a status group before switching axes, so switching away and back can prove it survives
        await page.getByTestId('group-display-shown-doing').click();
        await expect.poll(async () => groupValues(page)).toEqual(['done']);

        await page.getByTestId('group-by-selector').selectOption('nt_first_level_folder');

        // the board now groups by folder, and the row lists exactly those groups, not the status ones
        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);
        await expect.poll(async () => groupDisplayChipValues(page)).toEqual(['alpha', 'beta', 'untagged']);

        await page.getByTestId('group-display-shown-alpha').click();

        await expect.poll(async () => groupValues(page)).toEqual(['beta']);
        // the chip itself survives, still reorderable, just dimmed - same contract as the status case above
        await expect(page.getByTestId('group-display-chip-alpha')).toBeVisible();

        // kanban's built-in default is status, so picking it (not the auto sentinel) is what clears back to it
        await page.getByTestId('group-by-selector').selectOption('status');

        // the status axis is exactly as left: 'doing' is still hidden, and the folder axis's hide of 'alpha' never touched it
        await expect.poll(async () => groupValues(page)).toEqual(['done']);
        // code-review and testing name no current note and so list no chip; untagged, doing and done do
        await expect.poll(async () => groupDisplayChipValues(page)).toEqual(['untagged', 'doing', 'done']);
    });

    test('toggling a Global setting from kanban still writes flat, since it belongs to no view type', async ({ page }) => {
        await showKanbanSettings(page);
        // a global row sits under its own heading and carries no owning-type pill, and no state pill, at all
        await expect(page.getByTestId('global-settings-heading')).toBeVisible();
        await expect(page.getByTestId('setting-pill-watchUnopenedFilesInViewer')).toHaveCount(0);
        await expect(page.getByTestId('setting-pill-inherited-watchUnopenedFilesInViewer')).toHaveCount(0);
        await expect(page.getByTestId('setting-pill-specific-watchUnopenedFilesInViewer')).toHaveCount(0);

        await page.getByTestId('setting-control-watchUnopenedFilesInViewer').click();

        await expect.poll(async () => (await readHarnessSettings(page)).workspace.watchUnopenedFilesInViewer).toBe(false);
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban;
        }).toBeUndefined();
    });

    test('saving the defaults drives the diverged count to zero and clears every M', async ({ page }) => {
        await openSettingsDrawer(page);
        // scrollNoteIntoView is per-view too; select its own home (root, "All views") so the edit lands there
        await page.getByTestId('view-node-root').click();
        await expect(page.getByTestId('diverged-count')).toContainText('0 settings');

        await page.getByTestId('setting-control-scrollNoteIntoView').click();
        await expect(page.getByTestId('setting-row-scrollNoteIntoView')).toHaveAttribute('data-diverged', 'true');
        await expect(page.getByTestId('diverged-count')).toContainText('1 setting');
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toHaveText('M');

        await page.getByTestId('change-defaults-summary').click();
        await page.getByTestId('save-as-default').click();

        // the click turned scrollNoteIntoView off, and promotion makes that off the saved default, in root's own cell
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).user.views as Record<string, Record<string, unknown>> | undefined;
            return views?.root?.scrollNoteIntoView;
        }).toBe(false);
        await expect(page.getByTestId('setting-row-scrollNoteIntoView')).toHaveAttribute('data-diverged', 'false');
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toHaveCount(0);
        await expect(page.getByTestId('diverged-count')).toContainText('0 settings');
        await expect(page.getByTestId('setting-control-scrollNoteIntoView')).not.toBeChecked();
    });

    /*
     * The same mechanism, but with Kanban selected: scrollNoteIntoView is per-view too, so the click
     * lands in Kanban's own cell in the views bag, and "Save as user default" promotes that
     * cell to the User scope exactly as it promotes a flat key.
     */
    test('saving the defaults also clears M for a per-view cell held by a built-in descendant', async ({ page }) => {
        await showKanbanSettings(page);
        await page.getByTestId('setting-control-scrollNoteIntoView').click();
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.scrollNoteIntoView;
        }).toBe(false);
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toHaveText('M');

        await page.getByTestId('change-defaults-summary').click();
        await page.getByTestId('save-as-default').click();

        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).user.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.scrollNoteIntoView;
        }).toBe(false);
        await expect(page.getByTestId('setting-row-scrollNoteIntoView')).toHaveAttribute('data-diverged', 'false');
        await expect(page.getByTestId('setting-marker-scrollNoteIntoView')).toHaveCount(0);
    });

    /*
     * Minting is explicit now, and starts the new type with an empty bag of its own: the button in the
     * Custom view types disclosure writes only `parent` and `label`, never copying whatever the selected
     * view currently holds (Kanban's own cell in the views bag here) - the new type reaches that value
     * through the parent link instead, so the board draws identically and Kanban's own entry is left
     * exactly as it was.
     */
    test('saving a new view type mints an empty bag parented on kanban, inheriting its value rather than copying it', async ({ page }) => {
        await showKanbanSettings(page);
        await page.getByTestId('group-by-selector').selectOption('assignee');
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.groupBy;
        }).toBe('assignee');

        await page.getByTestId('custom-view-types-summary').click();
        await page.getByTestId('new-view-type-open').click();
        await page.getByTestId('new-view-type-save').click();

        await expect.poll(async () => String(((await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined)?.root?.viewType ?? '')).toMatch(/^user-/);
        // kanban's own entry is untouched
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban?.groupBy;
        }).toBe('assignee');
        // the new type holds nothing of its own - no redundant copy to drift from its parent later
        await expect.poll(async () => {
            const types = await readSavedTypes(page);
            return types.find(t => t.parent === 'kanban')?.overrides.groupBy;
        }).toBeUndefined();
        // the board still draws on 'assignee', inherited from kanban through the new type's parent link
        await expect.poll(async () => groupValues(page)).toEqual(['alex', 'sam']);
        // the pill still names kanban - the value is inherited, not the new type's own
        await expect(page.getByTestId('setting-pill-groupBy')).toHaveText('Kanban');
        await expect(page.getByTestId('setting-pill-inherited-groupBy')).toBeVisible();
        // the tab states the default name the save form offered: the selected view named as a copy of it
        await expect(page.getByTestId('view-settings-button')).toHaveText(/Kanban copy/);
        // the board switched to the new type under the drawer, which stays open on it
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
    });

    /*
     * "Update <type>" is gone: an edit while a type is selected already lands in the type's own bag
     * directly, so there is nothing left to update afterwards. The explicit Save button is the only
     * control in the disclosure, on a built-in rung or on a saved type alike.
     */
    test('there is no Update control anywhere - Save as new view type is the only way to mint one', async ({ page }) => {
        await showKanbanSettings(page);
        await page.getByTestId('group-by-selector').selectOption('assignee');
        await page.getByTestId('custom-view-types-summary').click();
        await expect(page.getByTestId('new-view-type-open')).toBeVisible();
        await expect(page.getByTestId('user-view-type-update')).toHaveCount(0);
    });

    /*
     * The row's state is a question about the settings, not about the session: a workspace already
     * carrying a value at a setting's flat home shows the correct inherited pill and M the moment the
     * drawer opens on a descendant, with nothing touched.
     */
    test('a workspace that already diverges at a flat home shows the inherited pill and M on open, with nothing touched', async ({ page }) => {
        await seedWorkspaceViewSetting(page, 'line', 'orientation', 'rows');
        // orientation's own home is Line; Kanban holds none of its own, so it inherits and shows so
        await showKanbanSettings(page);
        await expect(page.getByTestId('setting-row-orientation')).toHaveAttribute('data-diverged', 'true');
        await expect(page.getByTestId('setting-pill-inherited-orientation')).toBeVisible();
        await expect(page.getByTestId('setting-pill-orientation')).toHaveText('Line');
    });

    /*
     * A folder board grouped by first level folder groups by project, exactly as the "Next up by project"
     * saved view does. With the agent card type on screen, newestLast orders those groups by the latest
     * agent activity on any of their own cards, oldest to newest (the most recently active project is the
     * rightmost named group), and keeps reordering live as fresh activity lands - the whole point of an
     * automatic order over a hand-dragged one. The timestamp itself is the agent card type's own business
     * (`cardregistryops.ts`), not this view's; the default-card-type case below orders by file mtime instead.
     */
    test('with the agent card type, newestLast orders a project board by its latest activity, and new activity moves a group last', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await seedWorkspaceViewSetting(page, 'kanban', 'defaultCardType', 'agent');
        await showKanbanSettings(page);
        await page.getByTestId('group-by-selector').selectOption('nt_first_level_folder');
        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);

        await page.getByTestId('setting-control-groupOrder').selectOption('newestLast');
        await dispatchProjectActivity(page, { alpha: '2026-10-01T00:00:00Z', beta: '2026-10-09T00:00:00Z' });

        // beta is the newer project, so it is the rightmost (last) named group, before untagged
        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);
        // the drawer's own chips agree with what the board just drew
        await expect.poll(async () => groupDisplayChipValues(page)).toEqual(['alpha', 'beta', 'untagged']);

        // fresher activity on alpha makes it the newest, moving it last instead, with no further input
        await dispatchProjectActivity(page, { alpha: '2026-10-10T00:00:00Z', beta: '2026-10-09T00:00:00Z' });
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
    });

    /** The mirror of newestLast: with the agent card type, newestFirst puts the most recently active project first. */
    test('with the agent card type, newestFirst puts the most recently active project first', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await seedWorkspaceViewSetting(page, 'kanban', 'defaultCardType', 'agent');
        await showKanbanSettings(page);
        await page.getByTestId('group-by-selector').selectOption('nt_first_level_folder');

        await page.getByTestId('setting-control-groupOrder').selectOption('newestFirst');
        await dispatchProjectActivity(page, { alpha: '2026-10-01T00:00:00Z', beta: '2026-10-09T00:00:00Z' });
        await expect.poll(async () => groupValues(page)).toEqual(['beta', 'alpha']);
    });

    /*
     * The default card type reads a group's cards' own mtime instead of agent activity - a view does not
     * know which card type is on screen, and a card type that declares no ordering rule of its own falls
     * back to this one. No activity is dispatched here at all; the files' own mtimes alone drive the order.
     */
    test('with the default card type, newestLast orders a project board by the files\' own mtimes', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md', mtime: Date.parse('2026-10-01T00:00:00Z') },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md', mtime: Date.parse('2026-10-09T00:00:00Z') },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await showKanbanSettings(page);
        await page.getByTestId('group-by-selector').selectOption('nt_first_level_folder');

        await page.getByTestId('setting-control-groupOrder').selectOption('newestLast');
        // beta's file is the more recently modified, so it is the rightmost (last) named group
        await expect.poll(async () => groupValues(page)).toEqual(['alpha', 'beta']);
        await expect.poll(async () => groupDisplayChipValues(page)).toEqual(['alpha', 'beta', 'untagged']);
    });

    /*
     * Dragging a chip while an automatic order is selected is how the operator takes back manual
     * control: the drop writes the order on screen (the automatic order with the one group moved), and
     * the select itself flips to Custom in the same action, so the board does not silently keep
     * recomputing an order the drag just contradicted. groupOrder is per-view too, and here 'custom'
     * happens to equal what kanban would inherit, so the write clears kanban's own entry rather than
     * holding 'custom' explicitly - same rendered effect, reached by inheriting instead of owning.
     */
    test('dragging a group chip while an automatic order is selected switches the select to Custom, seeded from the order on screen', async ({ page }) => {
        await showKanbanSettings(page);
        await page.getByTestId('setting-control-groupOrder').selectOption('alphabetical');
        // alphabetical ignores the saved order entirely; untagged still stays last
        await expect.poll(async () => groupDisplayChipValues(page)).toEqual(['code-review', 'doing', 'done', 'testing', 'untagged']);

        const chips = page.getByTestId(/^group-display-chip-/);
        await centreInDrawer(chips.first());
        const second = chips.nth(1);
        const inset = ((await second.boundingBox())?.height ?? 2) / 2;
        await pointerDrag(page, second, chips.nth(0), { destination_inset_y: inset });

        // clearing kanban's own entry is the expected outcome here, not a flat write of 'custom'
        await expect.poll(async () => {
            const overrides = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return overrides?.kanban ? Object.prototype.hasOwnProperty.call(overrides.kanban, 'groupOrder') : false;
        }).toBe(false);
        await expect.poll(async () => {
            const views = (await readHarnessSettings(page)).workspace.views as Record<string, Record<string, unknown>> | undefined;
            return views?.grouped?.groupOrder;
        }).toBeUndefined();
        await expect(page.getByTestId('setting-control-groupOrder')).toHaveValue('custom');
        // the written order is the alphabetical list with the dragged chip moved, not whatever a stale custom order held
        await expect.poll(async () => groupDisplayChipValues(page)).toEqual(['doing', 'code-review', 'done', 'testing', 'untagged']);
    });
});

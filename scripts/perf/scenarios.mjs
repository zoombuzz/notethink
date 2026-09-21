/*
 * The scenarios scripts/perf/run.mjs measures, and the wire messages they post.
 *
 * Every message here is the shape client/extension/src/vscode/PanelSession.ts posts for the same
 * event, AND in the same grouping, because the whole point of driving the real bundle is that the
 * webview cannot tell the harness from the extension. Folder discovery posts a spinner-on, one
 * merge update per flushed batch of up to DISCOVERY_BATCH_MAX_DOCS docs, the canonical aggregate
 * replace, then spinner-off; the watcher posts one doc per merge update through the same envelope;
 * a single-file open posts one replace update followed by a selectionChanged; an edit re-posts the
 * whole document.
 *
 * The grouping is load-bearing and has changed once already. Model it from PanelSession, not from
 * memory: a scenario that posts one message per file measures a delivery pattern the extension no
 * longer uses, and reports a batching optimisation as having done nothing.
 *
 * Each scenario produces a `measurements` map whose keys are the metric ids budgets.mjs is keyed
 * by, so a scenario may carry several budgets (the interaction scenario sets up one board and
 * measures three things on it). `facts` carries what a reader needs to interpret a number: how many
 * files, how many cards, how big the payload was.
 *
 * Adding a scenario is documented in the run.mjs header.
 */
import { buildFolderCorpus, buildSingleFileCorpus, buildWireDoc } from './corpus.mjs';
import { openHarnessPage } from './harness.mjs';

const WORKSPACE_ROOT = '/workspace/perf';
// mirrors DEFAULT_MAX_NOTES_PER_FILE in client/webview/src/constants.ts, which the harness's built-in settings echo back
const MAX_NOTES_PER_FILE = 10;
// mirrors DISCOVERY_BATCH_MAX_DOCS in client/extension/src/vscode/PanelSession.ts: docs per flushed discovery batch
const DISCOVERY_BATCH_MAX_DOCS = 20;
// mirrors DEFAULT_INCLUDE_FILTER / DEFAULT_EXCLUDE_FILTER in client/extension/src/constants.ts
const INCLUDE_FILTER = '**/*.md';
const EXCLUDE_FILTER = '**/{node_modules,notegit/nodejs,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage,vendored}/**';
// fixed so a generated payload is byte-identical between runs; the webview only orders docs by it
const SENT_AT = '2026-07-07T00:00:00.000Z';
const EXTENSION_VERSION = 'perf-harness';

// the folder view state the runner pre-seeds, which is what boots the board straight into folder mode with no drawer interaction
function folderViewStates() {
    return { __folder__: { type: 'kanban', display_options: { integration_mode: 'folder', integration_path: WORKSPACE_ROOT } } };
}

/**
 * The merge update PanelSession.sendFolderDocs posts, carrying any number of docs. Discovery flushes
 * a batch of up to DISCOVERY_BATCH_MAX_DOCS through it; the watcher posts one doc through the same
 * envelope. Only the doc count per message differs, which is exactly why this takes a list.
 */
function folderMergeMessage(docs, total_discovered, workspace_projects) {
    return {
        type: 'update',
        partial: { docs: docsMapOf(docs) },
        merge_strategy: 'merge',
        workspace_root: WORKSPACE_ROOT,
        workspace_projects,
        extension_version: EXTENSION_VERSION,
        aggregate_total_discovered: total_discovered,
        aggregate_truncated: false,
        include_filter: INCLUDE_FILTER,
        exclude_filter: EXCLUDE_FILTER,
    };
}

/**
 * The canonical replace update PanelSession.sendAggregatePayload posts once discovery has settled.
 * It carries every doc and no merge_strategy, and on a load that already streamed it costs nothing:
 * the webview compares key count and per-doc hashes, finds no change, and commits no state.
 */
function folderAggregateMessage(docs, workspace_projects) {
    return {
        type: 'update',
        partial: { docs: docsMapOf(docs) },
        workspace_root: WORKSPACE_ROOT,
        workspace_projects,
        extension_version: EXTENSION_VERSION,
        aggregate_total_discovered: docs.length,
        aggregate_truncated: false,
        include_filter: INCLUDE_FILTER,
        exclude_filter: EXCLUDE_FILTER,
    };
}

// the spinner signal that brackets discovery; the board reads it, so a scenario that leaves it out is not posting what the extension posts
function pendingChangeMessage(on) {
    return { type: 'pendingChange', key: 'folderDiscovery', on };
}

// docs keyed by id and stamped as sent, the shape every partial.docs carries on the wire
function docsMapOf(docs) {
    const map = {};
    for (const doc of docs) { map[doc.id] = { ...doc, updateSentAt: SENT_AT }; }
    return map;
}

/**
 * The message stream a folder discovery produces, in order: the spinner on, one merge update per
 * flushed batch, the canonical aggregate, then the spinner off.
 *
 * `batch_size` is how many docs a flush carries, and a scenario picks it to match whichever of the
 * extension's two flush bounds would actually govern its files. A scenario stages its docs up front
 * instead of reading them off a disk, so DISCOVERY_BATCH_FLUSH_MS has no elapsed time to measure
 * and cannot be modelled directly; the scenario has to work out which bound wins and say so.
 *
 * Deciding it is arithmetic, from the story's measured parse rate of 0.6ms per KB:
 * - 8KB files parse in ~5ms, so twenty of them arrive in ~96ms and the 20-doc cap trips first.
 *   batch_size is DISCOVERY_BATCH_MAX_DOCS.
 * - 400KB files parse in ~240ms each, so the 100ms timer fires between every file and each one
 *   flushes alone. batch_size is 1, and batching correctly shows no benefit there.
 * - batch_size 1 is also the pre-batching wire and what a watcher-driven burst still looks like.
 *
 * Getting this wrong makes the harness optimistic rather than loud: batching ten 400KB files into
 * one message reports a load twice as fast as the extension can deliver.
 */
function discoveryMessages(docs, workspace_projects, batch_size) {
    const messages = [pendingChangeMessage(true)];
    for (let index = 0; index < docs.length; index += batch_size) {
        messages.push(folderMergeMessage(docs.slice(index, index + batch_size), docs.length, workspace_projects));
    }
    messages.push(folderAggregateMessage(docs, workspace_projects));
    messages.push(pendingChangeMessage(false));
    return messages;
}

// the replace update PanelSession.sendDoc posts outside folder mode, where the docs map is the one open file
function singleFileUpdateMessage(doc) {
    return {
        type: 'update',
        partial: { docs: { [doc.id]: { ...doc, updateSentAt: SENT_AT } } },
        workspace_root: WORKSPACE_ROOT,
        extension_version: EXTENSION_VERSION,
    };
}

function selectionChangedMessage(doc_path, offset) {
    return { type: 'selectionChanged', docPath: doc_path, selection: { head: offset, anchor: offset } };
}

// the project directory names the generated corpus occupies, which the origin pill resolves against
function workspaceProjectsOf(docs) {
    return docs.map((doc) => String(doc.relative_path).split('/')[0]);
}

/**
 * Record one measured step, keeping a failure as a result rather than losing the steps already
 * taken. A Playwright failure carries the whole browser launch log, which would bury the report it
 * lands in, so the message is trimmed to its first lines.
 */
async function measureStep(measurements, metric_id, fn) {
    try {
        measurements[metric_id] = await fn();
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        measurements[metric_id] = { error: message.split('\n').slice(0, 3).join(' ').slice(0, 400) };
    }
}

/**
 * Source offset of a literal, throwing rather than returning -1. A silent -1 becomes a caret near
 * the top of the document, and the scenario would then measure a caret landing on a different note
 * than the one it named without anything saying so.
 */
function offsetOf(text, needle) {
    const offset = text.indexOf(needle);
    if (offset < 0) { throw new Error(`generated text contains no ${needle}`); }
    return offset;
}

// stage a payload as a JSON string and dispatch it, which is the only route large mdast may take into the page
async function stageAndDispatch(page, messages, options) {
    await page.evaluate((json) => window.__perf.stage(json), JSON.stringify(messages));
    return page.evaluate((opts) => window.__perf.dispatchStaged(opts), options);
}

/**
 * Progressive folder load: N files arrive as discovery posts them, and the measurement runs from the
 * first message to a settled board of N x cards-per-file.
 *
 * `batch_size` selects the delivery model, and it is the whole point of the scenario. At
 * DISCOVERY_BATCH_MAX_DOCS it is what the extension does today. At 1 it is the pre-batching wire,
 * one message per file, kept because that is still what a watcher-driven burst looks like and
 * because it is the honest worst case for the renderer.
 */
function folderProgressiveScenario({ id, label, metric_id, file_count, file_bytes, batch_size, settle_timeout_ms }) {
    return {
        id,
        label,
        metric_ids: [metric_id],
        async run(context) {
            const corpus = buildFolderCorpus({
                workspace_root: WORKSPACE_ROOT,
                file_count,
                stories_per_file: MAX_NOTES_PER_FILE,
                file_bytes,
                max_notes_per_file: MAX_NOTES_PER_FILE,
            });
            const projects = workspaceProjectsOf(corpus.docs);
            const messages = discoveryMessages(corpus.docs, projects, batch_size);
            const facts = {
                files: file_count,
                batch_size,
                wire_messages: messages.length,
                expected_cards: corpus.expected_cards,
                source_bytes: corpus.source_bytes,
                payload_bytes: JSON.stringify(messages).length,
            };
            const session = await openHarnessPage(context.browser, context.page_url, folderViewStates());
            const measurements = {};
            try {
                await measureStep(measurements, metric_id, () => stageAndDispatch(session.page, messages, {
                    expected_cards: corpus.expected_cards,
                    settle_timeout_ms,
                }));
            } finally {
                await session.close();
            }
            return { measurements, facts };
        },
    };
}

/**
 * Interactions on a settled folder board: a card click, an editor caret move arriving as
 * selectionChanged, and one file changing on disk arriving as a single merge update. Each is
 * measured on the same board, in that order, so the three numbers are comparable with each other.
 */
function folderInteractionScenario({ id, label, file_count, file_bytes, metric_ids, settle_timeout_ms }) {
    return {
        id,
        label,
        metric_ids: [metric_ids.click, metric_ids.selection, metric_ids.merge],
        async run(context) {
            const corpus = buildFolderCorpus({
                workspace_root: WORKSPACE_ROOT,
                file_count,
                stories_per_file: MAX_NOTES_PER_FILE,
                file_bytes,
                max_notes_per_file: MAX_NOTES_PER_FILE,
            });
            const projects = workspaceProjectsOf(corpus.docs);
            const session = await openHarnessPage(context.browser, context.page_url, folderViewStates());
            const measurements = {};
            try {
                const load = await stageAndDispatch(session.page, discoveryMessages(corpus.docs, projects, DISCOVERY_BATCH_MAX_DOCS), {
                    expected_cards: corpus.expected_cards,
                    settle_timeout_ms,
                });
                if (!load.settled) {
                    throw new Error(`board did not settle before the interactions: ${load.cards} of ${corpus.expected_cards} cards`);
                }
                await runFolderInteractions(session.page, corpus, projects, measurements, metric_ids, settle_timeout_ms);
                return { measurements, facts: { files: file_count, expected_cards: corpus.expected_cards, load_ms: load.elapsed_ms } };
            } finally {
                await session.close();
            }
        },
    };
}

/** the three interactions, in the order a user meets them: click a card, move the caret, have a file change underneath */
async function runFolderInteractions(page, corpus, projects, measurements, metric_ids, settle_timeout_ms) {
    const settle = { expected_cards: corpus.expected_cards, settle_timeout_ms };
    await measureStep(measurements, metric_ids.click, () => page.evaluate((opts) => window.__perf.clickCard(0, opts), settle));
    const first_doc = corpus.docs[0];
    const caret_offset = offsetOf(first_doc.text, '### Story 2') + 4;
    await measureStep(measurements, metric_ids.selection, () => page.evaluate(
        ({ json, opts }) => window.__perf.dispatchMessage(json, opts),
        { json: JSON.stringify(selectionChangedMessage(first_doc.path, caret_offset)), opts: settle },
    ));
    const edited = buildWireDoc({
        doc_path: first_doc.path,
        relative_path: first_doc.relative_path,
        text: `${first_doc.text}\n+ [ ] one more task, as a watcher event would deliver it\n`,
    });
    // the watcher path is NOT batched: one changed file is still one merge update carrying one doc
    await measureStep(measurements, metric_ids.merge, () => page.evaluate(
        ({ json, opts }) => window.__perf.dispatchMessage(json, opts),
        { json: JSON.stringify(folderMergeMessage([edited], corpus.docs.length, projects)), opts: settle },
    ));
}

/**
 * A single declared kanban file opening, then the same file re-sent one keystroke later. The
 * extension re-parses and re-posts the whole document on every debounced keystroke, so the edit
 * measurement is the cost of one character typed into a long file.
 */
function singleFileScenario({ id, label, file_bytes, story_bytes, metric_ids, settle_timeout_ms }) {
    return {
        id,
        label,
        metric_ids: [metric_ids.load, metric_ids.edit],
        async run(context) {
            const corpus = buildSingleFileCorpus({ workspace_root: WORKSPACE_ROOT, file_bytes, story_bytes });
            const session = await openHarnessPage(context.browser, context.page_url, {});
            const measurements = {};
            const settle = { expected_cards: corpus.expected_cards, settle_timeout_ms };
            try {
                // the open sequence: the doc, then the caret, which is what lets AutoView resolve the file's declared kanban view
                const open_messages = [singleFileUpdateMessage(corpus.doc), selectionChangedMessage(corpus.doc_path, 2)];
                await measureStep(measurements, metric_ids.load, () => stageAndDispatch(session.page, open_messages, settle));
                await measureStep(measurements, metric_ids.edit, () => session.page.evaluate(
                    ({ json, opts }) => window.__perf.dispatchMessage(json, opts),
                    { json: JSON.stringify(singleFileUpdateMessage(corpus.edited_doc)), opts: settle },
                ));
                return { measurements, facts: { expected_cards: corpus.expected_cards, source_bytes: corpus.source_bytes, crashed: session.crash.happened } };
            } finally {
                await session.close();
            }
        },
    };
}

/*
 * The scenario list, in run order. Smallest first, so a run that is cut short still produces the
 * cheap numbers, and the 200-file load - the slowest by two orders of magnitude - runs last.
 */
export const SCENARIOS = [
    folderProgressiveScenario({ id: 'folder-progressive-20', label: 'folder progressive load, 20 files of 8KB', metric_id: 'folder-load-20', file_count: 20, file_bytes: 8192, batch_size: DISCOVERY_BATCH_MAX_DOCS, settle_timeout_ms: 120000 }),
    folderProgressiveScenario({ id: 'folder-progressive-50', label: 'folder progressive load, 50 files of 8KB', metric_id: 'folder-load-50', file_count: 50, file_bytes: 8192, batch_size: DISCOVERY_BATCH_MAX_DOCS, settle_timeout_ms: 180000 }),
    folderProgressiveScenario({ id: 'folder-progressive-50-unbatched', label: 'folder load, 50 files of 8KB, one message per file (pre-batching wire, and a watcher burst)', metric_id: 'folder-load-50-unbatched', file_count: 50, file_bytes: 8192, batch_size: 1, settle_timeout_ms: 180000 }),
    folderInteractionScenario({
        id: 'folder-interactions-50',
        label: 'click, caret move and one-file merge on a settled 50-file board',
        file_count: 50,
        file_bytes: 8192,
        metric_ids: { click: 'folder-click-50', selection: 'folder-selection-50', merge: 'folder-merge-50' },
        settle_timeout_ms: 180000,
    }),
    singleFileScenario({
        id: 'single-file-100k',
        label: 'single declared kanban file of 100KB, then one keystroke re-sent',
        file_bytes: 102400,
        story_bytes: 856,
        metric_ids: { load: 'single-file-load-100k', edit: 'single-file-edit-100k' },
        settle_timeout_ms: 120000,
    }),
    singleFileScenario({
        id: 'single-file-400k',
        label: 'single declared kanban file of 400KB, then one keystroke re-sent',
        file_bytes: 409600,
        story_bytes: 856,
        metric_ids: { load: 'single-file-load-400k', edit: 'single-file-edit-400k' },
        settle_timeout_ms: 180000,
    }),
    folderProgressiveScenario({ id: 'folder-long-files-10', label: 'folder progressive load, 10 files of 400KB (timer-governed, one doc per flush)', metric_id: 'folder-load-10x400k', file_count: 10, file_bytes: 409600, batch_size: 1, settle_timeout_ms: 300000 }),
    folderProgressiveScenario({ id: 'folder-progressive-100', label: 'folder progressive load, 100 files of 8KB', metric_id: 'folder-load-100', file_count: 100, file_bytes: 8192, batch_size: DISCOVERY_BATCH_MAX_DOCS, settle_timeout_ms: 300000 }),
    folderProgressiveScenario({ id: 'folder-progressive-200', label: 'folder progressive load, 200 files of 8KB (the extension MAX_AGGREGATE_FILES cap)', metric_id: 'folder-load-200', file_count: 200, file_bytes: 8192, batch_size: DISCOVERY_BATCH_MAX_DOCS, settle_timeout_ms: 900000 }),
    folderInteractionScenario({
        id: 'folder-interactions-200',
        label: 'click, caret move and one-file merge on a settled 200-file board',
        file_count: 200,
        file_bytes: 8192,
        metric_ids: { click: 'folder-click-200', selection: 'folder-selection-200', merge: 'folder-merge-200' },
        settle_timeout_ms: 900000,
    }),
];

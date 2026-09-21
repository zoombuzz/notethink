import Debug from 'debug';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emitBoardCommit } from '../lib/boardCommitProbe';
import { anyViewInFolderMode, resolveIntegrationMode, FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/viewstateops';
import { INTEGRATION_MODE_FOLDER } from '../notethink-views/src/types/IntegrationMode';
import type { HashMapOf, Doc } from '../types/general';
import type { TextSelection } from '../notethink-views/src/types/NoteProps';
import type { SettingsCascadePayload, JumpTargetsMessage } from '../notethink-views/src/types/Messages';
import type { ViewState } from './usePersistedViewStates';

const debug = Debug("nodejs:notethink:useVscodeMessages");

/*
 * Ceiling on how long a queued message waits for its flush. requestAnimationFrame is the primary trigger,
 * but a hidden or backgrounded webview has its frames throttled or stopped altogether, and a message that
 * never commits is a worse failure than one that commits late - so this timeout races every frame request
 * and whichever fires first drains the queue.
 */
export const MESSAGE_FLUSH_FALLBACK_MS = 50;
// wire types whose handling is coalesced: the folder-load doc stream plus the pending sentinel bracketing it, so the spinner clears in the same commit as the docs it was covering. Every other type dispatches as it arrives.
const QUEUED_MESSAGE_TYPES: readonly string[] = ['update', 'docDeleted', 'pendingChange'];

// one wire-format message as it arrives from the extension, having passed isMessageValid; each consumer narrows the fields it reads
type WireMessage = { type: string; [key: string]: unknown };

interface SelectionState {
    [docPath: string]: TextSelection;
}

interface VscodeMessagesDeps {
    initial_docs: HashMapOf<Doc> | undefined;
    saved_view_states: Record<string, ViewState> | undefined;
    postMessage: (message: unknown) => void;
    markConnected: () => void;
    setSettingsCascade: (settings: SettingsCascadePayload) => void;
    updateAllViewStates: (updater: (view_state: ViewState) => ViewState) => void;
    setViewManagedState: (updates: Array<Record<string, unknown>>) => void;
    view_states_ref: React.MutableRefObject<Record<string, ViewState>>;
    navigation_callback_ref: React.MutableRefObject<((direction: string) => void) | undefined>;
    markPending: (key: string) => void;
    clearPending: (key: string) => void;
    setJumpTargets: (response: JumpTargetsMessage) => void;
}

/**
 * State exposed by useVscodeMessages: aggregated doc/selection/workspace state distilled from the wire-format messages the extension posts to the webview.
 * - active_editor_doc_path: path of the doc whose editor most recently emitted a selectionChanged or arrived on the activeEditorDoc channel - the closest proxy for "what the user is currently editing"
 * - active_doc: the active editor's full doc when it sits OUTSIDE the current folder scope, delivered on the dedicated activeEditorDoc channel because folder mode drops out-of-scope docs from the aggregate; lets useAutoIntegration read its declaration and follow the editor out of the folder
 */
interface VscodeMessagesState {
    docs: HashMapOf<Doc> | undefined;
    selections: SelectionState;
    active_editor_doc_path: string | undefined;
    active_doc: Doc | undefined;
    workspace_root: string;
    workspace_projects: string[];
    aggregate_total_discovered: number | undefined;
    includeFilter: string | undefined;
    excludeFilter: string | undefined;
}

// validate the message envelope and per-type payload; returns false (and warns) when the message must be discarded
function isMessageValid(message: { type?: unknown; [key: string]: unknown }): boolean {
    if (message === null || message === undefined || typeof message !== 'object' || typeof message.type !== 'string') {
        debug('discarding message with missing or invalid type %O', message);
        return false;
    }
    if (message.type === 'update') {
        const partial = message.partial as { docs?: unknown } | null | undefined;
        if (partial === null || partial === undefined || typeof partial !== 'object' || partial.docs === null || partial.docs === undefined || typeof partial.docs !== 'object') {
            debug('discarding update message with invalid partial.docs %O', message);
            return false;
        }
    }
    if (message.type === 'selectionChanged') {
        const selection = message.selection as { head?: unknown; anchor?: unknown } | null | undefined;
        // a null selection is the explicit "no editor owns this doc" clear signal and is valid; only a malformed non-null selection is discarded
        if (selection !== null && (selection === undefined || typeof selection !== 'object' || typeof selection.head !== 'number' || typeof selection.anchor !== 'number')) {
            debug('discarding selectionChanged message with invalid selection %O', message);
            return false;
        }
    }
    if (message.type === 'command') {
        if (typeof message.command !== 'string') {
            debug('discarding command message with invalid command %O', message);
            return false;
        }
    }
    if (message.type === 'settingsCascade') {
        if (message.settings === null || message.settings === undefined || typeof message.settings !== 'object') {
            debug('discarding settingsCascade message with invalid settings %O', message);
            return false;
        }
    }
    if (message.type === 'pendingChange') {
        if (typeof message.key !== 'string' || typeof message.on !== 'boolean') {
            debug('discarding pendingChange message with invalid key/on %O', message);
            return false;
        }
    }
    if (message.type === 'jumpTargets') {
        if (typeof message.mode !== 'string' || typeof message.path !== 'string' || !Array.isArray(message.entries)) {
            debug('discarding jumpTargets message with invalid mode/path/entries %O', message);
            return false;
        }
    }
    if (message.type === 'activeEditorDoc') {
        const doc = message.doc as { path?: unknown } | null | undefined;
        if (doc === null || doc === undefined || typeof doc !== 'object' || typeof doc.path !== 'string') {
            debug('discarding activeEditorDoc message with invalid doc %O', message);
            return false;
        }
    }
    return true;
}

/*
 * merge an incoming update payload into the current doc map; returns the previous map unchanged when no hashes differ
 * merge_strategy 'merge' upserts incoming docs (folder-mode incremental updates); anything else replaces the map entirely (single-file view, or folder-mode initial bulk load)
 */
function mergeUpdatedDocs(current: { docs?: HashMapOf<Doc> }, message: WireMessage): { docs?: HashMapOf<Doc> } {
    const incoming_docs = (message.partial as { docs?: HashMapOf<Doc> }).docs || {};
    const current_docs = current.docs || {};
    const merge_strategy = message.merge_strategy as string | undefined;
    if (merge_strategy === 'merge') {
        let has_changes = false;
        for (const [id, doc] of Object.entries(incoming_docs) as [string, Doc][]) {
            const existing = current_docs[id];
            if (!existing || !doc.hash_sha256 || existing.hash_sha256 !== doc.hash_sha256) {
                has_changes = true;
                break;
            }
        }
        if (!has_changes) {
            debug('skipping setState (merge), no doc hashes changed');
            return current;
        }
        return { ...current, docs: { ...current_docs, ...incoming_docs } };
    }
    let has_changes = Object.keys(incoming_docs).length !== Object.keys(current_docs).length;
    if (!has_changes) {
        for (const [id, doc] of Object.entries(incoming_docs) as [string, Doc][]) {
            const existing = current_docs[id];
            if (!existing || !doc.hash_sha256 || existing.hash_sha256 !== doc.hash_sha256) {
                has_changes = true;
                break;
            }
        }
    }
    if (!has_changes) {
        debug('skipping setState, no doc hashes changed');
        return current;
    }
    return { ...current, docs: incoming_docs };
}

// drop one doc by id; returns the map unchanged when the id is malformed or absent, so a tombstone for a doc the board never held commits nothing
function removeDeletedDoc(current: { docs?: HashMapOf<Doc> }, doc_id: unknown): { docs?: HashMapOf<Doc> } {
    if (typeof doc_id !== 'string') {
        debug('docDeleted with invalid docId %O', doc_id);
        return current;
    }
    if (!current.docs || !current.docs[doc_id]) { return current; }
    const next = { ...current.docs };
    delete next[doc_id];
    return { ...current, docs: next };
}

/*
 * fold every doc payload in one flush into a single doc map, so a batch of N messages commits once
 * order is preserved, so a tombstone that arrived after an update still wins, exactly as it does when each message commits on its own
 */
function applyDocMessages(current: { docs?: HashMapOf<Doc> }, queued: WireMessage[]): { docs?: HashMapOf<Doc> } {
    let next = current;
    for (const message of queued) {
        if (message.type === 'update') { next = mergeUpdatedDocs(next, message); }
        if (message.type === 'docDeleted') { next = removeDeletedDoc(next, message.docId); }
    }
    return next;
}

/*
 * Queue the doc-stream message types and drain them once per animation frame, so a burst of discovery
 * updates commits as one board render instead of N. Falls back to a MESSAGE_FLUSH_FALLBACK_MS timeout
 * for a hidden webview whose frames never fire.
 *
 * The drain is read through a ref so the returned enqueue identity never changes: the message listener
 * is installed once on mount and must not capture a stale drain.
 */
function useFrameFlushQueue(drain: (queued: WireMessage[]) => void): (message: WireMessage) => void {
    const queue = useRef<WireMessage[]>([]);
    const frame_handle = useRef<number | undefined>(undefined);
    const fallback_handle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const drain_ref = useRef(drain);
    drain_ref.current = drain;
    const cancelScheduledFlush = useCallback((): void => {
        if (frame_handle.current !== undefined) {
            cancelAnimationFrame(frame_handle.current);
            frame_handle.current = undefined;
        }
        if (fallback_handle.current !== undefined) {
            clearTimeout(fallback_handle.current);
            fallback_handle.current = undefined;
        }
    }, []);
    const flush = useCallback((): void => {
        cancelScheduledFlush();
        const queued = queue.current;
        queue.current = [];
        if (queued.length === 0) { return; }
        debug('draining %d queued messages', queued.length);
        drain_ref.current(queued);
    }, [cancelScheduledFlush]);
    const enqueue = useCallback((message: WireMessage): void => {
        queue.current.push(message);
        if (frame_handle.current === undefined && typeof requestAnimationFrame === 'function') {
            frame_handle.current = requestAnimationFrame(flush);
        }
        if (fallback_handle.current === undefined) {
            fallback_handle.current = setTimeout(flush, MESSAGE_FLUSH_FALLBACK_MS);
        }
    }, [flush]);
    // drop anything still queued on unmount: the panel is going away, so a late commit has nothing to render into
    useEffect(() => cancelScheduledFlush, [cancelScheduledFlush]);
    return enqueue;
}

/*
 * own the core doc/selection/workspace state, the host message listener, and the dispatch
 * the message-type string literals ('update', 'activeEditorDoc', 'selectionChanged', 'command', 'settingsCascade', 'jumpTargets') are the on-the-wire contract and must stay exactly as-is
 *
 * Validation runs on arrival, on every message, unchanged. What is deferred is the handling of the
 * QUEUED_MESSAGE_TYPES: they commit once per animation frame, so a folder load's doc stream costs one
 * board render per frame rather than one per file. 'pendingChange' rides the same queue deliberately -
 * the extension clears the discovery sentinel immediately after the aggregate payload, and dispatching
 * that clear ahead of the docs it covers would drop the spinner a frame before the board filled.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useVscodeMessages(deps: VscodeMessagesDeps): VscodeMessagesState {
    const { postMessage, markConnected, setSettingsCascade, updateAllViewStates, setViewManagedState, view_states_ref, navigation_callback_ref, saved_view_states, markPending, clearPending, setJumpTargets } = deps;
    const [docs_state, setDocsState] = useState<{ docs?: HashMapOf<Doc> }>({ docs: deps.initial_docs || {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [active_editor_doc_path, setActiveEditorDocPath] = useState<string | undefined>(undefined);
    // folder mode: the active editor's doc when it sits outside integration_path or the folder filters reject it, delivered on the activeEditorDoc channel (sendDoc drops it from the aggregate) so useAutoIntegration can read its declaration and exit a folder the editor has left
    const [active_doc, setActiveDoc] = useState<Doc | undefined>(undefined);
    const [workspace_root, setWorkspaceRoot] = useState<string>('');
    const [workspace_projects, setWorkspaceProjects] = useState<string[]>([]);
    // folder mode: total .md files discovered before the extension's MAX_AGGREGATE_FILES cap truncated the loaded set (drives the "(N of M)" breadcrumb)
    const [aggregate_total_discovered, setAggregateTotalDiscovered] = useState<number | undefined>(undefined);
    // folder mode: the effective include/exclude globs the extension is using, echoed back so the Files drawer can show them
    const [includeFilter, setIncludeFilter] = useState<string | undefined>(undefined);
    const [excludeFilter, setExcludeFilter] = useState<string | undefined>(undefined);
    // wire messages folded into the board commit that has not landed yet; the probe effect below reads and resets it
    const pending_message_count = useRef(0);
    // scalar payload an update carries alongside its docs: workspace identity, discovery totals and the echoed filters
    const applyUpdateMetadata = useCallback((message: WireMessage): void => {
        if (message.workspace_root) {
            setWorkspaceRoot(message.workspace_root as string);
        }
        if (Array.isArray(message.workspace_projects)) {
            setWorkspaceProjects((message.workspace_projects as unknown[]).filter((p): p is string => typeof p === 'string'));
        }
        if (message.extension_version) {
            (window as unknown as Record<string, unknown>).__NOTETHINK_EXTENSION_VERSION__ = message.extension_version;
        }
        if (typeof message.aggregate_total_discovered === 'number') {
            setAggregateTotalDiscovered(message.aggregate_total_discovered);
        }
        if (typeof message.includeFilter === 'string') {
            setIncludeFilter(message.includeFilter);
        }
        if (typeof message.excludeFilter === 'string') {
            setExcludeFilter(message.excludeFilter);
        }
        // a bulk replace update (no merge_strategy) carrying aggregate totals is the apply-filters round-trip echo; clear the filter-edit sentinel so the spinner drops once the new file set has landed
        if (!message.merge_strategy && typeof message.aggregate_total_discovered === 'number') {
            clearPending('integrationFilters');
        }
    }, [clearPending]);
    /*
     * apply one flush: each message's non-doc side effects in arrival order, then a single setDocsState
     * folding every doc payload in the batch, which React commits as one board render
     */
    const drainMessageQueue = useCallback((queued: WireMessage[]): void => {
        for (const message of queued) {
            if (message.type === 'update') { applyUpdateMetadata(message); }
            if (message.type === 'pendingChange') {
                if (message.on) { markPending(message.key as string); } else { clearPending(message.key as string); }
            }
        }
        pending_message_count.current += queued.length;
        setDocsState(current => applyDocMessages(current, queued));
    }, [applyUpdateMetadata, markPending, clearPending]);
    const enqueueMessage = useFrameFlushQueue(drainMessageQueue);
    // one probe event per board commit, carrying how many wire messages it folded; a no-op unless a test or the perf harness enabled the probe
    useEffect(() => {
        if (pending_message_count.current === 0) { return; }
        emitBoardCommit({
            messages: pending_message_count.current,
            docs: Object.keys(docs_state.docs ?? {}).length,
            at: performance.now(),
        });
        pending_message_count.current = 0;
    }, [docs_state]);
    // dispatch a validated command message to the appropriate viewState mutation / navigation
    const handleCommand = useCallback((message: { command: string; viewType?: string; direction?: string; mode?: string; path?: string }) => {
        debug('received command %s', message.command);
        switch (message.command) {
            case 'setIntegrationScope':
                /*
                 * host-originated folder scope, sent only for a docless open (Open Viewer with no .md file active), where nothing else can seed one
                 * resolveIntegrationMode defaults an unseeded view state to current_file and the aggregate `update` payload carries no scope to infer from, so without this the board renders an arbitrary file out of the folder's docs instead of the folder
                 */
                if (message.mode !== INTEGRATION_MODE_FOLDER || !message.path) { return; }
                // never stomp a scope the webview already owns - state restored from a reload, or a mode the user pinned
                if (anyViewInFolderMode(view_states_ref.current)) { return; }
                setViewManagedState([{
                    id: FOLDER_VIEW_STATE_ID,
                    // concrete 'folder' rather than 'auto': the scope came from the workspace, not from any file's declaration, so the auto reconcile must not re-derive it from whichever doc the aggregate happens to surface
                    display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: message.path },
                }]);
                return;
            case 'setViewType':
                updateAllViewStates(view_state => ({ ...view_state, type: message.viewType }));
                // the cascade owns viewType in every integration mode, so this never branches on mode
                postMessage({ type: 'updateSetting', setting: 'viewType', value: message.viewType });
                return;
            case 'navigate':
                if (navigation_callback_ref.current && message.direction) {
                    navigation_callback_ref.current(message.direction);
                }
                return;
        }
    }, [postMessage, updateAllViewStates, setViewManagedState, view_states_ref, navigation_callback_ref]);
    const onMessage = useCallback((event: MessageEvent) => {
        const message = event.data;
        // any message from the extension host proves it's alive
        markConnected();
        if (!isMessageValid(message)) { return; }
        debug('onMessage %s', message.type);
        // the folder-load doc stream and its pending sentinel are coalesced into one commit per animation frame; everything else lands as it arrives
        if (QUEUED_MESSAGE_TYPES.includes(message.type)) {
            enqueueMessage(message as WireMessage);
            return;
        }
        switch (message.type) {
            case 'activeEditorDoc':
                debug('received activeEditorDoc for %s', (message.doc as Doc).path);
                setActiveDoc(message.doc as Doc);
                // the out-of-scope active editor never enters the folder aggregate, so record it as the active path here too (the selectionChanged echo also sets this, but cross-message ordering is not guaranteed)
                setActiveEditorDocPath((message.doc as Doc).path);
                return;
            case 'selectionChanged':
                debug('received selectionChanged for %s', message.docPath);
                if (message.selection === null) {
                    // no editor owns this doc's caret: drop its selection so the board's virtual caret drives focus/select
                    setSelections(prev => {
                        const next = { ...prev };
                        delete next[message.docPath];
                        return next;
                    });
                    return;
                }
                setSelections(prev => ({
                    ...prev,
                    [message.docPath]: {
                        main: {
                            head: message.selection.head,
                            anchor: message.selection.anchor,
                        },
                    },
                }));
                // the doc whose selection just changed is the active editor - folder mode's per-doc matcher reads this to scope the caret-to-note resolution
                setActiveEditorDocPath(message.docPath);
                return;
            case 'settingsCascade':
                debug('received settingsCascade %O', message.settings);
                setSettingsCascade(message.settings as SettingsCascadePayload);
                // echo confirms the cascade round-trip completed; clear any marks for each cascade key and the aggregate 'settingsCascade' sentinel
                clearPending('settingsCascade');
                for (const key of Object.keys((message.settings as SettingsCascadePayload) ?? {})) {
                    clearPending(key);
                }
                return;
            case 'jumpTargets':
                debug('received jumpTargets mode=%s path=%s', message.mode, message.path);
                setJumpTargets(message as JumpTargetsMessage);
                return;
            case 'command':
                handleCommand(message);
                return;
        }
    }, [markConnected, setSettingsCascade, handleCommand, enqueueMessage, clearPending, setJumpTargets]);
    // listen for messages sent from the extension to the webview
    useEffect(() => {
        window.addEventListener('message', onMessage);
        debug('added message event listener');
        /*
         * if saved state shows we were in folder mode, re-establish the integration first
         * sending setIntegration before requestInitialState lets the extension synchronously set integration_path before the async findFiles - so when the requestInitialState handler runs sendDoc it uses merge_strategy='merge' and upserts into the saved folder docs map instead of replacing it
         */
        if (saved_view_states) {
            for (const id of Object.keys(saved_view_states)) {
                const vs = saved_view_states[id];
                // restore folder for a concrete folder pin AND for an `auto` view whose path was seeded by auto-resolution (resolveIntegrationMode treats auto + a path as folder), so an auto-folder file re-aggregates on reload without a flash through current_file
                if (resolveIntegrationMode(vs?.display_options) === INTEGRATION_MODE_FOLDER && vs?.display_options?.integration_path) {
                    debug('restoring folder integration on reload: %s', vs.display_options.integration_path);
                    /*
                     * host re-validates this path against the workspace before acting - persisted webview state is untrusted (defense-in-depth)
                     * do NOT replay the persisted includeFilter / excludeFilter here: the workspace cascade (notethink.settings.files.*) is the source of truth, and replaying a snapshot from an earlier session masks any later edit the user made in settings.json. handle_apply_filters writes user-applied filters through to the cascade, so the cascade is always up to date with the user's intent after a fresh Apply
                     */
                    postMessage({
                        type: 'setIntegration',
                        mode: INTEGRATION_MODE_FOLDER,
                        path: vs.display_options.integration_path,
                    });
                    break;
                }
            }
        }
        /*
         * request initial state - this is what triggers the extension to send the active doc (and selection + the settings cascade)
         * sent after setIntegration so the extension has integration_path set by the time it runs sendDoc here
         */
        postMessage({
            type: 'requestInitialState',
        });
        return () => {
            debug('removed message event listener');
            window.removeEventListener('message', onMessage);
        };
        // mount-once listener: onMessage's deps (setters, stable handleCommand, and an enqueue whose drain is read through a ref) never go stale, so empty deps is correct
    }, []);
    return {
        docs: docs_state.docs,
        selections,
        active_editor_doc_path,
        active_doc,
        workspace_root,
        workspace_projects,
        aggregate_total_discovered,
        includeFilter,
        excludeFilter,
    };
}

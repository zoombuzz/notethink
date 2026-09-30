import Debug from 'debug';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emitBoardCommit } from '../lib/boardCommitProbe';
import { useWorkerParsedDocs } from './useWorkerParsedDocs';
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
// types coalesced into one flush: the doc stream and its bracketing pending sentinel, so the spinner clears with the docs
const QUEUED_MESSAGE_TYPES: readonly string[] = ['update', 'docDeleted', 'pendingChange'];

// a wire message that has passed isMessageValid; each consumer narrows the fields it reads
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
        // null selection is a valid "no editor owns this doc" clear signal; only a malformed non-null one is discarded
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
 * True when `incoming` carries content or text `existing` lacks: a hash match alone doesn't mean
 * unchanged, since a doc can be held metadata-only or text-only ahead of its worker parse. Without
 * this, the fast path locks onto whichever shape arrived first and drops a fuller resend.
 */
function docGainsBody(existing: Doc, incoming: Doc): boolean {
    return (incoming.content !== undefined && existing.content === undefined)
        || (incoming.text !== undefined && existing.text === undefined);
}

// true unless `doc` is a same-or-lesser copy of `existing` (same hash, no more body)
function docSupersedes(existing: Doc | undefined, doc: Doc): boolean {
    if (!existing || !doc.hash_sha256 || existing.hash_sha256 !== doc.hash_sha256) { return true; }
    return docGainsBody(existing, doc);
}

/**
 * Merges an incoming update into the doc map, returning the same reference when no hash changed.
 * `merge_strategy: 'merge'` upserts (folder-mode incremental); anything else replaces the whole map.
 */
function mergeUpdatedDocs(current: { docs?: HashMapOf<Doc> }, message: WireMessage): { docs?: HashMapOf<Doc> } {
    const incoming_docs = (message.partial as { docs?: HashMapOf<Doc> }).docs || {};
    const current_docs = current.docs || {};
    const merge_strategy = message.merge_strategy as string | undefined;
    if (merge_strategy === 'merge') {
        let has_changes = false;
        for (const [id, doc] of Object.entries(incoming_docs) as [string, Doc][]) {
            if (docSupersedes(current_docs[id], doc)) {
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
            if (docSupersedes(current_docs[id], doc)) {
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

// drops one doc by id; unchanged if the id is malformed or the board never held it
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

/**
 * Folds every doc payload in one flush into a single map. Order is preserved, so a later tombstone
 * still wins over an earlier update, as it would committing each message on its own.
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

/**
 * Owns the doc/selection/workspace state, the host message listener, and dispatch. The message-type
 * string literals are the on-the-wire contract and must stay exactly as-is. QUEUED_MESSAGE_TYPES batch
 * per animation frame, so a folder load's doc stream costs one board render per frame, not per file.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function useVscodeMessages(deps: VscodeMessagesDeps): VscodeMessagesState {
    const { postMessage, markConnected, setSettingsCascade, updateAllViewStates, setViewManagedState, view_states_ref, navigation_callback_ref, saved_view_states, markPending, clearPending, setJumpTargets } = deps;
    const [docs_state, setDocsState] = useState<{ docs?: HashMapOf<Doc> }>({ docs: deps.initial_docs || {} });
    const [selections, setSelections] = useState<SelectionState>({});
    const [active_editor_doc_path, setActiveEditorDocPath] = useState<string | undefined>(undefined);
    // out-of-scope active editor's doc; sendDoc excludes it from the aggregate, so it arrives via activeEditorDoc
    const [active_doc, setActiveDoc] = useState<Doc | undefined>(undefined);
    const [workspace_root, setWorkspaceRoot] = useState<string>('');
    const [workspace_projects, setWorkspaceProjects] = useState<string[]>([]);
    // total files discovered before MAX_AGGREGATE_FILES truncated the set; drives the "(N of M)" breadcrumb
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
        // a bulk-replace update carrying aggregate totals is the apply-filters echo; clears the filter-edit sentinel
        if (!message.merge_strategy && typeof message.aggregate_total_discovered === 'number') {
            clearPending('integrationFilters');
        }
    }, [clearPending]);
    // applies one flush: non-doc side effects in order, then one setDocsState folding the batch into one render
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
    // one probe event per commit, counting folded messages; no-op unless a test or perf harness enabled it
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
                // host folder scope for a docless open; without it an unseeded view state falls back to an arbitrary file
                if (message.mode !== INTEGRATION_MODE_FOLDER || !message.path) { return; }
                // never stomp a scope the webview already owns - state restored from a reload, or a mode the user pinned
                if (anyViewInFolderMode(view_states_ref.current)) { return; }
                setViewManagedState([{
                    id: FOLDER_VIEW_STATE_ID,
                    // concrete 'folder', not 'auto': the scope is workspace-sourced, so auto reconcile must not re-derive it
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
        // doc stream and its pending sentinel coalesce into one commit per frame; everything else dispatches immediately
        if (QUEUED_MESSAGE_TYPES.includes(message.type)) {
            enqueueMessage(message as WireMessage);
            return;
        }
        switch (message.type) {
            case 'activeEditorDoc':
                debug('received activeEditorDoc for %s', (message.doc as Doc).path);
                setActiveDoc(message.doc as Doc);
                // out-of-scope editor never enters the aggregate, so record its path here too; message order isn't guaranteed
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
                // the doc whose selection changed is the active editor; folder mode's per-doc matcher scopes to it
                setActiveEditorDocPath(message.docPath);
                return;
            case 'settingsCascade':
                debug('received settingsCascade %O', message.settings);
                setSettingsCascade(message.settings as SettingsCascadePayload);
                // echo confirms the round-trip; clears marks for each cascade key and the aggregate sentinel
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
        // setIntegration before requestInitialState sets integration_path ahead of findFiles, so sendDoc merges
        if (saved_view_states) {
            for (const id of Object.keys(saved_view_states)) {
                const vs = saved_view_states[id];
                // covers a pinned folder and an auto-resolved one, so a folder file re-aggregates without flashing current_file
                if (resolveIntegrationMode(vs?.display_options) === INTEGRATION_MODE_FOLDER && vs?.display_options?.integration_path) {
                    debug('restoring folder integration on reload: %s', vs.display_options.integration_path);
                    // host re-validates this persisted path; filters are not replayed, since the settings cascade stays current
                    postMessage({
                        type: 'setIntegration',
                        mode: INTEGRATION_MODE_FOLDER,
                        path: vs.display_options.integration_path,
                    });
                    break;
                }
            }
        }
        // requests active doc, selection and settings cascade after integration_path is set for sendDoc
        postMessage({
            type: 'requestInitialState',
        });
        return () => {
            debug('removed message event listener');
            window.removeEventListener('message', onMessage);
        };
        // mount-once listener: onMessage's deps never go stale, since enqueue's drain is read through a ref
    }, []);
    // fills in `content` for a folder-mode doc so downstream reads docs[id].content like any other doc
    const parsed_docs = useWorkerParsedDocs(docs_state.docs);
    return {
        docs: parsed_docs,
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

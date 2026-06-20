import Debug from "debug";
import { useEffect, useMemo, useRef } from "react";
import { decideAutoIntegrationReconcile, declTargetKey, pickMostRecentlySentDoc, resolveFileIntegrationDeclaration, type FileIntegrationDeclaration } from "../lib/docops";
import { buildIntegrationDispatch, FOLDER_VIEW_STATE_ID, resolveIntegrationMode } from "../notethink-views/src/lib/viewstateops";
import { INTEGRATION_MODE_CURRENT_FILE } from "../notethink-views/src/types/IntegrationMode";
import type { HashMapOf, Doc } from "../types/general";
import type { ViewState } from "./usePersistedViewStates";

const debug = Debug("nodejs:notethink:useAutoIntegration");

interface UseAutoIntegrationDeps {
    docs: HashMapOf<Doc> | undefined;
    active_editor_doc_path: string | undefined;
    workspace_root: string;
    view_states_ref: React.MutableRefObject<Record<string, ViewState>>;
    postMessage: (message: unknown) => void;
    setViewManagedState: (updates: Array<Record<string, unknown>>) => void;
}

// the opened doc whose H1 declares the integration intent: the active-editor doc when present in the map, else the most-recently-sent doc (the extension's notion of active); in current_file mode this is the single rendered doc, in folder mode it follows whichever file the editor is in
function pickOpenedDoc(docs: HashMapOf<Doc> | undefined, active_editor_doc_path: string | undefined): Doc | undefined {
    if (!docs) { return undefined; }
    if (active_editor_doc_path) {
        const match = Object.values(docs).find(d => d.path === active_editor_doc_path);
        if (match) { return match; }
    }
    return pickMostRecentlySentDoc(docs)?.note;
}

/**
 * Drive integration-mode auto-resolution at the App layer the same reactive way AutoView drives view
 * type: derive the active file's declared integration target (nt_integration_mode / nt_breadcrumb_last)
 * every render, then reconcile it against the persisted folder view-state. Unlike a one-shot effect,
 * this is bidirectional - it ENTERs folder mode for a folder-declaring file, EXITs to current_file when
 * the active editor switches to a plain file (or the active file edits its declaration away), and
 * re-snaps when the active file declares a different folder - so switching the active editor or editing
 * a linetag updates the board live, exactly like editing nt_view. Returns the declaration so it can be
 * threaded into the view for the congruence-seeking navigation handlers.
 *
 * Reconcile keying (so the reactive follow does not fight in-board navigation):
 *  - the effect tracks the last opened-doc id + last derived declaration target across runs
 *  - an active-file switch or a tag edit (the target changed) may re-snap / enter / exit
 *  - an in-board breadcrumb descent (persisted path changed, declaration unchanged) is preserved
 *  - a concrete persisted integration_mode (user pinned folder / current_file) is never overridden
 *
 * decideAutoIntegrationReconcile owns the decision (pure, unit-tested); buildIntegrationDispatch
 * (shared with the toolbar's handle_integration_change) builds the view-state updates + setIntegration
 * payload, so the reactive path and the toolbar path cannot drift.
 */
export function useAutoIntegration(deps: UseAutoIntegrationDeps): FileIntegrationDeclaration | undefined {
    const { docs, active_editor_doc_path, workspace_root, view_states_ref, postMessage, setViewManagedState } = deps;
    const opened_doc = useMemo(
        () => pickOpenedDoc(docs, active_editor_doc_path),
        [docs, active_editor_doc_path],
    );
    const file_declared_integration = useMemo(
        () => (opened_doc ? resolveFileIntegrationDeclaration(opened_doc, workspace_root) : undefined),
        [opened_doc?.id, opened_doc?.hash_sha256, workspace_root],
    );
    // last opened-doc id + last derived target, so the reconcile tells an active-file switch / tag edit (re-derive) apart from in-board navigation (declaration unchanged); both stay undefined until the first reconcile so a pre-existing navigated path is preserved on mount rather than re-snapped
    const last_opened_id_ref = useRef<string | undefined>(undefined);
    const last_decl_target_ref = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!opened_doc || !file_declared_integration) { return; }
        const decl = file_declared_integration;
        const decl_target = declTargetKey(decl);
        const prior_opened_id = last_opened_id_ref.current;
        const is_cold = prior_opened_id === undefined;
        const active_file_changed = !is_cold && prior_opened_id !== opened_doc.id;
        const decl_changed = !is_cold && last_decl_target_ref.current !== decl_target;
        // record for the next run regardless of whether we dispatch - transitions are detected across runs
        last_opened_id_ref.current = opened_doc.id;
        last_decl_target_ref.current = decl_target;
        const folder_options = view_states_ref.current?.[FOLDER_VIEW_STATE_ID]?.display_options;
        const action = decideAutoIntegrationReconcile({
            decl,
            // the inside/outside-scope exit gate keys on where the active editor actually is; prefer active_editor_doc_path (the true caret location) over a most-recently-sent fallback whose path may differ
            opened_doc_path: active_editor_doc_path ?? opened_doc.path,
            persisted_raw_mode: folder_options?.integration_mode,
            persisted_concrete: resolveIntegrationMode(folder_options),
            persisted_path: folder_options?.integration_path,
            active_file_changed,
            decl_changed,
        });
        if (!action) { return; }
        debug('auto-reconcile -> %s %s', action.resolved_mode, action.folder_path ?? '');
        const { updates, message } = buildIntegrationDispatch({
            is_auto: true,
            resolved_mode: action.resolved_mode,
            folder_path: action.folder_path,
            seed_parent_context_seq: action.resolved_mode === INTEGRATION_MODE_CURRENT_FILE ? decl.parent_context_seq : undefined,
            view_id: opened_doc.id,
            view_state_ids: Object.keys(view_states_ref.current ?? {}),
        });
        setViewManagedState(updates);
        if (message) { postMessage(message); }
    }, [opened_doc, file_declared_integration, active_editor_doc_path, view_states_ref, postMessage, setViewManagedState]);
    return file_declared_integration;
}

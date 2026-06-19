import Debug from "debug";
import { useEffect, useMemo, useRef } from "react";
import { resolveFileIntegrationDeclaration, pickMostRecentlySentDoc, type FileIntegrationDeclaration } from "../lib/docops";
import { FOLDER_VIEW_STATE_ID, resolveIntegrationMode } from "../notethink-views/src/lib/viewstateops";
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from "../notethink-views/src/types/IntegrationMode";
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
 * Drive integration-mode auto-resolution at the App layer. Computes the opened file's declared
 * integration intent (mirrors view-type auto) and, on doc-arrival, dispatches the first
 * setIntegration / parent_context_seq seed when the view is still automatic - so a file that
 * declares folder mode (plus an nt_breadcrumb_last scope) lands on the intended aggregate view
 * without a manual toolbar switch. Returns the declaration so it can be threaded into the view
 * for the congruence-seeking navigation handlers.
 *
 * Rules:
 *  - a concrete persisted integration_mode (user pinned folder / current_file) is never overridden
 *  - the path is seeded only when the view is not already folder (cold open) - auto re-resolves the
 *    mode but never re-snaps a folder the user has since navigated to (the persisted path wins)
 *  - resolution fires once per opened-doc identity (content hash) so re-renders don't re-aggregate
 *  - an unrecognised / unmatched declaration degrades to current_file with no dispatch
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
    // once-per-opened-doc guard (keyed on id + content hash) so the effect dispatches a single time
    const resolved_for_ref = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!opened_doc || !file_declared_integration) { return; }
        const guard_key = `${opened_doc.id}:${opened_doc.hash_sha256 ?? ''}`;
        if (resolved_for_ref.current === guard_key) { return; }
        const view_states = view_states_ref.current;
        const folder_options = view_states?.[FOLDER_VIEW_STATE_ID]?.display_options;
        const persisted_mode = folder_options?.integration_mode;
        // a concrete persisted mode is an explicit user pin - auto no longer applies
        if (persisted_mode === INTEGRATION_MODE_FOLDER || persisted_mode === INTEGRATION_MODE_CURRENT_FILE) {
            resolved_for_ref.current = guard_key;
            return;
        }
        resolved_for_ref.current = guard_key;
        const decl = file_declared_integration;
        if (decl.mode === INTEGRATION_MODE_FOLDER && decl.integration_path) {
            // seed the folder scope only when not already in folder mode (cold open); a reload with a navigated path is already folder, and its persisted path must be preserved
            if (resolveIntegrationMode(folder_options) !== INTEGRATION_MODE_FOLDER) {
                debug('auto-resolving opened file to folder mode at %s', decl.integration_path);
                setViewManagedState([{
                    id: FOLDER_VIEW_STATE_ID,
                    display_options: { integration_mode: INTEGRATION_MODE_AUTO, integration_path: decl.integration_path },
                }]);
                postMessage({ type: 'setIntegration', mode: INTEGRATION_MODE_FOLDER, path: decl.integration_path });
            }
            return;
        }
        // only seed the note-hierarchy scope when the view actually resolves to current_file - in folder mode the per-doc entry NoteTreeComposer would read is never rendered (FolderTreeComposer owns the tree), so the write would be dead state
        if (decl.mode === INTEGRATION_MODE_CURRENT_FILE && decl.parent_context_seq !== undefined
            && resolveIntegrationMode(folder_options) !== INTEGRATION_MODE_FOLDER) {
            // seed the note-hierarchy scope once, only when the user has not navigated it already
            const doc_options = view_states?.[opened_doc.id]?.display_options;
            if (doc_options?.parent_context_seq === undefined) {
                debug('auto-seeding parent_context_seq=%d from breadcrumb_last', decl.parent_context_seq);
                setViewManagedState([{
                    id: opened_doc.id,
                    display_options: { parent_context_seq: decl.parent_context_seq },
                }]);
            }
        }
    }, [opened_doc, file_declared_integration, view_states_ref, postMessage, setViewManagedState]);
    return file_declared_integration;
}

import Debug from "debug";
import { convertMdastToNoteHierarchy } from "../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { findFileH1 } from "../notethink-views/src/lib/mergeAggregateRoot";
import { resolveNamespacedTag } from "../notethink-views/src/lib/linetagops";
import { breadcrumbSeqForLabel, flattenAllNotes } from "../notethink-views/src/lib/noteops";
import { isPathWithinFolder, parentFolderOf, resolveBreadcrumbFolderSegment } from "../notethink-views/src/lib/pathops";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode } from "../notethink-views/src/types/IntegrationMode";
import type { HashMapOf, Doc } from "../types/general";

const debug = Debug("nodejs:notethink:docops");

/**
 * FileIntegrationDeclaration is the opened file's declared opening intent, read from its H1
 * (then front-matter root) nt_integration_mode / nt_breadcrumb_last linetags.
 * - mode: the concrete integration mode the file declares (never 'auto')
 * - integration_path: the folder to scope aggregation to (folder mode only) - the nt_breadcrumb_last
 *   folder segment when it matched, else the file's own parent folder
 * - parent_context_seq: the note-hierarchy depth to open scoped to (current_file mode only), seeded
 *   from an nt_breadcrumb_last epic/story label
 */
export interface FileIntegrationDeclaration {
    mode: ConcreteIntegrationMode;
    integration_path?: string;
    parent_context_seq?: number;
}

/**
 * AutoReconcileInputs are the snapshot the reactive auto-integration reconcile decides on.
 * - decl: the active file's resolved integration declaration (the derived target)
 * - opened_doc_path: the active file's absolute path (the inside/outside-scope exit gate)
 * - persisted_raw_mode: the canonical folder viewState's raw integration_mode (folder / current_file
 *   here is an explicit user pin auto must never override; 'auto' / absent keeps following the file)
 * - persisted_concrete: that viewState resolved to its concrete mode (folder when a path was seeded)
 * - persisted_path: the seeded / navigated folder scope
 * - active_file_changed: the active editor moved to a DIFFERENT doc since the last reconcile (false
 *   on the first reconcile of a mount, so a pre-existing navigated path is preserved, not re-snapped)
 * - decl_changed: the derived target (mode + path) changed since the last reconcile, e.g. the active
 *   file edited its nt_integration_mode / nt_breadcrumb_last (also false on the first reconcile)
 */
export interface AutoReconcileInputs {
    decl: FileIntegrationDeclaration;
    opened_doc_path: string | undefined;
    persisted_raw_mode: string | undefined;
    persisted_concrete: ConcreteIntegrationMode;
    persisted_path: string | undefined;
    active_file_changed: boolean;
    decl_changed: boolean;
}

/**
 * AutoReconcileAction is the concrete mode + folder scope the reconcile should apply (via the shared
 * buildIntegrationDispatch), or null to leave the persisted state untouched.
 */
export interface AutoReconcileAction {
    resolved_mode: ConcreteIntegrationMode;
    folder_path: string | undefined;
}

/**
 * Decide, purely, what the reactive auto-integration reconcile should do for the current active file.
 * This is the bidirectional, idempotent counterpart to AutoView's render-time view-type derivation:
 * it derives the target mode/scope from the active file's declaration and reconciles it against the
 * persisted state, returning the change to apply (or null for none). The hook keys re-runs on the
 * derived target, so calling this every render with an unchanged target is a no-op.
 *
 * Rules:
 *  - a concrete persisted integration_mode (user pinned folder / current_file) is never overridden
 *  - decl folder + persisted current_file: ENTER the declared folder (cold open / reactive add of a
 *    folder declaration)
 *  - decl folder + persisted folder: re-snap to the declared folder ONLY when the declaration source
 *    changed (active file switched, or its tags edited); otherwise preserve the navigated path (a
 *    breadcrumb descent within the same file is never yanked back)
 *  - decl current_file + persisted folder: EXIT to current_file when the active file edited its own
 *    declaration away from folder, OR the active editor switched to a file OUTSIDE the current scope;
 *    a member file revealed INSIDE the scope (a card click) keeps the board
 */
export function decideAutoIntegrationReconcile(inputs: AutoReconcileInputs): AutoReconcileAction | null {
    const { decl, opened_doc_path, persisted_raw_mode, persisted_concrete, persisted_path, active_file_changed, decl_changed } = inputs;
    if (persisted_raw_mode === INTEGRATION_MODE_FOLDER || persisted_raw_mode === INTEGRATION_MODE_CURRENT_FILE) { return null; }
    if (decl.mode === INTEGRATION_MODE_FOLDER) {
        if (persisted_concrete === INTEGRATION_MODE_CURRENT_FILE) {
            return decl.integration_path ? { resolved_mode: INTEGRATION_MODE_FOLDER, folder_path: decl.integration_path } : null;
        }
        // persisted folder: re-snap to the file's declared folder only when the declaration source moved
        if (decl.integration_path && decl.integration_path !== persisted_path && (active_file_changed || decl_changed)) {
            return { resolved_mode: INTEGRATION_MODE_FOLDER, folder_path: decl.integration_path };
        }
        return null;
    }
    // decl current_file
    if (persisted_concrete === INTEGRATION_MODE_FOLDER) {
        if (decl_changed && !active_file_changed) { return { resolved_mode: INTEGRATION_MODE_CURRENT_FILE, folder_path: undefined }; }
        if (active_file_changed && !isPathWithinFolder(opened_doc_path, persisted_path)) {
            return { resolved_mode: INTEGRATION_MODE_CURRENT_FILE, folder_path: undefined };
        }
    }
    return null;
}

/**
 * Stable string key for a declaration's derived target (mode + folder scope). Two declarations that
 * resolve the same board are equal under this key, so a content edit that does not touch the
 * integration tags reads as "declaration unchanged" and never re-snaps a navigated folder.
 */
export function declTargetKey(decl: FileIntegrationDeclaration): string {
    return `${decl.mode}:${decl.integration_path ?? ''}`;
}

// the only authored nt_integration_mode values; 'auto' is a webview view-state value, never authored
const VALID_AUTHORED_MODES: ReadonlySet<string> = new Set<string>([INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER]);

/**
 * Resolve the opened file's integration declaration from its H1 / front-matter linetags, mirroring
 * how mergeAggregateRoot reads file_view_type (H1 nt_view over front-matter). This is a per-opened-file
 * directive, read only from the file the user opened - never majority-voted across a folder.
 *
 * Resolution: nt_integration_mode is validated against current_file / folder (anything else is
 * debug-logged and ignored, degrading to current_file). nt_breadcrumb_last is matched first as a
 * folder segment of the file's path trail (deepest match wins) - a folder match implies folder mode
 * even when nt_integration_mode is absent - then as an epic/story headline (seeding
 * parent_context_seq). Folder mode always carries a scope path (the matched segment, else the file's
 * own folder); a note seq is single-file-only and is dropped in folder mode (it does not address the
 * merged tree). Never throws - a parse failure degrades to current_file with a debug line.
 */
export function resolveFileIntegrationDeclaration(doc: Doc | undefined, workspace_root?: string): FileIntegrationDeclaration {
    const fallback: FileIntegrationDeclaration = { mode: INTEGRATION_MODE_CURRENT_FILE };
    if (!doc?.content || doc.text === undefined) { return fallback; }
    let root;
    try {
        root = convertMdastToNoteHierarchy(doc.content, doc.text);
    } catch (err) {
        debug('failed to parse doc for integration declaration: %O', err);
        return fallback;
    }
    const h1 = findFileH1(root);
    const raw_mode = resolveNamespacedTag(h1?.linetags, 'integration_mode')?.value
        ?? resolveNamespacedTag(root.linetags, 'integration_mode')?.value;
    let mode: ConcreteIntegrationMode = INTEGRATION_MODE_CURRENT_FILE;
    if (raw_mode !== undefined) {
        if (VALID_AUTHORED_MODES.has(raw_mode)) { mode = raw_mode as ConcreteIntegrationMode; }
        else { debug('ignoring unrecognised nt_integration_mode=%s', raw_mode); }
    }
    const breadcrumb_last = resolveNamespacedTag(h1?.linetags, 'breadcrumb_last')?.value
        ?? resolveNamespacedTag(root.linetags, 'breadcrumb_last')?.value;
    let integration_path: string | undefined;
    let parent_context_seq: number | undefined;
    if (breadcrumb_last) {
        const folder_segment = resolveBreadcrumbFolderSegment(breadcrumb_last, doc.path, workspace_root, doc.relative_path);
        if (folder_segment) {
            mode = INTEGRATION_MODE_FOLDER;
            integration_path = folder_segment;
        } else {
            const seq = breadcrumbSeqForLabel(breadcrumb_last, flattenAllNotes(root));
            if (seq !== undefined) { parent_context_seq = seq; }
            else { debug('nt_breadcrumb_last=%s matched no folder segment or note', breadcrumb_last); }
        }
    }
    if (mode === INTEGRATION_MODE_FOLDER) {
        if (!integration_path) { integration_path = parentFolderOf(doc.path); }
        parent_context_seq = undefined;
    }
    return { mode, integration_path, parent_context_seq };
}

/**
 * Pick the most-recently-sent doc from the map (ISO `updateSentAt` lex-compares as
 * chronological). Used in current_file mode to render exactly one composer regardless
 * of how the docs map got populated - a doc stamped by the extension's sendDoc is the
 * one the extension considers active. Missing `updateSentAt` is treated as the empty
 * string so a doc with a real timestamp always wins over an unstamped one; among
 * unstamped (or equal-timestamp) entries the first iterated insertion order wins via
 * the strict `>` comparison.
 */
export function pickMostRecentlySentDoc(docs: HashMapOf<Doc>): { note_id: string; note: Doc } | undefined {
    let best_entry: { note_id: string; note: Doc } | undefined;
    let best_ts = '';
    for (const [note_id, note] of Object.entries(docs)) {
        const ts = note.updateSentAt ?? '';
        if (!best_entry || ts > best_ts) {
            best_entry = { note_id, note };
            best_ts = ts;
        }
    }
    return best_entry;
}

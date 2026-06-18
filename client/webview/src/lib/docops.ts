import Debug from "debug";
import { convertMdastToNoteHierarchy } from "../notethink-views/src/lib/convertMdastToNoteHierarchy";
import { findFileH1 } from "../notethink-views/src/lib/mergeAggregateRoot";
import { resolveNamespacedTag } from "../notethink-views/src/lib/linetagops";
import { breadcrumbSeqForLabel, flattenAllNotes } from "../notethink-views/src/lib/noteops";
import { resolveBreadcrumbFolderSegment } from "../notethink-views/src/lib/pathops";
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, type ConcreteIntegrationMode } from "../notethink-views/src/types/IntegrationMode";
import type { HashMapOf, Doc } from "../types/general";

const debug = Debug("nodejs:notethink:docops");

/**
 * FileIntegrationDeclaration is the opened file's declared opening intent, read from its H1
 * (then front-matter root) nt_integration_mode / nt_breadcrumb_last linetags.
 * - mode: the concrete integration mode the file declares (never 'auto')
 * - integration_path: the folder to scope aggregation to (folder mode only) — the nt_breadcrumb_last
 *   folder segment when it matched, else the file's own parent folder
 * - parent_context_seq: the note-hierarchy depth to open scoped to (current_file mode only), seeded
 *   from an nt_breadcrumb_last epic/story label
 */
export interface FileIntegrationDeclaration {
    mode: ConcreteIntegrationMode;
    integration_path?: string;
    parent_context_seq?: number;
}

// the only authored nt_integration_mode values; 'auto' is a webview view-state value, never authored
const VALID_AUTHORED_MODES: ReadonlySet<string> = new Set<string>([INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER]);

// the file's own parent folder (absolute), or undefined when the path has no separator
function folderOf(doc_path: string | undefined): string | undefined {
    if (!doc_path) { return undefined; }
    const folder = doc_path.replace(/\/[^/]+$/, '');
    return folder && folder !== doc_path ? folder : undefined;
}

/**
 * Resolve the opened file's integration declaration from its H1 / front-matter linetags, mirroring
 * how mergeAggregateRoot reads file_view_type (H1 nt_view over front-matter). This is a per-opened-file
 * directive, read only from the file the user opened — never majority-voted across a folder.
 *
 * Resolution: nt_integration_mode is validated against current_file / folder (anything else is
 * debug-logged and ignored, degrading to current_file). nt_breadcrumb_last is matched first as a
 * folder segment of the file's path trail (deepest match wins) — a folder match implies folder mode
 * even when nt_integration_mode is absent — then as an epic/story headline (seeding
 * parent_context_seq). Folder mode always carries a scope path (the matched segment, else the file's
 * own folder); a note seq is single-file-only and is dropped in folder mode (it does not address the
 * merged tree). Never throws — a parse failure degrades to current_file with a debug line.
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
        if (!integration_path) { integration_path = folderOf(doc.path); }
        parent_context_seq = undefined;
    }
    return { mode, integration_path, parent_context_seq };
}

/**
 * Pick the most-recently-sent doc from the map (ISO `updateSentAt` lex-compares as
 * chronological). Used in current_file mode to render exactly one composer regardless
 * of how the docs map got populated — a doc stamped by the extension's sendDoc is the
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

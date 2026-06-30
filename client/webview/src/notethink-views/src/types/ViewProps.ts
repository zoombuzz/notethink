import type {MouseEvent, MutableRefObject, ReactElement} from "react";
import type {NoteProps, NoteDisplayOptions, NoteHandlers, TextSelection} from "../types/NoteProps";
import type {ConcreteIntegrationMode} from "./IntegrationMode";

/**
 * ViewProps is the props shape every view consumes; one instance per rendered view (a kanban board, a document view, the synthetic folder root, etc.) built by the composers and threaded through GenericView.
 * - active_editor_doc_path: path of the doc whose editor selection backs `selection`; the per-doc matcher in useViewContext uses this to filter aggregated notes by origin.doc_path before locating the caret in source-file offsets
 * - file_declared_integration: the opened file's declared integration intent (from nt_integration_mode / nt_breadcrumb_last) resolved at the App layer; the congruence-seeking navigation handlers compare a gesture's resulting mode against this to decide whether to keep auto or pin a concrete mode
 */
export interface ViewProps {
    id: string;
    type: string;
    role?: string;
    doc_path?: string;
    doc_relative_path?: string;
    doc_text?: string;
    workspace_root?: string;
    file_count?: number;
    aggregate_total_discovered?: number;
    note_count?: number;
    includeFilter?: string;
    excludeFilter?: string;
    maxNotesPerFile?: number;
    aggregate_loaded_files?: Array<string>;
    settingsCascadeHasWorkspaceOverrides?: boolean;
    settingsCascadeHasAnyOverrides?: boolean;
    view_state_ids?: readonly string[];
    file_declared_integration?: {
        mode: ConcreteIntegrationMode;
        integration_path?: string;
        parent_context_seq?: number;
    };
    display_options?: NoteDisplayOptions;
    nested?: {
        menus?: Record<string, unknown>;
        parent_context?: NoteProps;
        breadcrumb_trail?: ReactElement;
        document_strip?: ReactElement;
        document_root?: NoteProps;
        replaced_attributes?: Record<string, unknown>;
        auto_resolved_type?: string;
    }
    // --- recursive inclusion of parent and child views ---
    child_views?: Array<ViewProps>;
    parent_view?: ViewProps;
    // --- fields added at the React render stage (non-serialised) ---
    notes?: Array<NoteProps>;
    notes_within_parent_context?: Array<NoteProps>;
    selection?: TextSelection;
    active_editor_doc_path?: string;
    handlers?: ViewApi;
}

/**
 * ViewApi, the handler surface a view exposes.
 * - setParentContextSeq and below are injected by functional components in certain situations
 * - postMessage: extension communication (view→host dispatch channel)
 * - descendToFolder: switch the view into folder integration mode at the given absolute folder path; same gesture the breadcrumb uses, exposed here so the origin pill can descend into its project subfolder
 * - setViewInteractionState: write view-driven focused/selected seqs to the canonical view-state key (FOLDER_VIEW_STATE_ID in folder mode, view's own id in current_file mode); used by click handler, getClearHandler, and keyboard navigation so any path that moves focus also updates the view-driven state (view-driven-wins policy in useViewContext means an editor-side revealRange alone cannot move view focus)
 * - onNavigationCommand: navigation callback ref - GenericView registers handler, ExtensionReceiver invokes via ref
 * - revealNote: reveal a note's source range in the editor (jump to the story); resolves the source offset/doc_path from origin in folder mode and the in-tree position in current_file mode. used by the collisions drawer to jump to a colliding note so the user can rename it
 */
export interface ViewApi {
    setViewManagedState: (updates: Array<Record<string, unknown>>) => void;
    deleteViewFromManagedState: (view_id?: string) => void;
    revertAllViewsToDefaultState: () => void;
    setParentContextSeq?: (seq: number) => void;
    getClearHandler?: (focused_notes?: NoteProps[]) => ((event: MouseEvent<HTMLElement>) => void);
    setCaretPosition?: (position: number) => void;
    click?: NoteHandlers['click'];
    singleClick?: NoteHandlers['click'];
    doubleClick?: NoteHandlers['click'];
    postMessage?: (message: unknown) => void;
    descendToFolder?: (folder_path: string) => void;
    revealNote?: (note: NoteProps) => void;
    setViewInteractionState?: (focused_ids: string[], selected_ids: string[]) => void;
    onNavigationCommand?: MutableRefObject<((direction: string) => void) | undefined>;
}

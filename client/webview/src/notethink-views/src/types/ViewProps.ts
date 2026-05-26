import type {MouseEvent, MutableRefObject, ReactElement} from "react";
import type {NoteProps, NoteDisplayOptions, NoteHandlers, TextSelection} from "../types/NoteProps";

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
    view_state_ids?: readonly string[];
    display_options?: NoteDisplayOptions;
    nested?: {
        menus?: Record<string, unknown>;
        parent_context?: NoteProps;
        breadcrumb_trail?: ReactElement;
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
    handlers?: ViewApi;
}

/**
 * ViewApi, the handler surface a view exposes.
 * - setParentContextSeq and below are injected by functional components in certain situations
 * - postMessage: extension communication (replaces notegit's sync_view.dispatch())
 * - onNavigationCommand: navigation callback ref — GenericView registers handler, ExtensionReceiver invokes via ref
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
    onNavigationCommand?: MutableRefObject<((direction: string) => void) | undefined>;
}

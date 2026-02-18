import {ReactElement} from "react";
import type {NoteProps, NoteDisplayOptions, NoteHandlers, TextSelection} from "../types/NoteProps";

export interface ViewProps {
    id: string;
    type: string;
    role?: string;
    display_options?: NoteDisplayOptions;
    nested?: {
        menus?: Record<string, unknown>;
        parent_context?: NoteProps;
        breadcrumb_trail?: ReactElement;
        replaced_attributes?: Record<string, unknown>;
    }
    // recursive inclusion of parent and child views
    child_views?: Array<ViewProps>;
    parent_view?: ViewProps;
    // fields added at the React render stage (non-serialised)
    notes?: Array<NoteProps>;
    notes_within_parent_context?: Array<NoteProps>;
    selection?: TextSelection;
    handlers?: ViewApi;
}

export interface ViewApi {
    setViewManagedState: (updates: Array<Record<string, unknown>>) => void;
    deleteViewFromManagedState: (view_id?: string) => void;
    revertAllViewsToDefaultState: () => void;
    // other handlers are injected by functional components in certain situations
    setParentContextSeq?: (seq: number) => void;
    getClearHandler?: () => void;
    setCaretPosition?: (position: number) => void;
    click?: NoteHandlers['click'];
    singleClick?: NoteHandlers['click'];
    doubleClick?: NoteHandlers['click'];
}

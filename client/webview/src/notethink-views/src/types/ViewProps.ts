import {ReactElement} from "react";
import {NoteProps, TextSelection} from "../types/NoteProps";

export interface ViewProps {
    id: string;
    type: string;
    role?: string;
    display_options?: any;
    nested?: {
        menus?: any;
        parent_context?: any;
        breadcrumb_trail?: ReactElement;
        replaced_attributes?: any;
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
    setViewManagedState: (updates: Array<any>) => void;
    deleteViewFromManagedState: (view_id?: string) => void;
    revertAllViewsToDefaultState: () => void;
    // other handlers are injected by functional components in certain situations
    setParentContextSeq?: (seq: number) => void;
    getClearHandler?: any;
    setCaretPosition?: any;
    click?: any;
    singleClick?: any;
    doubleClick?: any;
}

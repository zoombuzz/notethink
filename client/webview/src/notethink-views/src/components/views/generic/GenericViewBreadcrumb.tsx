import Debug from "debug";
import React from "react";
import type { NoteProps } from "../../../types/NoteProps";
import type { ViewApi, ViewProps } from "../../../types/ViewProps";
import { INTEGRATION_MODE_FOLDER } from "../../../types/IntegrationMode";
import BreadcrumbTrail from "../BreadcrumbTrail";

const debug = Debug("nodejs:notethink-views:GenericViewBreadcrumb");

interface GenericViewBreadcrumbProps {
    props: ViewProps;
    parentContext: NoteProps | undefined;
    handlers: ViewApi;
    onFolderClick: (folder_path: string) => void;
    onFileCountClick: (anchor: HTMLElement) => void;
    has_collisions?: boolean;
    onCollisionsClick?: (anchor: HTMLElement) => void;
    onLeafClick?: (leaf_path: string, anchor: HTMLElement) => void;
}

// empty parent-context fallback so BreadcrumbTrail always receives a valid NoteProps shape
const EMPTY_PARENT_CONTEXT = {
    seq: 0,
    level: 0,
    children_body: [],
    children: [],
    position: { start: { offset: 0, line: 0 }, end: { offset: 0, line: 0 } },
    headline_raw: '',
    body_raw: '',
};

/**
 * Standard breadcrumb trail for views, spreading the parent context (or an empty
 * fallback) plus the folder/file-count document context derived from the view props.
 */
export default function GenericViewBreadcrumb(component_props: GenericViewBreadcrumbProps): React.ReactElement {
    const { props, parentContext, handlers, onFolderClick, onFileCountClick, has_collisions, onCollisionsClick, onLeafClick } = component_props;
    return (
        <BreadcrumbTrail
            {...(parentContext || EMPTY_PARENT_CONTEXT)}
            doc_path={props.doc_path}
            doc_relative_path={props.doc_relative_path}
            workspace_root={props.workspace_root}
            integration_path={props.display_options?.integration_mode === INTEGRATION_MODE_FOLDER ? props.display_options?.integration_path : undefined}
            file_count={props.file_count}
            note_count={props.note_count}
            aggregate_total_discovered={props.aggregate_total_discovered}
            onFolderClick={onFolderClick}
            onFileCountClick={onFileCountClick}
            has_collisions={has_collisions}
            onCollisionsClick={onCollisionsClick}
            onLeafClick={onLeafClick}
            handlers={{
                setParentContextSeq: handlers?.setParentContextSeq
            }}
            parent_notes={parentContext ? parentContext.parent_notes?.concat([parentContext]) : []}
        />
    );
}

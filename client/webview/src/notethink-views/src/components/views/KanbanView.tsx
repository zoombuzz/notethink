import Debug from 'debug';
import React, { type ReactElement } from "react";
import type { ViewProps } from "../../types/ViewProps";
import LineView from "./LineView";

const debug = Debug("nodejs:notethink-views:KanbanView");

/**
 * KanbanView is LineView preset to the status axis. The single-axis card-lane machinery (grouping,
 * lane layout, orientation, drag, FLIP) all lives in LineView; kanban is the status specialisation plus
 * its chrome, so every grouped view inherits the same behaviour. The status axis is FIXED for kanban in
 * the view registry (edit the group-by by selecting Line), and the drop writes the status linetag.
 */
export default function KanbanView(props: ViewProps): ReactElement {
    debug('rendering kanban as the status preset over LineView');
    return <LineView {...props} axis="status" />;
}

import Debug from 'debug';
import React, { useMemo, type ReactElement } from "react";
import { axisForGroupByKey, resolveKanbanAxisKey } from "../../lib/groupbyops";
import { axisField, type Axis } from "../../lib/axisops";
import type { ViewProps } from "../../types/ViewProps";
import LineView from "./LineView";

const debug = Debug("nodejs:notethink-views:KanbanView");

/**
 * KanbanView is LineView preset to the status axis. The single-axis card-lane machinery (grouping,
 * lane layout, orientation, drag, FLIP) all lives in LineView; kanban is the status specialisation plus
 * its chrome, so every grouped view inherits the same behaviour, and the drop writes the lane's linetag.
 *
 * The preset is a default rather than a constant: status is what `auto` means here, and kanban's own
 * group-by (`kanbanGroupBy`, an OPEN override at the kanban node) overrides it. Departing from status is
 * a departure from what makes the view a kanban, which is why the drawer answers it with "Save as a new
 * view type" - and an axis the board ignored would make that offer meaningless. Picking the read-only
 * first-level-folder key lanes the board by project and disables the drag, which LineView already
 * handles from the axis's own writability.
 */
export default function KanbanView(props: ViewProps): ReactElement {
    const axis: Axis = useMemo(() => {
        const key = resolveKanbanAxisKey(props.display_options?.settings?.kanbanGroupBy);
        return axisForGroupByKey(key, props.notes);
    }, [props.display_options?.settings?.kanbanGroupBy, props.notes]);
    debug('rendering kanban over LineView on the %s axis', axisField(axis));
    return <LineView {...props} axis={axis} />;
}

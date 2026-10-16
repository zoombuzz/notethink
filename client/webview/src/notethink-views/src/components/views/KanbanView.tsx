import Debug from 'debug';
import React, { useMemo, type ReactElement } from "react";
import { axisForGroupByKey, KANBAN_AXIS_KEY } from "../../lib/groupbyops";
import { axisField, type Axis } from "../../lib/axisops";
import type { ViewProps } from "../../types/ViewProps";
import LineView from "./LineView";

const debug = Debug("nodejs:notethink-views:KanbanView");

/**
 * KanbanView is LineView preset to the status axis. The single-axis card-group machinery (grouping,
 * group layout, orientation, drag, FLIP) all lives in LineView; kanban is the status specialisation plus
 * its chrome, so every grouped view inherits the same behaviour, and the drop writes the group's linetag.
 *
 * The preset is a built-in default rather than a constant: status is Kanban's own built-in bag value for
 * Group by (`BUILTIN_NODE_DEFAULTS` in viewregistryops.ts), resolved by GenericView before this component
 * ever renders, so `props.display_options.settings.groupBy` already carries kanban's own choice - status
 * with nothing stored, or whatever kanban (or a saved type under it) explicitly overrides - rather than
 * grouped's generic `auto`, exactly as it carries line's own orientation. The fallback to
 * `KANBAN_AXIS_KEY` covers only the value arriving undefined altogether (settings not yet resolved).
 */
export default function KanbanView(props: ViewProps): ReactElement {
    const axis: Axis = useMemo(() => {
        const key = props.display_options?.settings?.groupBy ?? KANBAN_AXIS_KEY;
        return axisForGroupByKey(key, props.notes);
    }, [props.display_options?.settings?.groupBy, props.notes]);
    debug('rendering kanban over LineView on the %s axis', axisField(axis));
    return <LineView {...props} axis={axis} />;
}

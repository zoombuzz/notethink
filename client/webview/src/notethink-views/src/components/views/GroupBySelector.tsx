import Debug from "debug";
import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { formatColumnLabel } from "../../lib/noteops";
import { viewTypeLabel } from "./viewTypeLabel";

const debug = Debug("nodejs:notethink-views:GroupBySelector");

/**
 * a group-by key's display label: strip the internal nt_/ng_ prefix, turn underscores into words, and
 * title-case (via formatColumnLabel). 'assignee' -> 'Assignee'; 'nt_first_level_folder' -> 'First Level Folder'.
 */
export function groupByKeyLabel(key: string): string {
    const bare = key.replace(/^(nt_|ng_)/, '');
    return formatColumnLabel(bare.replace(/_/g, '-'));
}

/**
 * GroupBySelector, the Line view's group-by dropdown in the lane settings drawer. Offers 'auto' (labelled
 * "Auto (First Level Folder)" with its resolved key) plus every categorical candidate. When the group-by
 * is fixed for this view (kanban pins it to status via the registry) the select is disabled and shows the
 * pinned key, with a note that selecting the unlocking view (Line) makes it editable.
 * - selection: the persisted per-view choice ('auto' or a candidate key)
 * - resolvedKey: the auto-resolved key, shown in the "Auto (...)" label
 * - candidateKeys: categorical group-by candidate keys enumerated from the notes
 * - fixed / fixedValue / unlockView: the registry lock - disabled, pinned to fixedValue, unlocked by unlockView
 */
export interface GroupBySelectorProps {
    selection: string;
    resolvedKey: string;
    candidateKeys: string[];
    fixed?: boolean;
    fixedValue?: string;
    unlockView?: string;
    onChange: (group_by_key: string) => void;
}

export default function GroupBySelector(props: GroupBySelectorProps): ReactElement {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        props.onChange(e.target.value);
    };

    const select_style = {
        background: 'var(--vscode-dropdown-background)',
        border: '1px solid var(--vscode-dropdown-border)',
        borderRadius: '2px',
        cursor: props.fixed ? 'not-allowed' : 'pointer',
        fontSize: 'inherit',
        padding: '2px 0.3em',
        color: 'var(--vscode-dropdown-foreground)',
    };

    // fixed (kanban): a disabled select showing the pinned key, plus a hint naming the view that unlocks it
    if (props.fixed) {
        const fixed_value = props.fixedValue ?? 'status';
        return (
            <>
                <select data-testid="group-by-selector" value={fixed_value} disabled aria-label={l10n.t('Group by')} style={select_style}>
                    <option value={fixed_value}>{groupByKeyLabel(fixed_value)}</option>
                </select>
                {props.unlockView && (
                    <span data-testid="group-by-fixed-hint" style={{ marginLeft: '0.5em', opacity: 0.7 }}>
                        {l10n.t('Set by {0}', viewTypeLabel(props.unlockView))}
                    </span>
                )}
            </>
        );
    }

    const options = ['auto', ...props.candidateKeys];
    return (
        <select
            data-testid="group-by-selector"
            value={props.selection}
            onChange={handleChange}
            aria-label={l10n.t('Group by')}
            style={select_style}
        >
            {options.map((key) => (
                <option key={key} value={key}>
                    {key === 'auto' ? viewTypeLabel('auto', groupByKeyLabel(props.resolvedKey)) : groupByKeyLabel(key)}
                </option>
            ))}
        </select>
    );
}

import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { formatColumnLabel } from "../../lib/noteops";
import { viewTypeLabel } from "./viewTypeLabel";

/**
 * A group-by key's display label: strips the internal nt_/ng_ prefix, turns underscores into words, and
 * title-cases (via formatColumnLabel). 'assignee' -> 'Assignee'; 'nt_first_level_folder' -> 'First Level Folder'.
 */
export function groupByKeyLabel(key: string): string {
    const bare = key.replace(/^(nt_|ng_)/, '');
    return formatColumnLabel(bare.replace(/_/g, '-'));
}

/**
 * GroupBySelector, the group view's group-by dropdown in the group settings drawer. Offers 'auto' (labelled
 * "Auto (...)" with its resolved key) plus every categorical candidate.
 * - selection: the persisted per-view choice ('auto' or a candidate key)
 * - resolvedKey: the auto-resolved key, shown in the "Auto (...)" label
 * - candidateKeys: categorical group-by candidate keys enumerated from the notes
 * - inheritedValue: the value this view would inherit if it held none of its own; the option matching it
 *   (which may be 'auto' itself) reads "<label> (inherited)", whether or not the view currently holds
 *   its own value, so picking it is how an edit clears back to inheriting
 */
export interface GroupBySelectorProps {
    selection: string;
    resolvedKey: string;
    candidateKeys: string[];
    inheritedValue?: string;
    onChange: (group_by_key: string) => void;
}

/** an option's label, with "(inherited)" appended when its value is what the view would inherit */
function optionLabel(key: string, resolved_key: string, inherited_value: string | undefined): string {
    const base = key === 'auto' ? viewTypeLabel('auto', groupByKeyLabel(resolved_key)) : groupByKeyLabel(key);
    return key === inherited_value ? l10n.t('{0} (inherited)', base) : base;
}

export default function GroupBySelector(props: GroupBySelectorProps): ReactElement {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        props.onChange(e.target.value);
    };
    const select_style = {
        background: 'var(--vscode-dropdown-background)',
        border: '1px solid var(--vscode-dropdown-border)',
        borderRadius: '2px',
        cursor: 'pointer',
        fontSize: 'inherit',
        padding: '2px 0.3em',
        color: 'var(--vscode-dropdown-foreground)',
    };
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
                    {optionLabel(key, props.resolvedKey, props.inheritedValue)}
                </option>
            ))}
        </select>
    );
}

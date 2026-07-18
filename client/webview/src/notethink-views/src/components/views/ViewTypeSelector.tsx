import Debug from "debug";
import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { selectableViewTypes } from "./GenericView";
import { viewTypeLabel } from "./viewTypeLabel";

const debug = Debug("nodejs:notethink-views:ViewTypeSelector");

interface ViewTypeSelectorProps {
    // the persisted selection: drives the <select> value (auto / document / kanban)
    currentSelection: string;
    // the concrete type auto resolved to, shown in parentheses for the auto option ("Auto (Kanban)")
    resolvedType?: string;
    onChange: (view_type: string) => void;
}

/**
 * View-type dropdown, hosted by the View settings drawer's body. It is not on the toolbar row: the
 * tab that opens the drawer is already titled with the resolved view type, so the toolbar states the
 * current type and the drawer holds the control that changes it.
 */
export default function ViewTypeSelector(props: ViewTypeSelectorProps): ReactElement {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        props.onChange(e.target.value);
    };

    return (
        <select
            data-testid="view-type-selector"
            value={props.currentSelection}
            onChange={handleChange}
            aria-label={l10n.t('View type')}
            style={{
                background: 'var(--vscode-dropdown-background)',
                border: '1px solid var(--vscode-dropdown-border)',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: 'inherit',
                padding: '2px 0.3em',
                color: 'var(--vscode-dropdown-foreground)',
            }}
        >
            {selectableViewTypes().map((vt) => (
                <option key={vt} value={vt}>
                    {viewTypeLabel(vt, props.resolvedType)}
                </option>
            ))}
        </select>
    );
}

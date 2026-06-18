import Debug from "debug";
import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { SELECTABLE_VIEWTYPES } from "./GenericView";

const debug = Debug("nodejs:notethink-views:ViewTypeSelector");

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ViewTypeSelectorProps {
    // the persisted selection: drives the <select> value (auto / document / kanban)
    currentSelection: string;
    // the concrete type auto resolved to, shown in parentheses for the auto option ("Auto (Kanban)")
    resolvedType?: string;
    onChange: (view_type: string) => void;
}

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
            {SELECTABLE_VIEWTYPES.map((vt) => (
                <option key={vt} value={vt}>
                    {vt === 'auto' && props.resolvedType
                        ? l10n.t('Auto ({0})', capitalize(props.resolvedType))
                        : capitalize(vt)}
                </option>
            ))}
        </select>
    );
}

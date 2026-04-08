import type { ChangeEvent } from "react";
import * as l10n from "@vscode/l10n";
import type { ViewProps } from "../../types/ViewProps";
import { SELECTABLE_VIEWTYPES } from "./GenericView";

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ViewTypeSelectorProps {
    currentType: string;
    autoResolvedType?: string;
    handlers?: ViewProps['handlers'];
    id: string;
}

export default function ViewTypeSelector(props: ViewTypeSelectorProps) {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const viewType = e.target.value;
        props.handlers?.setViewManagedState?.([{
            id: props.id,
            type: viewType,
        }]);
    };

    return (
        <select
            data-testid="view-type-selector"
            value={props.currentType}
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
                    {vt === 'auto' && props.autoResolvedType
                        ? l10n.t('Auto ({0})', capitalize(props.autoResolvedType))
                        : capitalize(vt)}
                </option>
            ))}
        </select>
    );
}

import Debug from "debug";
import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { SELECTABLE_VIEWTYPES } from "./GenericView";
import type { ViewProps } from "../../types/ViewProps";

const debug = Debug("nodejs:notethink-views:ViewTypeSelector");

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * - onCascadeWrite: called after `setViewManagedState` so the parent can round-trip the change to VS Code config under notethink.settings.*. Fires in any integration mode — viewType is a view-type setting, not folder-specific
 */
interface ViewTypeSelectorProps {
    currentType: string;
    autoResolvedType?: string;
    handlers?: ViewProps['handlers'];
    id: string;
    onCascadeWrite?: (viewType: string) => void;
}

export default function ViewTypeSelector(props: ViewTypeSelectorProps): ReactElement {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        const viewType = e.target.value;
        props.handlers?.setViewManagedState?.([{
            id: props.id,
            type: viewType,
        }]);
        props.onCascadeWrite?.(viewType);
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

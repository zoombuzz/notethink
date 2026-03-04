import type { ChangeEvent } from "react";
import type { ViewProps } from "../../types/ViewProps";
import { SELECTABLE_VIEWTYPES } from "./GenericView";

interface ViewTypeSelectorProps {
    currentType: string;
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
            aria-label="View type"
            style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.85em',
                padding: '0 0.3em',
                color: 'inherit',
                opacity: 0.7,
                float: 'right',
            }}
        >
            {SELECTABLE_VIEWTYPES.map((vt) => (
                <option key={vt} value={vt}>
                    {vt.charAt(0).toUpperCase() + vt.slice(1)}
                </option>
            ))}
        </select>
    );
}

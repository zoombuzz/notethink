import Debug from "debug";
import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { INTEGRATION_MODES, type IntegrationMode } from "../../types/IntegrationMode";

const debug = Debug("nodejs:notethink-views:ViewIntegrationSelector");

export { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, INTEGRATION_MODES, type IntegrationMode } from "../../types/IntegrationMode";

function getModeLabels(): Record<IntegrationMode, string> {
    return {
        current_file: l10n.t('Current file'),
        folder: l10n.t('Folder'),
    };
}

interface ViewIntegrationSelectorProps {
    currentMode: IntegrationMode;
    onChange: (mode: IntegrationMode) => void;
}

export default function ViewIntegrationSelector(props: ViewIntegrationSelectorProps): ReactElement {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        props.onChange(e.target.value as IntegrationMode);
    };

    return (
        <select
            data-testid="view-integration-selector"
            value={props.currentMode}
            onChange={handleChange}
            aria-label={l10n.t('View integration')}
            style={{
                background: 'var(--vscode-dropdown-background)',
                border: '1px solid var(--vscode-dropdown-border)',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: 'inherit',
                padding: '2px 0.3em',
                color: 'var(--vscode-dropdown-foreground)',
                marginRight: '0.5em',
            }}
        >
            {INTEGRATION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                    {getModeLabels()[mode]}
                </option>
            ))}
        </select>
    );
}

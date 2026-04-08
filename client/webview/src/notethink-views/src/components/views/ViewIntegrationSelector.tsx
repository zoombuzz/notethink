import type { ChangeEvent } from "react";
import * as l10n from "@vscode/l10n";

export const INTEGRATION_MODES = ['current_file', 'directory'] as const;
export type IntegrationMode = typeof INTEGRATION_MODES[number];

function getModeLabels(): Record<IntegrationMode, string> {
    return {
        current_file: l10n.t('Current file'),
        directory: l10n.t('Directory'),
    };
}

interface ViewIntegrationSelectorProps {
    currentMode: IntegrationMode;
    onChange: (mode: IntegrationMode) => void;
}

export default function ViewIntegrationSelector(props: ViewIntegrationSelectorProps) {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
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

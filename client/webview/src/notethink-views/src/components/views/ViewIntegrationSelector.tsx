import Debug from "debug";
import type { ChangeEvent, ReactElement } from "react";
import * as l10n from "@vscode/l10n";
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODES, type ConcreteIntegrationMode, type IntegrationMode } from "../../types/IntegrationMode";

const debug = Debug("nodejs:notethink-views:ViewIntegrationSelector");

export { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER, INTEGRATION_MODES, type IntegrationMode } from "../../types/IntegrationMode";

// concrete-mode labels; the 'auto' option's label is composed from the resolved mode ("Auto (Folder)")
function getConcreteModeLabels(): Record<ConcreteIntegrationMode, string> {
    return {
        current_file: l10n.t('Current file'),
        folder: l10n.t('Folder'),
    };
}

interface ViewIntegrationSelectorProps {
    // the persisted selection: drives the <select> value (auto / current_file / folder)
    currentSelection: IntegrationMode;
    // the concrete mode auto resolved to, shown in parentheses for the auto option ("Auto (Folder)")
    resolvedMode: ConcreteIntegrationMode;
    onChange: (mode: IntegrationMode) => void;
}

export default function ViewIntegrationSelector(props: ViewIntegrationSelectorProps): ReactElement {
    const labels = getConcreteModeLabels();
    const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        props.onChange(e.target.value as IntegrationMode);
    };

    return (
        <select
            data-testid="view-integration-selector"
            value={props.currentSelection}
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
                    {mode === INTEGRATION_MODE_AUTO
                        ? l10n.t('Auto ({0})', labels[props.resolvedMode])
                        : labels[mode]}
                </option>
            ))}
        </select>
    );
}

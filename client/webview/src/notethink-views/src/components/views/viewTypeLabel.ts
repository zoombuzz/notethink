import Debug from "debug";
import * as l10n from "@vscode/l10n";

const debug = Debug("nodejs:notethink-views:viewTypeLabel");

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Chip label for a (possibly auto) view-type selection: the plain capitalised type for a concrete
 * selection, and the resolved form "Auto (Kanban)" when auto has a type to resolve to. Shared by the
 * View settings tab, which is titled with the view type it currently resolves to, and by the selector
 * inside that tab's drawer, so the two can never word the same selection differently.
 */
export function viewTypeLabel(selection: string, resolved_type?: string): string {
    if (selection === 'auto' && resolved_type) {
        return l10n.t('Auto ({0})', capitalize(resolved_type));
    }
    return capitalize(selection);
}

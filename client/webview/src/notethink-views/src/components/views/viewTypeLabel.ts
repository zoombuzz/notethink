import * as l10n from "@vscode/l10n";

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Chip label for a (possibly auto) type selection: the plain capitalised type for a concrete selection,
 * and the resolved form "Auto (Kanban)" when auto has a type to resolve to. Shared by the View settings
 * tab, which is titled with the view type it currently resolves to, and by the selector inside that
 * tab's drawer, so the two can never word the same selection differently.
 *
 * It carries no knowledge of what the ids mean, so the card axis words "Auto (Sticky)" through this same
 * function rather than a parallel one. The two axes are deliberately worded identically: they are the
 * same Auto-or-pinned choice made twice, and a reader who has learned one has learned the other.
 */
export function viewTypeLabel(selection: string, resolved_type?: string): string {
    if (selection === 'auto' && resolved_type) {
        return l10n.t('Auto ({0})', capitalize(resolved_type));
    }
    return capitalize(selection);
}

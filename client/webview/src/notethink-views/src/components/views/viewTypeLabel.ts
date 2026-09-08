import * as l10n from "@vscode/l10n";
import { getViewNode, type ViewRegistry } from "../../lib/viewregistryops";

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * One type id, worded for a reader. A minted type has two names and only one of them is fit to be read:
 * the id is slugified so it can be written as an `nt_view=` linetag and stored as a settings key, while
 * the label is the free text its author typed, spaces and all. The registry holds that label for every
 * node it built, so one lookup words the whole hierarchy - and a type it refused to build, such as one
 * reusing a built-in's id, stays refused here too rather than relabelling the node it collided with.
 * Without a registry, or for an id belonging to no node, the id capitalises to stand in for its name.
 */
function typeName(type_id: string, registry?: ViewRegistry): string {
    const node = registry ? getViewNode(type_id, registry) : undefined;
    return node?.label ?? capitalize(type_id);
}

/**
 * Chip label for a (possibly auto) type selection: the plain worded type for a concrete selection, and
 * the resolved form "Auto (Kanban)" when auto has a type to resolve to. Shared by the View settings tab,
 * which is titled with the view type it currently resolves to, and by the tree inside that tab's drawer,
 * so the two can never word the same selection differently. Pass the merged registry wherever a minted
 * type can reach either position, or the tab states the slug while the tree beneath it states the name.
 *
 * It carries no knowledge of what the ids mean, so the card axis words "Auto (Sticky)" through this same
 * function rather than a parallel one. The two axes are deliberately worded identically: they are the
 * same Auto-or-pinned choice made twice, and a reader who has learned one has learned the other. Only the
 * view axis can be minted, so only its callers have a registry worth passing.
 */
export function viewTypeLabel(selection: string, resolved_type?: string, registry?: ViewRegistry): string {
    if (selection === 'auto' && resolved_type) {
        return l10n.t('Auto ({0})', typeName(resolved_type, registry));
    }
    return typeName(selection, registry);
}

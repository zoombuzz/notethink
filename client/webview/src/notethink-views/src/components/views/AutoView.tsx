import type { ViewProps } from "../../types/ViewProps";
import type { LineTag, NoteProps } from "../../types/NoteProps";
import { aggregateNoteLinetags } from "../../lib/noteops";
import GenericView from "./GenericView";
import view_specific_styles from "../ViewRenderer.module.scss";

/**
 * Detect whether the root parent_context is a synthetic aggregate root (one whose
 * direct children carry note.origin with multiple distinct doc_ids). Pure document
 * mode has either no origins or a single origin.
 */
function isAggregateRoot(parent_context: NoteProps | undefined): boolean {
    if (!parent_context) { return false; }
    const children = parent_context.child_notes || [];
    const distinct_doc_ids = new Set<string>();
    for (const c of children) {
        if (c.origin?.doc_id) { distinct_doc_ids.add(c.origin.doc_id); }
    }
    return distinct_doc_ids.size >= 2 || (distinct_doc_ids.size === 1 && parent_context.seq === 0 && parent_context.headline_raw === '');
}

/**
 * Majority-vote ng_view across the originating files in an aggregate tree.
 * One vote per file, taken from origin.file_view_type (captured from each file's H1).
 * Ties or no votes return undefined; caller falls back to 'document'.
 */
function majorityNgView(notes: NoteProps[] | undefined): string | undefined {
    if (!notes?.length) { return undefined; }
    const file_votes = new Map<string, string>();
    for (const n of notes) {
        if (!n.origin?.doc_id || !n.origin?.file_view_type) { continue; }
        if (!file_votes.has(n.origin.doc_id)) {
            file_votes.set(n.origin.doc_id, n.origin.file_view_type);
        }
    }
    if (file_votes.size === 0) { return undefined; }
    const tally = new Map<string, number>();
    for (const v of file_votes.values()) {
        tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    let best_type: string | undefined;
    let best_count = 0;
    let tied = false;
    for (const [type, count] of tally.entries()) {
        if (count > best_count) { best_type = type; best_count = count; tied = false; }
        else if (count === best_count) { tied = true; }
    }
    return tied ? undefined : best_type;
}

export default function AutoView(props: ViewProps) {

    // set default auto view type, then hunt for doc-selected auto view type
    const derived_attributes: { type: string; display_options: Record<string, unknown> } = {
        type: 'document',
        display_options: {
            ...props.display_options
        },
    };
    const replaced_attributes: { type: string; display_options: Record<string, unknown> } = {
        type: props.type,
        display_options: {},
    };

    // folder mode: synthetic root has no single ng_view linetag on a top-level note, so apply a majority vote across originating files (one vote per file)
    if (isAggregateRoot(props.nested?.parent_context)) {
        const majority = majorityNgView(props.notes);
        if (majority) {
            derived_attributes.type = majority;
        }
        // fall through — focused-note linetag aggregation below may still tweak attributes
    }

    if (props.display_options?.focused_notes?.length) {
        const attributes: { [key: string]: LineTag } = aggregateNoteLinetags(props.display_options?.focused_notes);
        if (attributes?.ng_view?.value) {
            derived_attributes.type = attributes.ng_view.value;
            const view_typing_note = (props.notes || []).at(attributes.ng_view.note_seq);
            if (view_typing_note) {
                derived_attributes.display_options.parent_context_seq = view_typing_note.seq;
                replaced_attributes.display_options.parent_context_seq = props.display_options?.parent_context_seq;
            }
        }
        if (attributes?.ng_level?.value_numeric) {
            derived_attributes.display_options.level = attributes.ng_level.value_numeric;
            replaced_attributes.display_options.level = props.display_options?.level;
        }
    }

    return (
        <div className={view_specific_styles.fullheight} data-auto-selected-viewtype={derived_attributes.type}>
            <GenericView
                {...props}
                {...derived_attributes}
                display_options={{
                    ...props.display_options,
                    ...derived_attributes?.display_options,
                }}
                nested={{
                    ...props.nested,
                    replaced_attributes: replaced_attributes,
                    auto_resolved_type: derived_attributes.type,
                }}
            />
        </div>
    );
}

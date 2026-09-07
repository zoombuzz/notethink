import type { ReactElement } from "react";
import { aggregateNoteLinetags, findNoteBySeq, isAggregateRoot, majorityCardType, majorityNgView } from "../../lib/noteops";
import { resolveNamespacedTag } from "../../lib/linetagops";
import { CARD_AUTO, resolveCardType } from "../notes/cardregistryops";
import type { ViewProps } from "../../types/ViewProps";
import type { LineTag } from "../../types/NoteProps";
import GenericView from "./GenericView";
import view_specific_styles from "../ViewRenderer.module.scss";

export default function AutoView(props: ViewProps): ReactElement {

    // set default auto view type, then hunt for doc-selected auto view type
    const derived_attributes: { type: string; display_options: Record<string, unknown> } = {
        type: 'document',
        display_options: {
            ...props.display_options
        },
    };
    const replaced_attributes: { type: string; card_type: string; display_options: Record<string, unknown> } = {
        type: props.type,
        card_type: props.display_options?.settings?.cardType ?? CARD_AUTO,
        display_options: {},
    };
    const is_aggregate_root = isAggregateRoot(props.nested?.parent_context);

    // folder mode: synthetic root has no single nt_view linetag on a top-level note, so apply a majority vote across originating files (one vote per file)
    if (is_aggregate_root) {
        const majority = majorityNgView(props.notes);
        if (majority) {
            derived_attributes.type = majority;
        }
        // fall through - focused-note linetag aggregation below may still tweak attributes
    }

    if (props.display_options?.focused_notes?.length) {
        const attributes: { [key: string]: LineTag } = aggregateNoteLinetags(props.display_options?.focused_notes);
        const view_tag = resolveNamespacedTag(attributes, 'view');
        const level_tag = resolveNamespacedTag(attributes, 'level');
        if (view_tag?.value) {
            derived_attributes.type = view_tag.value;
            // match by seq, not index: the two disagree after flattenSingleFileStories lifts stories out of their epics
            const view_typing_note = findNoteBySeq(props.notes, view_tag.note_seq);
            if (view_typing_note) {
                derived_attributes.display_options.parent_context_seq = view_typing_note.seq;
                derived_attributes.display_options.parent_context_id = view_typing_note.stable_id;
                replaced_attributes.display_options.parent_context_seq = props.display_options?.parent_context_seq;
                replaced_attributes.display_options.parent_context_id = props.display_options?.parent_context_id;
            }
        }
        if (level_tag?.value_numeric) {
            derived_attributes.display_options.level = level_tag.value_numeric;
            replaced_attributes.display_options.level = props.display_options?.level;
        }
    }

    /*
     * The card axis, resolved independently of the view and by the same rules: an explicit selection is
     * pinned, and `auto` majority-votes nt_card across the originating files before falling back to the
     * card type the resolved view declares. The result is stamped onto settings.cardType for the whole
     * subtree, which is what carries it to every note - buildChildNoteDisplayOptions funnels the view's
     * display_options onto each one, so no call site has to be taught about cards.
     */
    const voted_card_type = replaced_attributes.card_type === CARD_AUTO && is_aggregate_root
        ? majorityCardType(props.notes)
        : undefined;
    const resolved_card_type = resolveCardType(voted_card_type ?? replaced_attributes.card_type, derived_attributes.type, props.display_options?.settings?.viewUserTypes ?? []);
    derived_attributes.display_options.settings = {
        ...props.display_options?.settings,
        cardType: resolved_card_type,
    };

    return (
        <div className={view_specific_styles.fullheight}
             data-auto-selected-viewtype={derived_attributes.type}
             data-auto-selected-cardtype={resolved_card_type}
        >
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
                    auto_resolved_card_type: resolved_card_type,
                }}
            />
        </div>
    );
}

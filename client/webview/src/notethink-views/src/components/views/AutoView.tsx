import Debug from "debug";
import type { ReactElement } from "react";
import { aggregateNoteLinetags, isAggregateRoot, majorityNgView } from "../../lib/noteops";
import type { ViewProps } from "../../types/ViewProps";
import type { LineTag } from "../../types/NoteProps";
import GenericView from "./GenericView";
import view_specific_styles from "../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:AutoView");

export default function AutoView(props: ViewProps): ReactElement {

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

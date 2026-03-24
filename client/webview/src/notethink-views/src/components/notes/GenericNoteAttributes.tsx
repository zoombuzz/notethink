import view_specialised_styles from "../../components/ViewRenderer.module.scss";
import {LineTag, NoteProps} from "../../types/NoteProps";
import {isInternalAttribute} from "../../lib/renderops";
import {MouseEvent} from "react";

const hiddenAttributes = [
    'progress_unit', 'progress_max',
    'kanban_ordering_weight',
];

export default function GenericNoteAttributes(props: NoteProps) {
    const note = props;
    const linetags: { [key: string]: LineTag } = note.linetags || {};
    // render attributes, one at a time
    return (
        <ul className={view_specialised_styles.linetags}
            role={'list'}
        >
            {Object.keys(linetags).map((attrib_key: string, index: number) => {
                // don't show attributes already manually rendered
                if (hiddenAttributes.includes(attrib_key)) {return;}
                // don't show internal attributes
                if (isInternalAttribute(attrib_key)) {return;}
                // pull out the current value (dynamic typing)
                const linetag: LineTag = linetags[attrib_key];
                // allow for custom formatting of identified linetags
                let attrib_value;
                switch (attrib_key) {
                    case 'progress' :
                        attrib_value = (linetags?.progress_max.value_numeric && linetag.value_numeric ? (Math.round(linetag.value_numeric * 100 / linetags?.progress_max.value_numeric)) : linetag.value) + linetags?.progress_unit.value;
                        break;
                    default :
                        // but default to just show value
                        attrib_value = linetag.value;
                        break;
                }
                const linetags_from_position = note.linetags_from || 0;
                const linetag_classes = [view_specialised_styles.linetag];
                if (linetag.inherited) { linetag_classes.push(view_specialised_styles.inherited); }
                return (
                    <li key={index}
                        role={'listitem'}
                        aria-label={attrib_key}
                        className={linetag_classes.join(' ')}
                        data-updated={linetag.updated} data-updated-by-view={linetag.updated_by_view}
                        data-value-previous={linetag.value_previous}
                    >
                        <span className={view_specialised_styles.key}
                              onClick={(event: MouseEvent<HTMLElement>) => {
                                  props.handlers?.click?.(event, note, {
                                      from: (note.linetags_from || 0) + linetag.key_offset,
                                      to: (note.linetags_from || 0) + linetag.key_offset + linetag.key.length,
                                      selection_from: note.position.start.offset,
                                      selection_to: note.position.end.offset,
                                      type: 'linetag',
                                  });
                              }}
                        >{attrib_key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}:</span>
                        <span className={view_specialised_styles.value}
                              onClick={(event: MouseEvent<HTMLElement>) => {
                                  props.handlers?.click?.(event, note, {
                                      from: linetags_from_position + linetag.value_offset,
                                      to: linetags_from_position + linetag.value_offset + linetag.value.length,
                                      selection_from: note.position.start.offset,
                                      selection_to: note.position.end.offset,
                                      type: 'linetag',
                                  });
                              }}
                        >{attrib_value}</span>
                    </li>
                );
            })}
        </ul>
    );
}

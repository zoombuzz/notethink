import React, { lazy } from 'react';
import { DEFAULT_CARD_TYPE, cardComponentFor, cardRegistryWithViewSettings, resolveCardType } from "./cardregistryops";
import { genericNoteAreEqual } from "./genericNoteEquality";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteWrapper from "../../components/notes/GenericNoteWrapper";

// dynamic import() enables React.lazy per-note-type code-splitting; static imports would bloat the initial bundle
const CodeNote = lazy(() => import('./CodeNote'));
const MermaidNote = lazy(() => import('./MermaidNote'));

/*
 * genericNoteAreEqual replaces React.memo's default shallow-prop compare: every caller builds a fresh
 * display_options object per render, so the default comparator never passed and this memo did nothing.
 *
 * Everything the node-type switch below does not claim renders as a card, chosen by a second, orthogonal
 * axis resolved by the registry from the selection or the view's declared card type. The view's own
 * container note is exempt, always rendering the full card since a compact card would take the whole
 * document with it.
 */
export default React.memo(function GenericNote(props: NoteProps) {
    const note = props;
    let deepest_selectable_note = note;
    let cropped_focused_seqs = note.display_options?.focused_seqs || [];
    let cropped_selected_seqs = note.display_options?.selected_seqs || [];
    // if this note is deeper than the deepest selectable note, and it's got parents, iterate up through the parents
    while (note.display_options?.deepest?.selectable_level !== undefined && (deepest_selectable_note.level > note.display_options?.deepest?.selectable_level) && deepest_selectable_note.parent_notes?.length) {
        // get immediate parent
        deepest_selectable_note = deepest_selectable_note.parent_notes[deepest_selectable_note.parent_notes.length - 1];
    }
    // if we did a crop, or if we're at the limit of what's selectable, restrict the focused_seqs and selected_seqs
    if (deepest_selectable_note.level === note.display_options?.deepest?.selectable_level) {
        // restrict the focused_seqs to the deepest selectable level
        cropped_focused_seqs = note.display_options?.focused_seqs?.includes(deepest_selectable_note.seq) ? note.display_options.focused_seqs.slice(0, note.display_options.focused_seqs.indexOf(deepest_selectable_note.seq) + 1) : note.display_options?.focused_seqs || [];
        // restrict the selected_seqs to the deepest selectable level
        cropped_selected_seqs = (note.display_options?.selected_notes || [])
            .filter((selected_note: NoteProps) => selected_note.level <= deepest_selectable_note.level)
            .map((selected_note: NoteProps) => selected_note.seq);
    }
    // adds selected/focused flags for click handlers to read; the original note ref lacks them
    const enriched_selectable: NoteProps = {
        ...deepest_selectable_note,
        selected: !!(cropped_selected_seqs?.length && cropped_selected_seqs.includes(deepest_selectable_note.seq)),
        focused: !!(cropped_focused_seqs?.length && cropped_focused_seqs.includes(deepest_selectable_note.seq)),
    };
    const enriched_props = {
        // calculate default focused and selected status here
        focused: !!(cropped_focused_seqs?.length && cropped_focused_seqs.includes(note.seq)),
        selected: !!(cropped_selected_seqs?.length && cropped_selected_seqs.includes(note.seq)),
        // override with props
        ...props,
        display_options: {
            ...props.display_options,
            deepest: {
                ...props.display_options?.deepest,
                selectable_note: enriched_selectable,
                selectable_level: props.display_options?.deepest?.selectable_level || deepest_selectable_note.level,
            },
            cropped_focused_seqs,
            cropped_selected_seqs,
        },
    };
    // conditional lazy-loading depending on type; see top-level View container in ViewRenderer
    switch (props.type) {
        case 'list':
        case 'listItem':
            return <GenericNoteWrapper type={props.type} {...enriched_props} />;
        case 'code':
            switch (props.lang) {
                case 'mermaid':
                    return <MermaidNote {...enriched_props} />;
                default:
                    return <CodeNote {...enriched_props} />;
            }
    }
    // the view's own container note always gets the full card; the choice below is only about notes inside it
    const is_view_container = props.seq === props.display_options?.parent_context_seq;
    const card_type = is_view_container
        ? DEFAULT_CARD_TYPE
        : resolveCardType(props.display_options?.settings?.cardType, props.display_options?.settings?.viewType, undefined, cardRegistryWithViewSettings(props.display_options?.settings));
    const CardComponent = cardComponentFor(card_type);
    return <CardComponent {...enriched_props} />;
}, genericNoteAreEqual);

import React, { lazy } from 'react';
import { DEFAULT_CARD_TYPE, cardComponentFor, resolveCardType } from "./cardregistryops";
import type { NoteProps } from "../../types/NoteProps";
import GenericNoteWrapper from "../../components/notes/GenericNoteWrapper";

// dynamic import() is required by React.lazy for per-note-type code-splitting; static imports would pull every renderer into the initial bundle
const CodeNote = lazy(() => import('./CodeNote'));
const MermaidNote = lazy(() => import('./MermaidNote'));

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

    // enrich selectable_note with selected/focused flags so click handlers can read the correct state (the original note ref lacks these flags)
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
    /*
     * everything the mdast switch above did not claim renders as a card, and which card is the second,
     * orthogonal axis: the registry answers it from the resolved selection, falling back to the card type
     * the rendered view declares. Code blocks, lists and list items are not on that axis - their renderer
     * is decided by what the node IS, not by how the user wants notes drawn.
     *
     * The one note the axis must not reach is the view's own container - the note the view opens at, which
     * DocumentView renders as its single child and whose BODY is where every note below it appears. Drawing
     * that as a compact card would take the whole document with it, so it always renders the full card
     * whatever the user picked; the cards inside it are the ones the choice is about.
     */
    const is_view_container = props.seq === props.display_options?.parent_context_seq;
    const card_type = is_view_container
        ? DEFAULT_CARD_TYPE
        : resolveCardType(props.display_options?.settings?.cardType, props.display_options?.settings?.viewType);
    const CardComponent = cardComponentFor(card_type);
    return <CardComponent {...enriched_props} />;
});

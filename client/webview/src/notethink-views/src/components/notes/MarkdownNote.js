import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, useMemo } from "react";
import { getStandardNoteDataProps, renderMarkdownNoteHeadline, renderNodeUnified } from "../../lib/renderops";
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import { buildNoteStyles, headlineClickPosition, bodyClickPosition, createNoteClickHandler } from "../../lib/noteui";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import GenericNote from "../../components/notes/GenericNote";
import Debug from 'debug';
const debug = Debug("nodejs:notethink-views:MarkdownNote");
export default function MarkdownNote(props) {
    // parse note and memoize at component level to limit the string and markdown parsing (heavy lifting)
    const memoized_headline = useMemo(() => {
        return renderMarkdownNoteHeadline(props, {
            render: props.display_options?.settings?.show_linetags_in_headlines ? 'all_children' : 'strip_linetags',
            linetags_from: props.linetags_from,
        });
    }, [
        props.headline_raw,
        props.checked, props.display_options?.settings?.show_linetags_in_headlines,
        props.linetags_from,
    ]);
    // get latest updates: always take the `props` version of `note` attributes, because memoized `parseNote` is only augmenting
    const note = {
        headline: memoized_headline,
        ...props
    };
    // render note
    return (_jsxs("div", { className: buildNoteStyles(note, note.display_options?.additional_classes).join(' '), id: note.display_options?.id, ...getStandardNoteDataProps(note), "data-level": note.level, "data-deepest-selectable-level": note.display_options?.deepest?.selectable_level, "data-deepest-selectable-note-level": note.display_options?.deepest?.selectable_note?.level, "data-focused-seqs": note.display_options?.focused_seqs?.join(','), "data-cropped-focused-seqs": note.display_options?.cropped_focused_seqs?.join(','), "data-selected-seqs": note.display_options?.selected_seqs?.join(','), "data-cropped-selected-seqs": note.display_options?.cropped_selected_seqs?.join(','), ...props.display_options?.provided?.draggableProps, ...props.display_options?.provided?.dragHandleProps, ref: props.display_options?.provided?.innerRef, role: 'row', "aria-current": note.focused, "aria-selected": note.selected, children: [_jsxs("div", { className: view_specific_styles.headline, role: 'rowheader', onClick: createNoteClickHandler(note, headlineClickPosition(note)), children: [note.display_options?.settings?.show_line_numbers && (_jsx("span", { className: view_specific_styles.lineno, children: _jsx("span", { children: note.position.start.line }) })), note.headline] }), note.linetags && _jsx(GenericNoteAttributes, { ...note }), note.children_body?.length ?
                _jsx("div", { className: view_specific_styles.body, onClick: createNoteClickHandler(note, bodyClickPosition(note)), children: note.children_body?.map((child, index) => {
                        if ('seq' in child && child.seq !== undefined) {
                            return _jsx(GenericNote, { ...child, display_options: {
                                    ...note.display_options,
                                    id: `v${note.display_options?.view_id}-n${child.seq}`,
                                    // don't pass down draggable props as only this (parent) note is draggable
                                    provided: {
                                        draggableProps: undefined,
                                        dragHandleProps: undefined,
                                    }
                                }, 
                                // note handlers are hydrated by parent view, not in NoteProps, so pass down
                                handlers: note.handlers }, child.seq);
                        }
                        else {
                            return _jsx(Fragment, { children: renderNodeUnified(child) }, `nn-${index}`);
                        }
                    }) }) : ''] }));
}

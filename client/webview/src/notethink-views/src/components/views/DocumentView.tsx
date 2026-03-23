import React, { Profiler, useEffect, useMemo } from 'react';
import master_view_styles from "../../components/ViewRenderer.module.scss";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import {ViewProps} from "../../types/ViewProps";
import {NoteProps} from "../../types/NoteProps";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import { noteIsVisible, findBodyItemElement } from "../../lib/noteops";
import Debug from 'debug';
import GenericNoteAttributes from "../../components/notes/GenericNoteAttributes";
import GenericNote from "../../components/notes/GenericNote";

declare const NOTETHINK_DEV: boolean | undefined;
const debug = Debug("nodejs:notethink-views:DocumentView");

const onProfilerRender = (typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV)
    ? (id: string, phase: string, actualDuration: number) => {
        debug('Profiler %s %s %dms', id, phase, actualDuration.toFixed(1));
    }
    : undefined;

export default React.memo(function DocumentView(props: ViewProps) {

    // set up view-level default display_options, overridden by props
    const display_options = Object.assign({
    }, props.display_options);

    // scroll focused note (and body item) into view when caret moves
    useEffect(() => {
        if (!display_options.settings?.scroll_note_into_view || !display_options.focused_seqs?.length) { return; }
        const view_element = window?.document?.getElementById(`v${props.id}-inner`);
        const note_element_id = `v${props.id}-n${display_options.focused_seqs[display_options.focused_seqs.length - 1]}`;
        const note_element = window?.document?.getElementById(note_element_id);
        if (!note_element || !view_element) { return; }

        // try to scroll the specific body item containing the caret
        const caret_offset = props.selection?.main.head;
        if (caret_offset !== undefined) {
            const body_item = findBodyItemElement(note_element, caret_offset);
            if (body_item) {
                if (!noteIsVisible(body_item, view_element)) {
                    body_item.scrollIntoView({behavior: "smooth", block: "nearest", inline: "nearest"});
                }
                return;
            }
        }

        // fallback: scroll the note element itself
        if (!noteIsVisible(note_element, view_element)) {
            note_element.scrollIntoView({behavior: "smooth", block: "nearest", inline: "nearest"});
        }
    }, [
        display_options.settings?.scroll_note_into_view,
        display_options.focused_seqs?.length && display_options.focused_seqs[display_options.focused_seqs.length - 1],
        props.id,
        props.selection?.main.head,
    ]);

    // Stabilise handlers reference to avoid unnecessary child re-renders
    const note_handlers = useMemo(() => ({
        click: props.handlers?.click,
        setCaretPosition: props.handlers?.setCaretPosition,
    }), [props.handlers?.click, props.handlers?.setCaretPosition]);

    const renderNote = (note: NoteProps, index: number) => (
        <GenericNote
            key={index}
            {...note}
            display_options={buildChildNoteDisplayOptions(display_options, note, props)}
            selection={props.selection}
            handlers={note_handlers}
        />
    );

    const container_styles: Array<string> = [view_specific_styles.viewDocument, master_view_styles.content];

    const content = (
        <div className={container_styles.join(' ')}
             id={`v${props.id}-inner`}
             data-testid={`document-${props.id}-inner`}
             data-level={display_options.level}
             data-parent-content-seq={display_options.parent_context_seq}
        >
            <div className={view_specific_styles.centredPane}>
                {props.nested?.parent_context?.linetags && <GenericNoteAttributes
                    {...props.nested?.parent_context}
                />}
                {props.nested?.parent_context && renderNote(props.nested?.parent_context, 0)}
            </div>
        </div>
    );

    if (onProfilerRender) {
        return <Profiler id="DocumentView" onRender={onProfilerRender}>{content}</Profiler>;
    }
    return content;
});

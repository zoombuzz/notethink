import React, { Profiler, useCallback, useEffect, useMemo, useState } from 'react';
import master_view_styles from "../../components/ViewRenderer.module.scss";
import view_specific_styles from "../../components/ViewRenderer.module.scss";
import {ViewProps} from "../../types/ViewProps";
import {NoteProps, NoteDisplayOptions} from "../../types/NoteProps";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import { useScrollToCaret, useCaretIndicator } from "../../lib/viewhooks";
import SettingsDocumentModal from "./SettingsDocumentModal";
import type { DocumentSettings } from "./SettingsDocumentModal";
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
    useScrollToCaret(display_options, props.id, props.selection);

    // virtual caret indicator: pulse-highlight the body item containing the editor caret
    useCaretIndicator(display_options, props.id, props.selection, view_specific_styles.caretTarget);

    // settings modal
    const [settings_open, setSettingsOpen] = useState(false);

    useEffect(() => {
        if (props.handlers?.onSettingsClick) {
            props.handlers.onSettingsClick.current = () => setSettingsOpen(true);
        }
        return () => {
            if (props.handlers?.onSettingsClick) {
                props.handlers.onSettingsClick.current = undefined;
            }
        };
    }, [props.handlers?.onSettingsClick]);

    const handleSettingsSave = useCallback((updated_settings: DocumentSettings) => {
        setSettingsOpen(false);
        // exclude show_line_numbers — it's a global setting persisted via workspace config
        const { show_line_numbers: _sln, ...per_view_settings } = display_options.settings || {};
        props.handlers?.setViewManagedState?.([{
            id: props.id,
            display_options: {
                settings: {
                    ...per_view_settings,
                    ...updated_settings,
                },
            },
        }]);
    }, [props.handlers, props.id, display_options.settings]);

    // Stabilise handlers reference to avoid unnecessary child re-renders
    const note_handlers = useMemo(() => ({
        click: props.handlers?.click,
        setCaretPosition: props.handlers?.setCaretPosition,
    }), [props.handlers?.click, props.handlers?.setCaretPosition]);

    const renderNote = (note: NoteProps, index: number) => (
        <GenericNote
            key={note.seq}
            {...note}
            display_options={buildChildNoteDisplayOptions(display_options, note, props)}
            selection={props.selection}
            handlers={note_handlers}
        />
    );

    const container_styles: Array<string> = [view_specific_styles.viewDocument, master_view_styles.content];

    const content = (
        <>
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
            <SettingsDocumentModal
                opened={settings_open}
                onClose={() => setSettingsOpen(false)}
                settings={{
                    show_linetags_in_headlines: display_options.settings?.show_linetags_in_headlines,
                    scroll_note_into_view: display_options.settings?.scroll_note_into_view,
                    auto_expand_focused_note: display_options.settings?.auto_expand_focused_note,
                }}
                onSave={handleSettingsSave}
                showLineNumbers={display_options.settings?.show_line_numbers}
                postMessage={props.handlers?.postMessage}
            />
        </>
    );

    if (onProfilerRender) {
        return <Profiler id="DocumentView" onRender={onProfilerRender}>{content}</Profiler>;
    }
    return content;
});

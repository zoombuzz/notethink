import type { MouseEvent } from "react";
import type { NoteProps, ClickPositionInfo, NoteDisplayOptions } from "../types/NoteProps";
import type { ViewProps } from "../types/ViewProps";
import view_specific_styles from "../components/ViewRenderer.module.scss";

/**
 * Build the standard CSS class list for a note element.
 * Used by MarkdownNote, CodeNote, and MermaidNote.
 */
export function buildNoteStyles(note: NoteProps, extra_classes?: string[]): string[] {
    const styles = [view_specific_styles.note].concat(extra_classes || []);
    if (note.focused) { styles.push(view_specific_styles.focused); }
    if (note.selected) { styles.push(view_specific_styles.selected); }
    if (note.display_options?.settings?.show_line_numbers) { styles.push(view_specific_styles.addGutter); }
    return styles;
}

/**
 * Build a ClickPositionInfo for a headline click.
 */
export function headlineClickPosition(note: NoteProps): ClickPositionInfo {
    const selectable = note.display_options?.deepest?.selectable_note;
    return {
        from: note.position.start.offset,
        to: note.position.end.offset,
        selection_from: selectable?.position?.start?.offset,
        selection_to: selectable?.position?.end_body?.offset ?? selectable?.position?.end?.offset,
        type: 'note_headline',
    };
}

/**
 * Build a ClickPositionInfo for a body click.
 */
export function bodyClickPosition(note: NoteProps): ClickPositionInfo {
    const selectable = note.display_options?.deepest?.selectable_note;
    return {
        from: note.position.end.offset,
        to: note.position.end_body?.offset,
        selection_from: selectable?.position?.start?.offset,
        selection_to: selectable?.position?.end_body?.offset ?? selectable?.position?.end?.offset,
        type: 'note_body',
    };
}

/**
 * Create an onClick handler that delegates to note.handlers.click with the appropriate position info.
 */
export function createNoteClickHandler(
    note: NoteProps,
    position: ClickPositionInfo,
): (event: MouseEvent<HTMLElement>) => void {
    return (event: MouseEvent<HTMLElement>) => {
        note.handlers?.click?.(event, note.display_options?.deepest?.selectable_note || note, position);
    };
}

/**
 * Build display_options for a GenericNote rendered inside a view (DocumentView, KanbanView).
 */
export function buildChildNoteDisplayOptions(
    view_display_options: NoteDisplayOptions,
    note: NoteProps,
    view: ViewProps,
): NoteDisplayOptions {
    return {
        ...view_display_options,
        ...note?.display_options,
        view_id: view.id,
        id: `v${view.id}-n${note.seq}`,
        deepest: {
            ...view.display_options?.deepest,
            ...note?.display_options?.deepest,
            selectable_level: note.level + 1,
        },
    };
}

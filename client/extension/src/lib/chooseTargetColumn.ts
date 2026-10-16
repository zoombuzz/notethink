import * as vscode from 'vscode';

/**
 * One open editor group as the target-column chooser needs it: its own column, and the paths of
 * whatever plain-document tabs it holds. The caller excludes the board's own tab from doc_paths,
 * so a reveal never replaces the rendered view with a plain text editor.
 */
export interface TargetColumnGroup {
    view_column: vscode.ViewColumn;
    doc_paths: ReadonlyArray<string>;
}

/**
 * Picks the editor group a note reveal or an activity open should land in, anchored on the viewer
 * panel's own column rather than VS Code's notion of the active group, which after a previous open
 * took focus is no longer the viewer's. Preference order: the group already showing
 * target_doc_path, else the first group besides the viewer's, else a group beside the viewer when
 * it is the only one open. alone_mode 'beside' spawns that group unconditionally, which every
 * activity open does; 'none' leaves the click unhandled instead, which is the note-click gate when
 * openNewEditorIfNoneOpen is off.
 */
export function chooseTargetColumn(
    viewer_column: vscode.ViewColumn | undefined,
    groups: ReadonlyArray<TargetColumnGroup>,
    target_doc_path: string | undefined,
    alone_mode: 'beside' | 'none',
): vscode.ViewColumn | undefined {
    if (target_doc_path) {
        const holding = groups.find(group => group.doc_paths.includes(target_doc_path));
        if (holding) { return holding.view_column; }
    }
    const other = groups.find(group => group.view_column !== viewer_column);
    if (other) { return other.view_column; }
    return alone_mode === 'beside' ? vscode.ViewColumn.Beside : undefined;
}

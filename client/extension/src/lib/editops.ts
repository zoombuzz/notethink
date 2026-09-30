import type * as vscode from 'vscode';
import { writeToLog } from './errorops';

/**
 * One edit replacing [from..to) with `insert`; `to` defaults to `from` (pure insertion). Matches
 * CodeMirror's transaction shape, so the wire format round-trips untranslated.
 */
export interface TextChange {
    from: number;
    to?: number;
    insert: string;
}

/**
 * The first change outside [0, doc_length] or with from > to, else null. A non-null result rejects
 * the whole batch: a partial apply would leave the document half-edited.
 */
export function firstInvalidChange(changes: Array<TextChange>, doc_length: number): TextChange | null {
    for (const change of changes) {
        const to = change.to ?? change.from;
        if (change.from < 0 || to < 0 || change.from > doc_length || to > doc_length || change.from > to) {
            return change;
        }
    }
    return null;
}

/**
 * Net length change from edits at or before `offset`. Added to a caret offset, it keeps the caret on
 * its character through a view-driven edit instead of jumping to the last edited line. An edit
 * straddling the offset counts as after it.
 */
export function offsetDeltaBefore(changes: Array<TextChange>, offset: number): number {
    let delta = 0;
    for (const change of changes) {
        const to = change.to ?? change.from;
        if (to <= offset) {
            delta += change.insert.length - (to - change.from);
        }
    }
    return delta;
}

// logs each change with ±10 chars of surrounding context: one summary line, then one line per change
export function logEditTextChanges(document: vscode.TextDocument, doc_path: string, changes: Array<TextChange>): void {
    const doc_text = document.getText();
    writeToLog('editText', `${changes.length} changes on ${doc_path} (len=${doc_text.length})`);
    for (const change of changes) {
        const ctx = doc_text.slice(Math.max(0, change.from - 10), (change.to ?? change.from) + 10);
        writeToLog('editText', `from=${change.from} to=${change.to} insert="${change.insert}" ctx="${ctx}"`);
    }
}

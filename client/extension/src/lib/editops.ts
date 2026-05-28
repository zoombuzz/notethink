import type * as vscode from 'vscode';
import { writeToLog } from './errorops';

/**
 * a single text edit: replace [from..to) with `insert`. `to` defaults to `from`
 * (pure insertion); the resolved range is [from..to] inclusive of `from`,
 * exclusive of `to`, matching CodeMirror's transaction shape on the webview
 * side so the wire format round-trips without translation.
 */
export interface TextChange {
    from: number;
    to?: number;
    insert: string;
}

/**
 * find the first change whose offsets fall outside [0, doc_length] or have
 * from > to. Returns the offending change for logging, or null when every
 * change is valid. Use to validate a batch of changes before applying — any
 * non-null return means the whole batch should be rejected (partial application
 * would leave the document in a half-edited state).
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
 * audit-log each pending change with ±10 chars of surrounding context before
 * it is applied. Emits one summary line ("N changes on path") plus one line
 * per change. Intended to run after firstInvalidChange has cleared the batch.
 */
export function logEditTextChanges(document: vscode.TextDocument, doc_path: string, changes: Array<TextChange>): void {
    const doc_text = document.getText();
    writeToLog('editText', `${changes.length} changes on ${doc_path} (len=${doc_text.length})`);
    for (const change of changes) {
        const ctx = doc_text.slice(Math.max(0, change.from - 10), (change.to ?? change.from) + 10);
        writeToLog('editText', `from=${change.from} to=${change.to} insert="${change.insert}" ctx="${ctx}"`);
    }
}

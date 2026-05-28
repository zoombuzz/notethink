import Debug from "debug";
import type { HashMapOf, Doc } from "../types/general";

const debug = Debug("nodejs:notethink:docops");

/**
 * Pick the most-recently-sent doc from the map (ISO `updateSentAt` lex-compares as
 * chronological). Used in current_file mode to render exactly one composer regardless
 * of how the docs map got populated — a doc stamped by the extension's sendDoc is the
 * one the extension considers active. Missing `updateSentAt` is treated as the empty
 * string so a doc with a real timestamp always wins over an unstamped one; among
 * unstamped (or equal-timestamp) entries the first iterated insertion order wins via
 * the strict `>` comparison.
 */
export function pickMostRecentlySentDoc(docs: HashMapOf<Doc>): { note_id: string; note: Doc } | undefined {
    let best_entry: { note_id: string; note: Doc } | undefined;
    let best_ts = '';
    for (const [note_id, note] of Object.entries(docs)) {
        const ts = note.updateSentAt ?? '';
        if (!best_entry || ts > best_ts) {
            best_entry = { note_id, note };
            best_ts = ts;
        }
    }
    return best_entry;
}

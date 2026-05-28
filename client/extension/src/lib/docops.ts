import type { Doc } from "../types/general";

/**
 * Project a Doc down to just its identity fields (path + id). Used by logging /
 * audit paths that want to refer to a doc without dragging the full content +
 * text payload through structured-clone or console output.
 */
export function abbrevDoc(doc: Pick<Doc, 'path' | 'id'>): Pick<Doc, 'path' | 'id'> {
    return {
        path: doc.path,
        id: doc.id,
    };
}

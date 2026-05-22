import type { Doc } from "../types/general";

export function abbrevDoc(doc: Pick<Doc, 'path' | 'id'>) {
    return {
		path: doc.path,
        id: doc.id,
    };
}

export function getNonce(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

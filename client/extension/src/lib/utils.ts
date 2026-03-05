
export function abbrevDoc(doc: any) {
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

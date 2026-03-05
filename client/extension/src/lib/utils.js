export function abbrevDoc(doc) {
    return {
        path: doc.path,
        id: doc.id,
    };
}
export function getNonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=utils.js.map
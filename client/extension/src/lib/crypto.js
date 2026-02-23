export async function generateIdentifier(message, algo = 'SHA-256') {
    return Array.from(new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(message))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=crypto.js.map
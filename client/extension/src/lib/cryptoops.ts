/**
 * SHA-256 hash of a message string, returned as a lowercase hex digest. Used to
 * derive content-hash identifiers for doc deduplication and stable_id seeding.
 */
export async function generateIdentifier(message: string, algo: AlgorithmIdentifier = 'SHA-256'): Promise<string> {
    return Array.from(
        new Uint8Array(
            await crypto.subtle.digest(algo, new TextEncoder().encode(message))
        ),
        (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
}

/**
 * 24-byte cryptographically-random nonce as a 48-char lowercase hex string. Used
 * by the webview HTML's `<meta http-equiv="Content-Security-Policy">` nonce
 * attribute and the inline boot script's nonce.
 */
export function getNonce(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

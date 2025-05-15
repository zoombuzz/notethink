
export async function generateIdentifier(message: string, algo = 'SHA-256') {
    return Array.from(
        new Uint8Array(
            await crypto.subtle.digest(algo, new TextEncoder().encode(message))
        ),
        (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
}

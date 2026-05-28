import { generateIdentifier, getNonce } from './cryptoops';

describe('cryptoops', () => {
	describe('generateIdentifier()', () => {
		it('generates a consistent hash for the same input', async () => {
			const hash1 = await generateIdentifier('test message');
			const hash2 = await generateIdentifier('test message');
			expect(hash1).toBe(hash2);
		});

		it('generates different hashes for different inputs', async () => {
			const hash1 = await generateIdentifier('message one');
			const hash2 = await generateIdentifier('message two');
			expect(hash1).not.toBe(hash2);
		});

		it('returns a 64-char lowercase hex digest for SHA-256', async () => {
			const hash = await generateIdentifier('test');
			expect(hash).toHaveLength(64);
			expect(hash).toMatch(/^[0-9a-f]+$/);
		});

		it('handles the empty string', async () => {
			const hash = await generateIdentifier('');
			expect(hash).toHaveLength(64);
		});

		it('supports different algorithms (SHA-256 vs SHA-512)', async () => {
			const sha256_hash = await generateIdentifier('test', 'SHA-256');
			const sha512_hash = await generateIdentifier('test', 'SHA-512');
			expect(sha256_hash).toHaveLength(64);
			expect(sha512_hash).toHaveLength(128);
		});
	});

	describe('getNonce()', () => {
		it('returns a string', () => {
			expect(typeof getNonce()).toBe('string');
		});

		it('returns a 48-character lowercase hex string (24 bytes)', () => {
			const nonce = getNonce();
			expect(nonce).toHaveLength(48);
			expect(nonce).toMatch(/^[0-9a-f]+$/);
		});

		it('returns different values on successive calls', () => {
			expect(getNonce()).not.toBe(getNonce());
		});
	});
});

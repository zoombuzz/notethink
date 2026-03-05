import * as assert from 'assert';
import { generateIdentifier } from '../../../lib/crypto';

suite('Crypto Utils', () => {
    test('generates consistent hash for same input', async () => {
        const hash1 = await generateIdentifier('test message');
        const hash2 = await generateIdentifier('test message');
        assert.strictEqual(hash1, hash2);
    });

    test('generates different hashes for different inputs', async () => {
        const hash1 = await generateIdentifier('message one');
        const hash2 = await generateIdentifier('message two');
        assert.notStrictEqual(hash1, hash2);
    });

    test('generates valid hex string', async () => {
        const hash = await generateIdentifier('test');
        // SHA-256 produces 64 character hex string
        assert.strictEqual(hash.length, 64);
        assert.match(hash, /^[0-9a-f]+$/);
    });

    test('handles empty string', async () => {
        const hash = await generateIdentifier('');
        assert.strictEqual(hash.length, 64);
    });

    test('supports different algorithms', async () => {
        const sha256_hash = await generateIdentifier('test', 'SHA-256');
        const sha512_hash = await generateIdentifier('test', 'SHA-512');

        // SHA-256 = 64 chars, SHA-512 = 128 chars
        assert.strictEqual(sha256_hash.length, 64);
        assert.strictEqual(sha512_hash.length, 128);
    });
});

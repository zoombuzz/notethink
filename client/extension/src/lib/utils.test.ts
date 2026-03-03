import { abbrevDoc, getNonce } from './utils';

describe('utils', () => {
	describe('abbrevDoc()', () => {
		it('returns an object with only path and id', () => {
			const doc = {
				path: '/workspace/notes/test.md',
				id: 'abc123',
				content: { type: 'root', children: [] },
				text: '# Hello',
				hash_sha256: 'deadbeef',
			};
			const result = abbrevDoc(doc);
			expect(result).toEqual({
				path: '/workspace/notes/test.md',
				id: 'abc123',
			});
		});

		it('does not include extra properties from the input', () => {
			const doc = {
				path: '/test.md',
				id: 'x',
				text: 'should not appear',
				extra: 'also hidden',
			};
			const result = abbrevDoc(doc);
			expect(Object.keys(result)).toEqual(['path', 'id']);
		});

		it('handles missing optional fields', () => {
			const doc = { path: '/a.md', id: '1' };
			const result = abbrevDoc(doc);
			expect(result).toEqual({ path: '/a.md', id: '1' });
		});

		it('handles undefined path and id', () => {
			const doc = {};
			const result = abbrevDoc(doc);
			expect(result).toEqual({ path: undefined, id: undefined });
		});
	});

	describe('getNonce()', () => {
		it('returns a string', () => {
			const nonce = getNonce();
			expect(typeof nonce).toBe('string');
		});

		it('returns a 48-character hex string (24 bytes)', () => {
			const nonce = getNonce();
			expect(nonce).toHaveLength(48);
			expect(nonce).toMatch(/^[0-9a-f]+$/);
		});

		it('returns different values on successive calls', () => {
			const nonce1 = getNonce();
			const nonce2 = getNonce();
			expect(nonce1).not.toBe(nonce2);
		});
	});
});

import { isPathWithin } from './pathops';

describe('pathops', () => {
	describe('isPathWithin()', () => {
		it('returns true for a path inside a root', () => {
			expect(isPathWithin('/home/user/ws/notes/todo.md', ['/home/user/ws'])).toBe(true);
		});

		it('returns true when the target equals the root', () => {
			expect(isPathWithin('/home/user/ws', ['/home/user/ws'])).toBe(true);
		});

		it('rejects a sibling-prefix escape (/ws-evil is not within /ws)', () => {
			expect(isPathWithin('/home/user/ws-evil/file.md', ['/home/user/ws'])).toBe(false);
		});

		it('rejects .. traversal that resolves outside the root', () => {
			expect(isPathWithin('/home/user/ws/../secret.md', ['/home/user/ws'])).toBe(false);
		});

		it('rejects a path that is the parent of the root', () => {
			expect(isPathWithin('/home/user', ['/home/user/ws'])).toBe(false);
		});

		it('accepts when requireExtension matches (case-insensitive)', () => {
			expect(isPathWithin('/home/user/ws/A.MD', ['/home/user/ws'], { requireExtension: '.md' })).toBe(true);
		});

		it('rejects when requireExtension does not match', () => {
			expect(isPathWithin('/home/user/ws/note.txt', ['/home/user/ws'], { requireExtension: '.md' })).toBe(false);
		});

		it('returns true when within any of multiple roots', () => {
			expect(isPathWithin('/b/x.md', ['/a', '/b', '/c'])).toBe(true);
		});

		it('returns false when within none of multiple roots', () => {
			expect(isPathWithin('/d/x.md', ['/a', '/b', '/c'])).toBe(false);
		});

		it('fails closed on empty roots array', () => {
			expect(isPathWithin('/a/x.md', [])).toBe(false);
		});

		it('fails closed on an empty target path', () => {
			expect(isPathWithin('', ['/a'])).toBe(false);
		});

		it('fails closed on a whitespace-only target path', () => {
			expect(isPathWithin('   ', ['/a'])).toBe(false);
		});

		it('skips empty/garbage root entries instead of treating them as cwd', () => {
			expect(isPathWithin('/a/x.md', ['', '   '])).toBe(false);
		});
	});
});

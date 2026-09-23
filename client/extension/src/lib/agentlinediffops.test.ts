import { countLineDiff, looksBinary } from './agentlinediffops';

describe('countLineDiff', () => {
    it('counts every line added when the old side is absent, the shape of a newly added file', () => {
        expect(countLineDiff(undefined, 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 });
    });

    it('counts every line removed when the new side is absent, the shape of a deleted file', () => {
        expect(countLineDiff('a\nb\nc\n', undefined)).toEqual({ added: 0, removed: 3 });
    });

    it('reports no change for two identical texts', () => {
        expect(countLineDiff('a\nb\nc\n', 'a\nb\nc\n')).toEqual({ added: 0, removed: 0 });
    });

    it('counts only the changed lines, leaving unchanged lines out of both totals', () => {
        expect(countLineDiff('a\nb\nc\n', 'a\nx\nc\n')).toEqual({ added: 1, removed: 1 });
    });

    it('counts a pure insertion in the middle as one added line and nothing removed', () => {
        expect(countLineDiff('a\nc\n', 'a\nb\nc\n')).toEqual({ added: 1, removed: 0 });
    });

    it('counts a pure deletion in the middle as one removed line and nothing added', () => {
        expect(countLineDiff('a\nb\nc\n', 'a\nc\n')).toEqual({ added: 0, removed: 1 });
    });

    it('does not double-count a missing trailing newline as an extra line', () => {
        expect(countLineDiff('a\nb\n', 'a\nb')).toEqual({ added: 0, removed: 0 });
    });

    it('treats two empty texts as no change', () => {
        expect(countLineDiff('', '')).toEqual({ added: 0, removed: 0 });
    });
});

describe('looksBinary', () => {
    it('is false for ordinary UTF-8 text', () => {
        expect(looksBinary(new TextEncoder().encode('function foo() { return 1; }\n'))).toBe(false);
    });

    it('is true for bytes carrying a NUL within the sniff window', () => {
        expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
    });

    it('ignores a NUL byte past the sniff window', () => {
        const bytes = new Uint8Array(8100);
        bytes.fill(0x41);
        bytes[8050] = 0;
        expect(looksBinary(bytes)).toBe(false);
    });
});

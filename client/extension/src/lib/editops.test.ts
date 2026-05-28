import { firstInvalidChange, logEditTextChanges, type TextChange } from './editops';

jest.mock('./errorops', () => ({
    writeToLog: jest.fn(),
}));

import { writeToLog } from './errorops';

describe('editops', () => {

    describe('firstInvalidChange', () => {

        it('returns null for an empty change list', () => {
            expect(firstInvalidChange([], 100)).toBeNull();
        });

        it('returns null when every change is valid', () => {
            const changes: TextChange[] = [
                { from: 0, to: 10, insert: 'a' },
                { from: 20, to: 25, insert: 'b' },
                { from: 50, insert: 'c' },
            ];
            expect(firstInvalidChange(changes, 100)).toBeNull();
        });

        it('returns the first change with negative from', () => {
            const bad: TextChange = { from: -1, to: 5, insert: 'x' };
            expect(firstInvalidChange([{ from: 0, to: 10, insert: 'a' }, bad], 100)).toBe(bad);
        });

        it('returns the first change with negative to', () => {
            const bad: TextChange = { from: 5, to: -1, insert: 'x' };
            expect(firstInvalidChange([bad], 100)).toBe(bad);
        });

        it('returns the first change whose from exceeds doc_length', () => {
            const bad: TextChange = { from: 200, to: 200, insert: 'x' };
            expect(firstInvalidChange([bad], 100)).toBe(bad);
        });

        it('returns the first change whose to exceeds doc_length', () => {
            const bad: TextChange = { from: 50, to: 200, insert: 'x' };
            expect(firstInvalidChange([bad], 100)).toBe(bad);
        });

        it('returns the first change with from > to', () => {
            const bad: TextChange = { from: 50, to: 10, insert: 'x' };
            expect(firstInvalidChange([bad], 100)).toBe(bad);
        });

        it('treats missing `to` as equal to `from` (pure insertion at offset)', () => {
            const change: TextChange = { from: 50, insert: 'x' };
            expect(firstInvalidChange([change], 100)).toBeNull();
        });

        it('rejects a pure insertion at offset > doc_length', () => {
            const bad: TextChange = { from: 150, insert: 'x' };
            expect(firstInvalidChange([bad], 100)).toBe(bad);
        });

        it('returns the FIRST invalid change, not subsequent ones', () => {
            const first_bad: TextChange = { from: -1, insert: 'a' };
            const second_bad: TextChange = { from: 999, insert: 'b' };
            expect(firstInvalidChange([first_bad, second_bad], 100)).toBe(first_bad);
        });
    });

    describe('logEditTextChanges', () => {

        beforeEach(() => {
            (writeToLog as jest.Mock).mockClear();
        });

        function makeDocument(text: string): { getText: () => string } {
            return { getText: () => text };
        }

        it('logs one summary line plus one line per change', () => {
            const doc = makeDocument('the quick brown fox jumps over the lazy dog');
            const changes: TextChange[] = [
                { from: 4, to: 9, insert: 'slow' },
                { from: 35, insert: '!' },
            ];
            logEditTextChanges(doc as never, '/repo/test.md', changes);
            expect(writeToLog).toHaveBeenCalledTimes(3);
            expect((writeToLog as jest.Mock).mock.calls[0]).toEqual(['editText', '2 changes on /repo/test.md (len=43)']);
        });

        it('includes ±10 chars of surrounding context per change', () => {
            const doc = makeDocument('0123456789ABCDEFGHIJ0123456789');
            const changes: TextChange[] = [
                { from: 15, to: 18, insert: 'XYZ' },
            ];
            logEditTextChanges(doc as never, '/repo/test.md', changes);
            // ctx slice = text.slice(max(0, 15-10), 18+10) = text.slice(5, 28) — slice end exclusive, so chars 5..27 = '56789ABCDEFGHIJ01234567' (23 chars)
            expect((writeToLog as jest.Mock).mock.calls[1][1]).toContain('ctx="56789ABCDEFGHIJ01234567"');
            expect((writeToLog as jest.Mock).mock.calls[1][1]).toContain('from=15 to=18 insert="XYZ"');
        });

        it('clamps the context start to 0 when from < 10', () => {
            const doc = makeDocument('0123456789ABCDEF');
            const changes: TextChange[] = [{ from: 3, to: 5, insert: 'X' }];
            logEditTextChanges(doc as never, '/repo/test.md', changes);
            // ctx = text.slice(max(0, 3-10), 5+10) = text.slice(0, 15) = '0123456789ABCDE'
            expect((writeToLog as jest.Mock).mock.calls[1][1]).toContain('ctx="0123456789ABCDE"');
        });

        it('logs zero changes as a single summary line with no per-change rows', () => {
            const doc = makeDocument('abc');
            logEditTextChanges(doc as never, '/repo/test.md', []);
            expect(writeToLog).toHaveBeenCalledTimes(1);
            expect((writeToLog as jest.Mock).mock.calls[0]).toEqual(['editText', '0 changes on /repo/test.md (len=3)']);
        });
    });
});
